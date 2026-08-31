<?php

declare(strict_types=1);

namespace App\Support\Signatures;

use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * La bitácora de la ceremonia de firma: qué pasó, en qué orden, y encadenado.
 *
 * `signature_audit_events` tiene dos disparadores en MySQL que rechazan UPDATE
 * y DELETE, así que las filas no se pueden tocar una vez escritas. Eso impide
 * MODIFICAR un evento, pero no impide QUITAR uno del medio con acceso directo
 * al servidor —desactivando el disparador— ni insertar uno inventado al final.
 * De ahí la cadena: cada evento guarda `sha256(hash_del_anterior || canónico
 * de este)`. Quitar un evento deja al siguiente apuntando a un hash que ya no
 * existe; alterar uno cambia su hash y descuadra todos los posteriores.
 *
 * Lo que la cadena NO hace, para no venderla de más: no está firmada con una
 * clave, así que quien pueda escribir en la tabla y sepa cómo se calcula podría
 * recalcular la cadena entera. Contra eso está el sello del registro, que sí
 * lleva clave. La cadena detecta manipulación torpe y desorden; el sello
 * detecta manipulación deliberada del hecho firmado.
 */
final class Ceremony
{
    public const REQUESTED = 'requested';
    public const EMAILED = 'emailed';
    public const OPENED = 'opened';
    public const VIEWED = 'viewed';
    public const CONSENT_SHOWN = 'consent_shown';
    public const CONSENT_ACCEPTED = 'consent_accepted';
    public const SIGNATURE_CAPTURED = 'signature_captured';
    public const DOCUMENT_GENERATED = 'document_generated';
    public const SEALED = 'sealed';
    public const EMAILED_COPY = 'emailed_copy';
    public const DECLINED = 'declined';
    public const VOIDED = 'voided';
    public const SUPERSEDED = 'superseded';
    public const CERTIFICATE_DOWNLOADED = 'certificate_downloaded';

