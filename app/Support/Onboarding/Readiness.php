<?php

declare(strict_types=1);

namespace App\Support\Onboarding;

use App\Support\Documents\DocumentTypes;
use App\Support\Loads\Guards;
use App\Support\Tenancy\TenantPolicy;
use App\Support\Time\Viewer;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Qué le falta a un transportista para poder llevar carga.
 *
 * SE CALCULA, NO SE GUARDA. `carrier_onboardings` tiene una columna `checklist`
 * de tipo JSON y este servicio NO la escribe, a propósito: una lista guardada
 * dice «listo» el día que se guardó y sigue diciéndolo el día que caduca el
 * certificado de seguro. La pregunta «¿puede llevar carga HOY?» solo la puede
 * contestar el estado de hoy.
 *
 * LO BLOQUEANTE SALE DE `Guards`, que es la misma clase que decide si una carga
 * se puede despachar. Con dos implementaciones, esta pantalla diría «listo» y
 * el despacho diría «bloqueado» — y quien lleva cumplimiento acabaría
 * confiando en la que se equivoque. Aquí solo se traduce y se agrupa.
 *
 * LO QUE SE AÑADE ENCIMA son los AVISOS, que no bloquean nada:
 *
 *  - La verificación de FMCSA fuera de plazo. No bloquea el despacho hoy y no
 *    lo cambio yo: endurecer esa puerta es una decisión de negocio con
 *    consecuencias en la operación del día, y le toca tomarla a quien lleva la
 *    casa. Pero quien mira esta cola tiene que verlo.
 *  - El acuerdo de transportista sin firmar cuando ya existe una solicitud de
 *    firma pendiente. El documento firmado sí es obligatorio y lo cuenta
 *    `Guards`; esto añade en qué punto va la firma.
 */
final class Readiness
{
    /**
     * @return array{
     *     blocking: list<string>,
     *     warnings: list<string>,
     *     missingDocuments: list<string>,
     *     requiredDocuments: list<string>,
     *     approvedDocuments: list<string>,
     *     signature: array<string, mixed>|null,
     *     fmcsaCheckedAt: string|null,
     *     fmcsaDueDays: int|null,
     * }
     */
    public static function forCarrier(string $tenantId, string $carrierId): array
    {
        $bloqueante = Guards::carrierBlocking($carrierId);

        // `Guards` nombra cada documento que falta como `missingDocument:<tipo>`.
        // Se separan para que la pantalla pueda pintar la lista de comprobación
        // del diccionario portado, que tiene una entrada por tipo.
        $faltan = [];
        $otros = [];

        foreach ($bloqueante as $motivo) {
            if (str_starts_with($motivo, 'missingDocument:')) {
                $faltan[] = substr($motivo, strlen('missingDocument:'));
            } else {
                $otros[] = $motivo;
            }
        }

        $requeridos = DocumentTypes::requiredFor('carrier');
        $hoy = CarbonImmutable::now()->toDateString();

        $aprobados = DB::table('documents')
            ->where('tenant_id', $tenantId)
            ->where('owner_type', 'carrier')
            ->where('owner_id', $carrierId)
            ->whereNull('deleted_at')
            ->where('review_status', 'approved')
            ->where(function ($q) use ($hoy): void {
                $q->whereNull('expiration_date')->orWhereDate('expiration_date', '>=', $hoy);
            })
            ->pluck('document_type')
            ->unique()
            ->values()
            ->all();

        [$avisos, $comprobadoEl, $plazo] = self::fmcsa($tenantId, $carrierId);

        return [
            'blocking' => $otros,
            'warnings' => $avisos,
            'missingDocuments' => $faltan,
            'requiredDocuments' => $requeridos,
            'approvedDocuments' => $aprobados,
            'signature' => self::firmaDelAcuerdo($tenantId, $carrierId),
            'fmcsaCheckedAt' => $comprobadoEl,
            'fmcsaDueDays' => $plazo,
        ];
    }

