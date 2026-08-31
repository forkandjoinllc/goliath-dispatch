<?php

declare(strict_types=1);

namespace App\Support\Equipment;

use App\Authorization\Actor;
use App\Enums\AuditAction;
use App\Support\Audit;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Qué significa que una unidad esté «verificada».
 *
 * ## El problema
 *
 * `pending_verification` es el estado con el que nace todo camión y todo
 * remolque, y desde el lote 57 impide de verdad ponerlos en una carga. Pero
 * salir de ese estado era pulsar un desplegable: nada quedaba escrito sobre QUÉ
 * se había revisado, contra qué documento, ni quién lo dijo. «Verificada» era
 * una palabra sin nada detrás, y una puerta cuya llave la tiene cualquiera es
 * una puerta decorativa.
 *
 * `equipment_verifications` llevaba en el esquema desde el principio, con
 * columnas para todo esto, vacía.
 *
 * ## Qué se comprueba
 *
 * Que el VIN de la unidad aparezca en el **certificado de seguro** del
 * transportista. Es la comprobación que importa: un camión que no está en la
 * póliza es un camión que circula sin cobertura, y eso no se descubre hasta que
 * hay un siniestro.
 *
 * Y se comprueba con una PERSONA delante. El sistema enseña el VIN, enseña el
 * certificado vigente, y alguien con permiso dice que lo ha visto ahí. Lo que
 * queda escrito es contra qué documento y qué versión de ese documento se miró:
 * si la póliza se sustituye mañana, la verificación de ayer sigue diciendo lo
 * que se miró ayer.
 *
 * ## Lo que NO hace, y por qué
 *
 * **No lee el certificado.** Las columnas `extracted_vins`, `ocr_provider` y
 * `ocr_confidence` existen y se quedan vacías. Sacar los VIN de un PDF con capa
 * de texto es fácil; sacarlos de un certificado escaneado necesita un proveedor
 * de OCR que aquí no hay. Construir la mitad fácil dejaría un sistema que a
 * veces propone VIN y a veces no, sin que quien lo usa sepa cuál de las dos
 * cosas está pasando — y este proyecto ya ha pagado bastante caro el patrón de
 * la funcionalidad a medias que la pantalla presenta como entera.
 *
 * Tampoco cuenta fotos: `media_count` se queda en cero y `equipment_media` sigue
 * vacía. Está en docs/equipment.md, en «lo que falta», dicho con estas palabras.
 */
final class Verification
{
    public const VERIFICADA = 'verified';

    public const ANULADA = 'manually_overridden';

    public const SIN_SEGURO = 'no_coi_on_file';

    public const SEGURO_VENCIDO = 'coi_expired';

    public const SEGURO_SIN_APROBAR = 'coi_not_approved';

    /**
     * ¿Tiene esta unidad una verificación que la habilite?
     *
     * Vale tanto la confirmación contra el certificado como la anulación
     * razonada: las dos son actos de una persona con permiso y las dos dejan
     * rastro. Lo que no vale es nada.
     */
    public static function habilita(string $tenantId, string $type, string $id): bool
    {
        return DB::table('equipment_verifications')
            ->where('tenant_id', $tenantId)
            ->where('equipment_type', $type)
            ->where('equipment_id', $id)
            ->whereIn('status', [self::VERIFICADA, self::ANULADA])
            ->exists();
    }

    /**
     * La última verificación de esta unidad, si la hay.
     */
    public static function ultima(string $tenantId, string $type, string $id): ?object
    {
        return DB::table('equipment_verifications')
            ->where('tenant_id', $tenantId)
            ->where('equipment_type', $type)
            ->where('equipment_id', $id)
            ->orderByDesc('created_at')
            ->first();
    }

    /**
     * El certificado de seguro vigente del transportista.
     *
     * Aprobado y sin vencer: un certificado pendiente de revisión no sirve para
     * verificar nada, y uno vencido tampoco — es exactamente el papel que dice
     * hasta cuándo hay cobertura.
     */
    public static function certificado(string $tenantId, string $carrierId): ?object
    {
        return DB::table('documents as d')
            ->leftJoin('document_versions as v', 'v.id', '=', 'd.current_version_id')
            ->where('d.tenant_id', $tenantId)
            ->where('d.owner_type', 'carrier')
            ->where('d.owner_id', $carrierId)
            ->where('d.document_type', 'certificate_of_insurance')
            ->where('d.review_status', 'approved')
            ->whereNull('d.deleted_at')
            ->where(function ($q): void {
                $q->whereNull('d.expiration_date')
                    ->orWhereDate('d.expiration_date', '>=', CarbonImmutable::now()->toDateString());
            })
            ->orderByDesc('d.created_at')
            ->first(['d.id', 'd.expiration_date', 'v.id as version_id', 'v.version_number']);
    }

