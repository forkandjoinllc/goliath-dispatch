<?php

declare(strict_types=1);

namespace App\Support\Tracking;

use App\Services\Tracking\PositionReport;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * El único sitio que escribe en `tracking_events`.
 *
 * ## Qué faltaba
 *
 * `tracking_events` llevaba vacía desde el primer día — no «poco usada»: sin una
 * sola escritura en todo el código—. Y a la vez `load_stops.actual_arrival_at`
 * se LEÍA en tres pantallas —la carga, el panel de rastreo y la página pública
 * del cliente— sin que nada ni nadie la escribiera nunca. O sea que al cliente
 * al que se le manda un enlace con la marca de su casa de despacho se le
 * enseñaba una lista de paradas donde todas ponían «pendiente» para siempre.
 *
 * Este es el sitio por donde entra todo lo que cambia eso, venga de un
 * proveedor o de una persona.
 *
 * ## Tres reglas que no se saltan
 *
 * **1. Sin consentimiento vigente no entra nada.** No es una comprobación de
 * cortesía en la puerta: es la frase que la pantalla del conductor le promete —
 * «se detiene de inmediato si el consentimiento se retira»—. `Sessions::
 * cerrarPorRetirada` ya cierra las sesiones al retirarlo; esto es el segundo
 * cerrojo, para el parte que llegue por webhook un segundo después de que la
 * sesión se cerrara. Se comprueba por cada parte, no una vez por lote.
 *
 * **2. La idempotencia la impone el ÍNDICE.** `unique (provider,
 * raw_provider_reference)`. Se usa `insertOrIgnore`, como en `Notifier`: un
 * proveedor que reintenta un webhook y un botón que se pulsa dos veces son el
 * camino NORMAL, no una excepción. Comprobar antes de insertar es la carrera
 * clásica de dos entregas simultáneas que las dos ven que no hay nada.
 *
 * **3. Nunca se inventa una posición.** `latitude` y `longitude` se escriben
 * solo si el parte las trae, y el adaptador deducido no las trae nunca. Ver
 * `PositionReport`.
 *
 * ## El resumen vive en la sesión, y es una caché
 *
 * `tracking_sessions` tiene `last_location_label`, `last_event_at`,
 * `route_progress_percent` y `health_status` desde el primer día. Son un resumen
 * derivable de los eventos, y se mantienen al escribir porque la página pública
 * los lee en cada visita: recalcular el avance recorriendo todos los eventos de
 * la sesión en una página sin sesión de usuario y con un token en la URL es
 * exactamente el sitio donde no conviene una consulta que crece.
 *
 * Que sea una caché quiere decir que se puede reconstruir, y `resumir()` es
 * pública para eso.
 */
final class Ingestion
{
    /** Quien reporta es una persona de despacho, no un proveedor. */
    public const MANUAL = 'manual';

    /**
     * Cuánto puede pasar sin noticias antes de que la sesión deje de estar sana.
     *
     * Dos horas y luego seis. No salen de ninguna norma: salen de que un camión
     * que lleva dos horas sin reportar puede estar en una zona sin cobertura, y
     * uno que lleva seis ya es un asunto de alguien. Se dicen aquí para que el
     * día que se afinen se afinen en un sitio.
     */
    public const HORAS_DESACTUALIZADO = 2;

    public const HORAS_PERDIDO = 6;

    /**
     * Meter partes de un proveedor en una sesión abierta.
     *
     * @param  list<PositionReport>  $partes
     * @return int  cuántos eran nuevos
     */
    public static function ingest(string $tenantId, string $sesionId, string $provider, array $partes): int
    {
        $sesion = DB::table('tracking_sessions')
            ->where('tenant_id', $tenantId)
            ->where('id', $sesionId)
            ->first();

        if ($sesion === null || $sesion->ended_at !== null) {
            return 0;
        }

        // Regla 1. La sesión guarda BAJO QUÉ consentimiento se abrió; lo que se
        // comprueba aquí es que ese permiso siga vigente ahora, que no es lo
        // mismo. Una sesión abierta ayer con un consentimiento retirado esta
        // mañana no admite un parte más.
        if (! self::consentida($tenantId, $sesion)) {
            return 0;
        }

        $escritos = 0;

        foreach ($partes as $parte) {
            $escritos += self::escribir($tenantId, $sesion, $provider, $parte);
        }

        if ($escritos > 0) {
            self::resumir($tenantId, $sesionId);
        }

        return $escritos;
    }