    /**
     * La lista de comprobación, calculada HOY.
     *
     * ## Por qué existe este método
     *
     * `carrier_onboardings` tiene una columna `checklist` de tipo JSON que la
     * ficha del transportista pintaba con vistos verdes. Nadie la escribe: en
     * el alta se guarda `[]` y solo el sembrador de demostración le pone
     * valores. Así que en producción la tarjeta no salía nunca, y con los datos
     * de demostración salía un visto verde congelado el día que se sembró.
     *
     * El docblock de esta misma clase ya decía por qué eso no vale: «una lista
     * guardada dice “listo” el día que se guardó y sigue diciéndolo el día que
     * caduca el certificado de seguro».
     *
     * ## De dónde salen las filas
     *
     * De `requiredDocuments`, o sea de `DocumentTypes::requiredFor('carrier')`,
     * no de una lista escrita a mano aquí. Si mañana el esquema exige un
     * documento más, la lista lo enseña sin tocar este fichero — y si se
     * escribiera a mano, esta comprobación diría «listo» mientras `Guards`
     * bloquea el despacho, que es la contradicción que esta clase existe para
     * no tener.
     *
     * El W-9 no sale: no está en `requiredFor`, así que no bloquea nada, y un
     * visto verde al lado sugería que sí. Que deba exigirse es una decisión de
     * negocio y le toca a quien lleva la casa, igual que endurecer FMCSA.
     *
     * ## La fila de FMCSA es un aviso, no un bloqueo
     *
     * Va marcada como tal. Hoy no impide despachar —lo dice el docblock de
     * arriba— y pintarla igual que las demás haría creer lo contrario.
     *
     * @return list<array{key: string, done: bool, blocking: bool}>
     */
    public static function checklist(string $tenantId, string $carrierId): array
    {
        $estado = self::forCarrier($tenantId, $carrierId);

        $lista = [];

        foreach ($estado['requiredDocuments'] as $tipo) {
            $lista[] = [
                'key' => $tipo,
                'done' => in_array($tipo, $estado['approvedDocuments'], true),
                'blocking' => true,
            ];
        }

        $lista[] = [
            'key' => 'fmcsa',
            'done' => $estado['fmcsaCheckedAt'] !== null
                && ! in_array('fmcsaNeverChecked', $estado['warnings'], true)
                && ! in_array('fmcsaStale', $estado['warnings'], true),
            'blocking' => false,
        ];

        return $lista;
    }

    /**
     * @return array{0: list<string>, 1: string|null, 2: int|null}
     */
    private static function fmcsa(string $tenantId, string $carrierId): array
    {
        $plazo = TenantPolicy::for($tenantId)->fmcsaReverificationDays;

        $ultima = DB::table('fmcsa_verifications')
            ->where('tenant_id', $tenantId)
            ->where('carrier_id', $carrierId)
            ->orderByDesc('checked_at')
            ->value('checked_at');

        if ($ultima === null) {
            // Nunca comprobado NO es lo mismo que comprobado hace mucho, y el
            // aviso lo dice con su propio texto: uno es una tarea que nadie ha
            // empezado y el otro una que se dejó de hacer.
            return [['fmcsaNeverChecked'], null, $plazo];
        }

        $vencido = CarbonImmutable::parse((string) $ultima)
            ->isBefore(CarbonImmutable::now()->subDays($plazo));

        return [
            $vencido ? ['fmcsaStale'] : [],
            substr((string) $ultima, 0, 10),
            $plazo,
        ];
    }

    /**
     * En qué punto va la firma del acuerdo de transportista.
     *
     * No es lo mismo «no ha firmado» que «se le mandó y no ha abierto» o «lo
     * rechazó». Quien lleva cumplimiento hace cosas distintas en cada caso.
     *
     * @return array<string, mixed>|null
     */
    private static function firmaDelAcuerdo(string $tenantId, string $carrierId): ?array
    {
        $solicitud = DB::table('signature_requests as r')
            ->join('signature_templates as t', 't.id', '=', 'r.template_id')
            ->where('r.tenant_id', $tenantId)
            ->where('r.carrier_id', $carrierId)
            ->where('t.template_key', 'carrier_agreement')
            ->whereNull('r.deleted_at')
            ->orderByDesc('r.requested_at')
            ->first(['r.id', 'r.status', 'r.requested_at', 'r.first_viewed_at', 'r.completed_at']);

        if ($solicitud === null) {
            return null;
        }

        return [
            'id' => (string) $solicitud->id,
            'status' => (string) $solicitud->status,
            // El mismo huso que SignatureController, y por eso pasa por
            // Viewer: esta es la MISMA solicitud que se ve en la pantalla de
            // firmas. Dos pantallas de la misma aplicación diciendo dos horas
            // distintas del mismo hecho es peor que las dos diciendo UTC.
            'requestedAt' => Viewer::at($solicitud->requested_at),
            'firstViewedAt' => Viewer::at($solicitud->first_viewed_at),
        ];
    }
}
