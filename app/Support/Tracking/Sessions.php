<?php

declare(strict_types=1);

namespace App\Support\Tracking;

use App\Authorization\Actor;
use App\Services\Tracking\PositionReport;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Las sesiones de rastreo: cuándo empieza y cuándo para el seguimiento de una
 * carga, y bajo qué consentimiento.
 *
 * ## Qué es una sesión aquí, y qué no
 *
 * Una sesión es el hecho de que ESTA carga está siendo seguida, con ESTE
 * conductor, bajo ESTE consentimiento. No PRODUCE posiciones: el proveedor de
 * GPS —Trucker Tools, MacroPoint, Highway— sigue sin estar conectado, y una
 * sesión que fingiera posiciones sería peor que no tenerla.
 *
 * Lo que sí hace, y es todo el punto de la sesión, es SER LO QUE EL
 * CONSENTIMIENTO ABRE Y CIERRA. Sin una sesión que arrancar, «el rastreo no
 * puede iniciarse sin consentimiento» no tiene sujeto.
 *
 * Desde el lote de la ingesta la sesión además RESUME lo que se sabe de la
 * carga —última posición, salud, paradas hechas— para que la página del cliente
 * no tenga que recorrer todos los sucesos en cada visita. Ese resumen es una
 * caché de `tracking_events` y se reconstruye con `Ingestion::resumir`; abrir
 * una sesión lo rellena con lo que ya hubiera, que es lo que evita que el panel
 * diga «aún no se ha reportado ninguna posición» encima de una que sí está.
 *
 * ## El consentimiento queda escrito EN la sesión
 *
 * `tracking_sessions` lleva `consent_granted_at`, `consent_revoked_at` y
 * `consent_user_id` desde el primer día. Se rellenan: la sesión guarda bajo qué
 * consentimiento se abrió, no solo que lo hubiera. Dentro de un año, la pregunta
 * «¿con qué permiso se siguió a esta persona el 12 de marzo?» se contesta
 * mirando la sesión, sin tener que reconstruir el estado de otra tabla en esa
 * fecha.
 */
final class Sessions
{
    /** La sesión abierta de una carga, si la hay. */
    public static function abierta(string $tenantId, string $loadId): ?object
    {
        return DB::table('tracking_sessions')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->whereNull('ended_at')
            ->orderByDesc('started_at')
            ->first();
    }

    /**
     * Arrancar el rastreo de una carga.
     *
     * @throws \RuntimeException con el motivo, cuando no se puede
     */
    public static function iniciar(Actor $actor, string $loadId, string $driverId, ?string $truckId): string
    {
        $tenantId = (string) $actor->tenantId;

        if (! Consent::permiteRastrear($tenantId, $driverId)) {
            throw new \RuntimeException('trackingConsentMissing');
        }

        if (self::abierta($tenantId, $loadId) !== null) {
            throw new \RuntimeException('alreadyStarted');
        }

        $userId = Consent::cuentaDe($tenantId, $driverId);
        $consentimiento = $userId === null ? null : Consent::ultimo($tenantId, $userId);
        $id = (string) Str::uuid();
        $ahora = CarbonImmutable::now();

        DB::table('tracking_sessions')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'load_id' => $loadId,
            'driver_id' => $driverId,
            'truck_id' => $truckId,
            'provider' => 'mock',
            // Bajo qué consentimiento se abrió, no solo que lo hubiera.
            'consent_granted_at' => $consentimiento?->created_at,
            'consent_user_id' => $userId,
            'started_at' => $ahora,
            'health_status' => 'unknown',
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        // El comienzo, en la línea de tiempo. Usa `event.session_started`, que el
        // diccionario portado ya traía traducido en los dos idiomas.
        Ingestion::manual($tenantId, $loadId, new PositionReport(
            eventType: 'session_started',
            occurredAt: $ahora,
            reference: "session:{$id}:started",
        ));

        // Y se adopta lo que ya se sabía de la carga. Sin esto, una sesión
        // abierta después de anotar la llegada nacía diciendo «aún no se ha
        // reportado ninguna posición» encima de una línea de tiempo que sí la
        // enseñaba.
        Ingestion::resumir($tenantId, $id);

        return $id;
    }

    /** Pararlo a mano. */
    public static function detener(string $tenantId, string $loadId): bool
    {
        $sesion = self::abierta($tenantId, $loadId);

        if ($sesion === null) {
            return false;
        }

        $ahora = CarbonImmutable::now();

        DB::table('tracking_sessions')->where('id', $sesion->id)->update([
            'ended_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        Ingestion::manual($tenantId, $loadId, new PositionReport(
            eventType: 'session_ended',
            occurredAt: $ahora,
            reference: "session:{$sesion->id}:ended",
        ));

        return true;
    }

    /**
     * Retirado el consentimiento, se cierra todo lo que dependía de él.
     *
     * Dos cosas, y la segunda es la que se olvida: se cierran las sesiones
     * abiertas de este conductor Y se revocan los enlaces públicos vivos de esas
     * cargas. Un enlace público es cómo un cliente ve dónde está el camión; dejar
     * el enlace en pie después de que la persona retire el permiso pararía el
     * rastreo por dentro y lo seguiría enseñando por fuera, que es exactamente lo
     * que la frase de la pantalla promete que no pasa.
     *
     * @return int sesiones cerradas
     */
    public static function cerrarPorRetirada(Actor $actor): int
    {
        $ahora = CarbonImmutable::now();

        return app(TenantContext::class)->withoutTenant(function () use ($actor, $ahora): int {
            $sesiones = DB::table('tracking_sessions')
                ->where('consent_user_id', $actor->userId)
                ->whereNull('ended_at')
                ->get(['id', 'load_id', 'tenant_id']);

            if ($sesiones->isEmpty()) {
                return 0;
            }

            DB::table('tracking_sessions')
                ->whereIn('id', $sesiones->pluck('id'))
                ->update([
                    'ended_at' => $ahora,
                    'consent_revoked_at' => $ahora,
                    'updated_at' => $ahora,
                ]);

            DB::table('public_tracking_links')
                ->whereIn('load_id', $sesiones->pluck('load_id'))
                ->whereNull('revoked_at')
                ->whereNull('deleted_at')
                ->update(['revoked_at' => $ahora, 'updated_at' => $ahora]);

            return $sesiones->count();
        });
    }
}
