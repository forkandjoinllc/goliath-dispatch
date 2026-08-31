<?php

declare(strict_types=1);

namespace App\Support\Routing;

/**
 * El recorrido deducido de las paradas, sin salir a preguntarle a nadie.
 *
 * Es el adaptador que funciona sin credenciales, y hay que ser muy claro con lo
 * que sabe y lo que no:
 *
 *  - **SABE** en qué estados están las paradas, porque están escritas en la
 *    carga. Un Laredo → Odessa cruza Texas, y eso es cierto.
 *  - **NO SABE los estados de paso.** Un Laredo → Chicago pasa por Oklahoma,
 *    Kansas o Arkansas según por dónde vaya, y esto no tiene forma de saberlo.
 *    Devuelve solo TX e IL, y AVISA de ello. Esa advertencia viaja hasta la
 *    pantalla y hasta `oversize_evaluations.missing_data_warnings`, porque una
 *    evaluación de permisos con estados de menos es peor que ninguna: da
 *    tranquilidad sobre un recorrido que no se ha mirado.
 *  - **NO SABE las millas.** Devuelve null. Inventar una distancia en línea
 *    recta la haría parecer un dato, y `loads.miles` ya existe para que la
 *    escriba una persona.
 *
 * Todo eso se guarda con `provider = 'mock'`, que es exactamente lo que el
 * esquema pone por defecto.
 */
final class StopDerivedRouteProvider implements RouteProvider
{
    public const NOMBRE = 'mock';

    /** Faltan estados de paso porque nadie ha calculado la ruta de verdad. */
    public const AVISO_ESTADOS_DE_PASO = 'throughStatesUnknown';

    /** Alguna parada no dice en qué estado está. */
    public const AVISO_ESTADO_SIN_ESCRIBIR = 'stopWithoutState';

    public function name(): string
    {
        return self::NOMBRE;
    }

    /** @inheritDoc */
    public function calculate(array $stops): array
    {
        usort($stops, static fn (array $a, array $b): int => $a['sequence'] <=> $b['sequence']);

        $estados = [];
        $avisos = [];
        $secuencia = 0;
        $faltaAlguno = false;

        foreach ($stops as $parada) {
            $estado = $parada['state'] ?? null;

            if ($estado === null || $estado === '') {
                $faltaAlguno = true;

                continue;
            }

            $estado = mb_strtoupper($estado);

            // Dos paradas seguidas en el mismo estado no son dos tramos. El
            // índice único de `route_states` es (route_id, state_code, sequence)
            // y admitiría el duplicado, pero evaluar Texas dos veces no dice
            // nada nuevo y le dobla la lista a quien la lee.
            if ($estados !== [] && end($estados)['state'] === $estado) {
                continue;
            }

            $estados[] = [
                'state' => $estado,
                'sequence' => $secuencia++,
                // Sin ruta de verdad no hay millas por estado. Null y no cero:
                // cero diría que no se recorre nada en ese estado.
                'milesInState' => null,
            ];
        }

        if ($faltaAlguno) {
            $avisos[] = self::AVISO_ESTADO_SIN_ESCRIBIR;
        }

        // Si hay más de un estado, hay recorrido entre ellos y ese recorrido
        // pasa por sitios que esto no conoce.
        if (count($estados) > 1) {
            $avisos[] = self::AVISO_ESTADOS_DE_PASO;
        }

        return [
            'provider' => self::NOMBRE,
            'totalMiles' => null,
            'estimatedDurationMinutes' => null,
            'estimatedTollCents' => null,
            'polyline' => null,
            'legs' => [],
            'states' => $estados,
            'warnings' => $avisos,
        ];
    }
}