    /**
     * Un parte que da una persona: llegó a la parada, salió, o dijo por teléfono
     * dónde estaba.
     *
     * Va por su propia puerta porque NO exige sesión abierta y no puede
     * exigirla. Marcar que un camión llegó a su destino es un hecho operativo
     * que despacho anota con o sin rastreo por GPS, y hacerlo depender de una
     * sesión de proveedor sería atar la parte que funciona hoy a la que todavía
     * no existe. La sesión se rellena si la hay, y si no, no.
     *
     * Tampoco pasa por el consentimiento, y la razón es la contraria de la que
     * parece: el consentimiento del conductor es para que un aparato mande su
     * posición sola. Que un despachador escriba «llegó a Odessa a las 14:10» es
     * el registro de un hecho del viaje, no el seguimiento de una persona, y
     * hacerlo depender del permiso del conductor daría a entender que sin ese
     * permiso la carga tampoco se puede documentar.
     *
     * Estos partes se guardan con `session_id` nulo cuando no hay sesión
     * abierta — ver la migración que lo permitió y por qué.
     */
    public static function manual(string $tenantId, string $loadId, PositionReport $parte): int
    {
        $sesion = Sessions::abierta($tenantId, $loadId);

        $escritos = self::escribirFila(
            $tenantId,
            $loadId,
            $sesion?->id === null ? null : (string) $sesion->id,
            self::MANUAL,
            $parte,
        );

        if ($escritos > 0 && $sesion !== null) {
            self::resumir($tenantId, (string) $sesion->id);
        }

        return $escritos;
    }

    // ------------------------------------------------------------------ ayudas

    private static function consentida(string $tenantId, object $sesion): bool
    {
        if ($sesion->driver_id === null) {
            return false;
        }

        return Consent::permiteRastrear($tenantId, (string) $sesion->driver_id);
    }

    private static function escribir(string $tenantId, object $sesion, string $provider, PositionReport $parte): int
    {
        return self::escribirFila(
            $tenantId,
            (string) $sesion->load_id,
            (string) $sesion->id,
            $provider,
            $parte,
        );
    }

    private static function escribirFila(
        string $tenantId,
        string $loadId,
        ?string $sesionId,
        string $provider,
        PositionReport $parte,
    ): int {
        $ahora = CarbonImmutable::now();

        // Regla 2. `insertOrIgnore` contra `unique (provider,
        // raw_provider_reference)`.
        $insertadas = DB::table('tracking_events')->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'session_id' => $sesionId,
            'load_id' => $loadId,
            'provider' => $provider,
            'event_type' => $parte->eventType,
            // Regla 3. Solo lo que el parte traiga.
            'latitude' => $parte->latitude,
            'longitude' => $parte->longitude,
            'speed_mph' => $parte->speedMph,
            'heading_degrees' => $parte->headingDegrees,
            'location_label' => $parte->locationLabel,
            'stop_id' => $parte->stopId,
            'raw_provider_reference' => $parte->reference,
            'occurred_at' => $parte->occurredAt,
            'ingested_at' => $ahora,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        if ($insertadas === 1) {
            return 1;
        }

        /*
         * Cero no significa «ya estaba». Significa que MySQL descartó la fila, y
         * `insertOrIgnore` degrada a aviso TODOS los errores del INSERT, no solo
         * el choque contra el índice único: una columna que no admite nulos, un
         * valor fuera de una restricción CHECK, un tipo que no cabe. Los tres se
         * ven exactamente igual desde aquí.
         *
         * Costó un recorrido con navegador descubrirlo. La llegada a la parada
         * se guardaba, la pantalla decía «Anotado.», y la línea de tiempo se
         * quedaba vacía: la base de datos de desarrollo aún tenía `session_id`
         * como NOT NULL —faltaba correr la migración de este lote— y el INSERT
         * se descartaba en silencio. Ninguna prueba lo habría visto: en la de
         * pruebas la migración sí estaba.
         *
         * Así que se comprueba. Una consulta por el índice único, solo en el
         * camino del cero: si la fila está, era un duplicado y todo va bien; si
         * no está, la escritura falló y callarlo convierte esta clase en la que
         * dice que anotó cosas que no anotó.
         */
        $existe = DB::table('tracking_events')
            ->where('provider', $provider)
            ->where('raw_provider_reference', $parte->reference)
            ->exists();

        if (! $existe) {
            throw new \RuntimeException(
                'La base de datos descartó un suceso de rastreo y no fue por duplicado. '
                ."Proveedor: {$provider}, referencia: {$parte->reference}. "
                .'Suele ser una migración sin correr.'
            );
        }

        return 0;
    }

