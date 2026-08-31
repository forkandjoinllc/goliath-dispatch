<?php

declare(strict_types=1);

namespace App\Support\Routing;

/**
 * De dónde sale el recorrido de una carga.
 *
 * Es una interfaz porque hoy no hay proveedor de rutas y mañana lo habrá — y
 * porque la especificación lo pide: «los servicios externos usan interfaces de
 * proveedor y adaptadores simulados cuando no hay credenciales». El propio
 * esquema lo daba por hecho: `routes.provider` viene con `default 'mock'`.
 *
 * Lo que un proveedor de verdad añadirá y el simulado no puede dar: las millas
 * reales, la polilínea del mapa, los peajes, y —lo que más importa aquí— los
 * estados que la ruta cruza DE VERDAD, incluidos los de paso. El simulado solo
 * sabe de dónde sale y a dónde llega.
 */
interface RouteProvider
{
    /**
     * Calcula el recorrido de una carga a partir de sus paradas.
     *
     * @param  list<array{city: string|null, state: string|null, sequence: int}>  $stops
     * @return array{
     *     provider: string,
     *     totalMiles: int|null,
     *     estimatedDurationMinutes: int|null,
     *     estimatedTollCents: int|null,
     *     polyline: string|null,
     *     legs: list<array<string, mixed>>,
     *     states: list<array{state: string, sequence: int, milesInState: int|null}>,
     *     warnings: list<string>,
     * }
     */
    public function calculate(array $stops): array;

    /** El nombre que se guarda en `routes.provider`. */
    public function name(): string;
}