    /**
     * Por qué no se puede verificar todavía esta unidad.
     *
     * @return list<string>
     */
    public static function impedimentos(string $tenantId, string $carrierId): array
    {
        if (self::certificado($tenantId, $carrierId) !== null) {
            return [];
        }

        // Tres casos y no dos, porque son tres llamadas de teléfono distintas:
        // pedir el papel, pedir el papel NUEVO, o revisar el que ya está aquí.
        //
        // Con dos, un certificado subido y pendiente de revisión se anunciaba
        // como «vencido» — y mandaba a quien lo leyera a pedirle a un
        // transportista un documento que ya había mandado. Lo cazó el navegador:
        // la empresa de demostración tiene justo ese caso.
        $filas = DB::table('documents')
            ->where('tenant_id', $tenantId)
            ->where('owner_type', 'carrier')
            ->where('owner_id', $carrierId)
            ->where('document_type', 'certificate_of_insurance')
            ->whereNull('deleted_at')
            ->get(['review_status', 'expiration_date']);

        if ($filas->isEmpty()) {
            return [self::SIN_SEGURO];
        }

        $hoy = CarbonImmutable::now()->toDateString();

        $aprobadoAlguno = $filas->contains(
            static fn (object $d): bool => $d->review_status === 'approved'
        );

        if (! $aprobadoAlguno) {
            return [self::SEGURO_SIN_APROBAR];
        }

        // Hay aprobado y aun así certificado() no devolvió nada: está vencido.
        return [self::SEGURO_VENCIDO];
    }

    /**
     * Alguien con permiso dice que ha visto el VIN en el certificado.
     *
     * @throws \RuntimeException si no hay certificado vigente contra el que mirar
     */
    public static function confirmar(Actor $actor, string $type, string $id, string $carrierId, string $vin): string
    {
        $tenantId = (string) $actor->tenantId;
        $coi = self::certificado($tenantId, $carrierId);

        if ($coi === null) {
            throw new \RuntimeException('sin certificado vigente');
        }

        return self::escribir($actor, $type, $id, $carrierId, [
            'status' => self::VERIFICADA,
            'coi_document_id' => (string) $coi->id,
            'coi_document_version_id' => $coi->version_id === null ? null : (string) $coi->version_id,
            'matched_vin' => $vin,
            'verified_at' => CarbonImmutable::now(),
        ]);
    }

    /**
     * Ponerla en servicio a pesar de todo, con motivo escrito.
     *
     * Existe porque la alternativa es peor: sin una salida razonada, quien tiene
     * prisa acaba editando el estado por otro camino o inventándose un
     * certificado. Una anulación con nombre y motivo se puede auditar; un atajo
     * silencioso, no.
     */
    public static function anular(Actor $actor, string $type, string $id, string $carrierId, string $motivo): string
    {
        return self::escribir($actor, $type, $id, $carrierId, [
            'status' => self::ANULADA,
            'overridden_by_user_id' => $actor->auditUserId(),
            'override_reason' => $motivo,
            'overridden_at' => CarbonImmutable::now(),
        ]);
    }

    /**
     * @param  array<string, mixed>  $campos
     */
    private static function escribir(Actor $actor, string $type, string $id, string $carrierId, array $campos): string
    {
        $tenantId = (string) $actor->tenantId;
        $verificacionId = (string) Str::uuid();
        $ahora = CarbonImmutable::now();

        DB::table('equipment_verifications')->insert([
            'id' => $verificacionId,
            'tenant_id' => $tenantId,
            'equipment_type' => $type,
            'equipment_id' => $id,
            'carrier_id' => $carrierId,
            'extracted_vins' => '[]',
            'blocking_reasons' => '[]',
            'created_at' => $ahora,
            'updated_at' => $ahora,
            ...$campos,
        ]);

        // El espejo en la propia unidad. Se guarda por comodidad de lectura —la
        // lista de equipos no puede hacer una subconsulta por fila— y la fuente
        // de la verdad sigue siendo la tabla de verificaciones, que es la que
        // lleva el rastro.
        DB::table($type === 'truck' ? 'trucks' : 'trailers')
            ->where('id', $id)
            ->update([
                'coi_verification_status' => $campos['status'] === self::ANULADA
                    ? 'manually_overridden'
                    : 'verified',
                'updated_at' => $ahora,
            ]);

        Audit::record(
            $actor,
            // Confirmar y anular no son el mismo hecho, así que no comparten
            // acción: la bitácora tiene que poder distinguir «vio el VIN en la
            // póliza» de «la puso en servicio a pesar de todo».
            $campos['status'] === self::ANULADA
                ? AuditAction::VerificationOverride
                : AuditAction::EquipmentVerified,
            entityType: 'equipment_verification',
            entityId: $verificacionId,
            entityLabel: $id,
            after: [
                'status' => $campos['status'],
                'equipmentType' => $type,
                'reason' => $campos['override_reason'] ?? null,
            ],
        );

        return $verificacionId;
    }
}
