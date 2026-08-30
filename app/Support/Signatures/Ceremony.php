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
        $anterior = DB::table('signature_audit_events')
            ->where('request_id', $requestId)
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->value('event_hash');

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
    public static function verifyChain(string $requestId): ?string
    {
        $eventos = DB::table('signature_audit_events')
            ->where('request_id', $requestId)
            ->orderBy('occurred_at')
            ->orderBy('id')
            ->get();

        $esperadoAnterior = null;

        foreach ($eventos as $e) {
            if (($e->previous_event_hash ?? null) !== $esperadoAnterior) {
                return (string) $e->id;
            }

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

            if (hash('sha256', (string) $esperadoAnterior.$canonico) !== (string) $e->event_hash) {
                return (string) $e->id;
            }

            $esperadoAnterior = (string) $e->event_hash;
        }

        return null;
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