    /**
     * Anota un evento al final de la cadena de una solicitud.
     *
     * @param  array<string, mixed>|null  $detail
     */
    public static function record(
        string $tenantId,
        string $requestId,
        string $eventType,
        ?string $recordId = null,
        ?string $actorUserId = null,
        ?string $actorEmail = null,
        ?Request $request = null,
        ?array $detail = null,
    ): string {
        // La cola de la cadena se busca siguiendo los ENLACES, no ordenando por
        // la hora. `occurred_at` es datetime(3) y dos eventos de la misma
        // ceremonia caen en el mismo milisegundo con toda facilidad —abrir el
        // enlace escribe `opened` y `viewed` seguidos—; con la hora empatada, el
        // desempate era el UUID, que es aleatorio. Escribir y verificar podían
        // entonces recorrer la cadena en órdenes DISTINTOS, y la verificación
        // fallaba en una firma perfectamente sana según qué UUID hubiera tocado.
        //
        // Una cadena de hashes se recorre por sus enlaces. La cola es el evento
        // al que no apunta ningún otro.
        $anterior = self::tailHash($requestId);

        $id = (string) Str::uuid();
        $ocurrido = CarbonImmutable::now();

        // La IP y el navegador se guardan porque son parte de la evidencia de
        // cómo se capturó la firma, y el diccionario portado lo promete en la
        // pantalla: «quién firmó, cuándo, desde qué dispositivo y dirección IP».
        $ip = $request?->ip();
        $agente = $request?->userAgent();

        $canonico = Seal::canonical([
            'actorEmail' => (string) $actorEmail,
            'eventType' => $eventType,
            'id' => $id,
            'ip' => (string) $ip,
            'occurredAt' => $ocurrido->format('Y-m-d H:i:s.v'),
            'recordId' => (string) $recordId,
            'requestId' => $requestId,
            // El detalle entra ordenado por clave para que la cadena no dependa
            // del orden en que quien llama construyó el array.
            'detail' => self::detailCanonical($detail),
        ]);

        $hash = hash('sha256', (string) $anterior.$canonico);

        DB::table('signature_audit_events')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'request_id' => $requestId,
            'record_id' => $recordId,
            'event_type' => $eventType,
            'actor_user_id' => $actorUserId,
            'actor_email' => $actorEmail,
            'ip_address' => $ip,
            'user_agent' => $agente,
            'detail' => $detail === null ? null : json_encode($detail, JSON_UNESCAPED_UNICODE),
            'previous_event_hash' => $anterior,
            'event_hash' => $hash,
            'occurred_at' => $ocurrido,
            'created_at' => $ocurrido,
            'updated_at' => $ocurrido,
        ]);

        return $id;
    }

    /**
     * Recalcula la cadena de una solicitud y devuelve el id del primer evento
     * que no cuadra, o null si está entera.
     *
     * Se recalcula, no se comprueba una bandera: una bandera guardada la puede
     * poner en verde el mismo `update` que rompió lo que decía proteger.
     */
    /**
     * Recalcula la cadena de una solicitud y devuelve el id del primer evento
     * que no cuadra, o null si está entera.
     *
     * Se CAMINA por los enlaces en vez de ordenar por la hora, por el motivo
     * explicado en `record()`. Al final se comprueba que no haya quedado ningún
     * evento sin visitar: un evento suelto —o una bifurcación, dos eventos
     * apuntando al mismo anterior— es tan sospechoso como un hash que no cuadra,
     * y ordenando por la hora habría pasado desapercibido.
     */
    public static function verifyChain(string $requestId): ?string
    {
        $eventos = DB::table('signature_audit_events')
            ->where('request_id', $requestId)
            ->get()
            ->keyBy(static fn (object $e): string => (string) $e->id);

        if ($eventos->isEmpty()) {
            return null;
        }

        /** @var list<object> $raices */
        $raices = $eventos->filter(static fn (object $e): bool => $e->previous_event_hash === null)
            ->values()
            ->all();

        // Ni cero raíces (todos apuntan a algo: falta el primero) ni dos.
        if (count($raices) !== 1) {
            return (string) $eventos->first()->id;
        }

        /** @var array<string, object> $porAnterior */
        $porAnterior = [];

        foreach ($eventos as $e) {
            $clave = (string) $e->previous_event_hash;

            if (isset($porAnterior[$clave])) {
                // Dos eventos con el mismo anterior: la cadena se bifurca.
                return (string) $e->id;
            }

            $porAnterior[$clave] = $e;
        }

        $actual = $raices[0];
        $visitados = 0;
        $esperadoAnterior = null;

        while (true) {
            if (self::hashOf($actual) !== (string) $actual->event_hash) {
                return (string) $actual->id;
            }

            if (($actual->previous_event_hash ?? null) !== $esperadoAnterior) {
                return (string) $actual->id;
            }

            $visitados++;
            $esperadoAnterior = (string) $actual->event_hash;

            if (! isset($porAnterior[$esperadoAnterior])) {
                break;
            }

            $actual = $porAnterior[$esperadoAnterior];
        }

        // Alguien quedó fuera del recorrido: hay un evento que no cuelga de la
        // cadena. Se devuelve el primero de los huérfanos.
        if ($visitados !== $eventos->count()) {
            foreach ($eventos as $e) {
                if ((string) $e->previous_event_hash !== '' && ! self::reachable($e, $porAnterior, $raices[0])) {
                    return (string) $e->id;
                }
            }

            return (string) $eventos->first()->id;
        }

        return null;
    }

    /** El hash de la cola: el evento al que no apunta ningún otro. */
    private static function tailHash(string $requestId): ?string
    {
        $eventos = DB::table('signature_audit_events')
            ->where('request_id', $requestId)
            ->get(['event_hash', 'previous_event_hash']);

        if ($eventos->isEmpty()) {
            return null;
        }

        $apuntados = $eventos->pluck('previous_event_hash')->filter()->all();

        foreach ($eventos as $e) {
            if (! in_array((string) $e->event_hash, $apuntados, true)) {
                return (string) $e->event_hash;
            }
        }

        // No debería ocurrir (sería un ciclo). Se contesta con la cola que diría
        // la hora antes que devolver null y empezar una segunda cadena.
        return (string) $eventos->last()->event_hash;
    }

    /** Recalcula el hash que le corresponde a una fila. */
    private static function hashOf(object $e): string
    {
        $detalle = $e->detail === null
            ? null
            : json_decode((string) $e->detail, true, 512, JSON_THROW_ON_ERROR);

        $canonico = Seal::canonical([
            'actorEmail' => (string) $e->actor_email,
            'eventType' => (string) $e->event_type,
            'id' => (string) $e->id,
            'ip' => (string) $e->ip_address,
            'occurredAt' => CarbonImmutable::parse((string) $e->occurred_at)->format('Y-m-d H:i:s.v'),
            'recordId' => (string) $e->record_id,
            'requestId' => (string) $e->request_id,
            'detail' => self::detailCanonical(is_array($detalle) ? $detalle : null),
        ]);

        return hash('sha256', (string) $e->previous_event_hash.$canonico);
    }

    /** @param array<string, object> $porAnterior */
    private static function reachable(object $e, array $porAnterior, object $raiz): bool
    {
        $actual = $raiz;

        for ($i = 0, $tope = count($porAnterior) + 1; $i < $tope; $i++) {
            if ((string) $actual->id === (string) $e->id) {
                return true;
            }

            $siguiente = $porAnterior[(string) $actual->event_hash] ?? null;

            if ($siguiente === null) {
                return false;
            }

            $actual = $siguiente;
        }

        return false;
    }

    /** @param array<string, mixed>|null $detail */
    private static function detailCanonical(?array $detail): string
    {
        if ($detail === null || $detail === []) {
            return '';
        }

        ksort($detail);

        return json_encode($detail, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
    }
}
