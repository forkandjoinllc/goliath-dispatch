<?php

declare(strict_types=1);

namespace App\Services\Tracking;

use Carbon\CarbonImmutable;

/**
 * El adaptador que funciona sin credenciales, y hay que ser muy claro con lo que
 * sabe y lo que no. Hermano de `StopDerivedRouteProvider`, y por la misma razón.
 *
 *  - **SABE por dónde tiene que pasar el camión**, porque las paradas están
 *    escritas en la carga y llevan ciudad y estado. Un Laredo → Odessa recoge en
 *    Laredo y entrega en Odessa; eso es cierto.
 *  - **NO SABE dónde está el camión.** Nadie se lo dice. Por eso este proveedor
 *    NO reporta nada solo: `poll()` devuelve siempre la lista vacía y
 *    `isLive()` es falso. La pantalla enseña que no hay proveedor conectado en
 *    vez de una sesión abierta que aparenta estar escuchando.
 *  - **NO SABE ninguna coordenada.** Las paradas tienen `latitude` y
 *    `longitude` y están vacías en toda la aplicación. Este adaptador las deja
 *    nulas. Un punto interpolado entre dos ciudades sin coordenadas sería una
 *    invención con forma de mapa, que es la peor de todas.
 *
 * Lo único que hace de más es `simulate()`, que es una HERRAMIENTA DE
 * DESARROLLO y el diccionario portado ya la describía: avanza el camión
 * imaginario por la secuencia de paradas para poder ver la pantalla del cliente
 * con algo dentro. Cada suceso que produce queda escrito con `provider = 'mock'`
 * y la pantalla lo dice; nadie puede confundir esto con un camión.
 */
final class StopDerivedTrackingProvider implements TrackingProvider
{
    public const NOMBRE = 'mock';

    /**
     * Cuánto tiempo imaginario separa un suceso simulado del siguiente.
     *
     * Una hora entre sucesos no pretende parecerse a un viaje real —un Laredo →
     * Chicago no son cuatro horas— sino producir una línea de tiempo legible en
     * una pantalla de prueba. Que sea obviamente redondo ayuda a que nadie la
     * lea como una estimación.
     */
    public const MINUTOS_ENTRE_SUCESOS = 60;

    public function name(): string
    {
        return self::NOMBRE;
    }

    public function isLive(): bool
    {
        return false;
    }

    /** @inheritDoc */
    public function poll(array $sesion): array
    {
        // Nadie manda nada. Devolver aquí una posición inventada sería justo lo
        // que esta clase existe para no hacer.
        return [];
    }

    /**
     * La secuencia completa de sucesos que TENDRÍA un viaje por estas paradas.
     *
     * Se calcula entera y siempre igual, y luego se corta por el tiempo
     * transcurrido. Que sea completa y determinista es lo que hace que la
     * referencia de cada suceso —«el número 4 de esta sesión»— sirva de clave de
     * idempotencia: dos pulsaciones seguidas del mismo botón producen las mismas
     * referencias y la segunda choca contra el índice único en vez de duplicar
     * la línea de tiempo.
     *
     * @param  list<array{id: string, stop_type: string, city: ?string, state: ?string}>  $paradas
     * @return list<PositionReport>
     */
    public function simulate(string $sesionId, array $paradas, CarbonImmutable $desde, int $minutos): array
    {
        $partes = [];
        $indice = 0;

        foreach ($paradas as $parada) {
            $lugar = self::lugar($parada);
            $tipo = $parada['stop_type'] === 'pickup' ? 'pickup' : 'delivery';

            // Camino a la parada. Es lo único que se puede decir con verdad de
            // un camión entre dos ciudades cuando no se conoce su posición:
            // hacia dónde va. No dónde está.
            $partes[] = self::parte($sesionId, $indice++, 'location_update', $desde, $lugar, $parada['id'], enTransito: true);
            $partes[] = self::parte($sesionId, $indice++, "arrived_{$tipo}", $desde, $lugar, $parada['id']);
            $partes[] = self::parte($sesionId, $indice++, "departed_{$tipo}", $desde, $lugar, $parada['id']);
        }

        // La última parada no se abandona: entregar es el final del viaje, no un
        // sitio del que se sale hacia ninguna parte.
        array_pop($partes);

        $limite = (int) floor($minutos / self::MINUTOS_ENTRE_SUCESOS);

        return array_slice($partes, 0, max(0, $limite));
    }

    /** @param array{city: ?string, state: ?string} $parada */
    private static function lugar(array $parada): ?string
    {
        $partes = array_filter([$parada['city'] ?? null, $parada['state'] ?? null]);

        return $partes === [] ? null : implode(', ', $partes);
    }

    private static function parte(
        string $sesionId,
        int $indice,
        string $tipo,
        CarbonImmutable $desde,
        ?string $lugar,
        string $stopId,
        bool $enTransito = false,
    ): PositionReport {
        return new PositionReport(
            eventType: $tipo,
            occurredAt: $desde->addMinutes($indice * self::MINUTOS_ENTRE_SUCESOS),
            // El índice y no la hora: la hora cambia cada vez que se pulsa el
            // botón, y entonces la idempotencia no idempotaría nada.
            reference: "sim:{$sesionId}:{$indice}",
            // Una etiqueta y nunca un punto. `enTransito` cambia lo que se dice
            // del mismo lugar: «hacia Laredo, TX» no es «en Laredo, TX», y
            // decir lo segundo cuando solo se sabe lo primero es el error que
            // esta clase tiene prohibido cometer.
            //
            // La flecha y no la palabra «hacia», y esto no es estética:
            // `location_label` se GUARDA, y lo lee un cliente que puede estar en
            // el otro idioma. Un nombre de ciudad y una flecha se leen igual en
            // los dos; «hacia Laredo, TX» guardado en español se le enseñaría en
            // español a quien abrió la página en inglés. Lo único traducible de
            // un suceso es su TIPO, que sí viaja como clave y se traduce al
            // pintarlo — ver `tracking.event.*`.
            locationLabel: $lugar === null ? null : ($enTransito ? "→ {$lugar}" : $lugar),
            stopId: $stopId,
        );
    }
}