    /**
     * Rehacer el resumen de la sesión a partir de sus eventos.
     *
     * Pública porque es una caché y una caché tiene que poder reconstruirse.
     */
    public static function resumir(string $tenantId, string $sesionId): void
    {
        $sesion = DB::table('tracking_sessions')
            ->where('tenant_id', $tenantId)
            ->where('id', $sesionId)
            ->first(['load_id', 'ended_at']);

        if ($sesion === null) {
            return;
        }

        /*
         * Se resume por CARGA y no por sesión, y esto lo encontró el navegador:
         * el panel decía «aún no se ha reportado ninguna posición» justo encima
         * de una línea de tiempo que enseñaba la llegada al origen.
         *
         * Pasa siempre que se anota algo ANTES de abrir la sesión, que es el
         * orden normal —despacho documenta el viaje con o sin rastreo—: esos
         * sucesos se guardan sin sesión, y una sesión abierta después no los
         * veía. Una pantalla que se contradice con la de al lado es peor que
         * una vacía: la vacía se entiende.
         *
         * La sesión resume lo que se sabe de la carga que sigue, venga de donde
         * venga. Es lo mismo que lee la página del cliente.
         */
        /*
         * Solo los sucesos que dicen DÓNDE. Un «rastreo iniciado» es un suceso y
         * no es una posición, y contarlo aquí producía la pantalla incoherente
         * que salió en el recorrido: «aún no se ha reportado ninguna posición»
         * seguido de una hora, y la sesión en «saludable» sin que nadie hubiera
         * dicho dónde estaba el camión.
         *
         * Esto fija también qué mide la salud: el tiempo desde la última
         * POSICIÓN conocida, que es lo que quiere decir «señal perdida». Una
         * sesión abierta y sin una sola posición se queda en «desconocido», que
         * es exactamente su estado.
         */
        $ultimo = DB::table('tracking_events')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $sesion->load_id)
            ->whereNotNull('location_label')
            ->orderByDesc('occurred_at')
            ->first(['occurred_at', 'location_label', 'latitude', 'longitude']);

        if ($ultimo === null) {
            return;
        }

        DB::table('tracking_sessions')->where('id', $sesionId)->update([
            'last_event_at' => $ultimo->occurred_at,
            'last_location_label' => $ultimo->location_label,
            'last_latitude' => $ultimo->latitude,
            'last_longitude' => $ultimo->longitude,
            'route_progress_percent' => self::avance($tenantId, (string) $sesion->load_id),
            'health_status' => self::salud(
                $sesion->ended_at !== null,
                CarbonImmutable::parse((string) $ultimo->occurred_at),
            ),
            'updated_at' => CarbonImmutable::now(),
        ]);
    }

    /**
     * Cuánto del viaje se ha hecho, contado en PARADAS.
     *
     * Millas sería lo natural y no se puede: `StopDerivedRouteProvider` devuelve
     * `totalMiles = null` a propósito porque nadie ha calculado la ruta, y un
     * porcentaje sobre una distancia inventada sería una barra de progreso que
     * miente con precisión decimal.
     *
     * Se devuelven las DOS cifras y no un porcentaje, y esto costó una segunda
     * lectura de mi propia pantalla: «50 % del recorrido completado» con el
     * camión recién llegado a la recogida es falso —el recorrido no ha empezado—
     * mientras que «1 de 2 paradas» es exactamente lo que se sabe. La fracción
     * era honesta; la frase que la envolvía, no. Los diccionarios se cambiaron
     * para decir paradas.
     *
     * @return array{done: int, total: int}
     */
    public static function paradas(string $tenantId, string $loadId): array
    {
        $paradas = DB::table('load_stops')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->whereNull('deleted_at')
            ->get(['actual_arrival_at']);

        return [
            'done' => $paradas->filter(static fn (object $s): bool => $s->actual_arrival_at !== null)->count(),
            'total' => $paradas->count(),
        ];
    }

    /**
     * La misma fracción en tanto por ciento, que es lo que cabe en la columna.
     *
     * `tracking_sessions.route_progress_percent` se llama «route» y guarda
     * paradas. El nombre de una columna no es una especificación: la columna
     * nació esperando un porcentaje de ruta que nadie ha calculado nunca, y
     * dejarla vacía para siempre por respeto a su nombre no habría hecho más
     * honesta a la aplicación. Lo que se enseña son las paradas; esto es la
     * caché.
     */
    public static function avance(string $tenantId, string $loadId): ?int
    {
        ['done' => $hechas, 'total' => $total] = self::paradas($tenantId, $loadId);

        if ($total === 0) {
            return null;
        }

        return (int) round($hechas / $total * 100);
    }

    /**
     * Cómo de viva está la sesión.
     *
     * `unknown` no aparece aquí: es el estado con el que nace una sesión a la
     * que todavía no ha llegado un solo parte, y esto solo corre cuando ha
     * llegado alguno.
     */
    public static function salud(bool $terminada, CarbonImmutable $ultimo): string
    {
        if ($terminada) {
            return 'ended';
        }

        $horas = $ultimo->diffInHours(CarbonImmutable::now());

        return match (true) {
            $horas >= self::HORAS_PERDIDO => 'lost',
            $horas >= self::HORAS_DESACTUALIZADO => 'stale',
            default => 'healthy',
        };
    }
}
