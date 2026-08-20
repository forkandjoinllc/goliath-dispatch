<?php

declare(strict_types=1);

namespace App\Authorization;

/**
 * Lo que un despachador tiene asignado explícitamente.
 *
 * Se resuelve una vez por petición al construir el Actor y luego se consulta en
 * memoria. Nunca se calcula dentro de una comprobación de permiso: `can()` debe
 * poder llamarse en un bucle de renderizado sin tocar la base de datos.
 */
final readonly class AssignmentScope
{
    /**
     * @param  list<string>  $carrierIds  transportistas con asignación activa
     * @param  list<string>  $truckIds  camiones concedidos, directamente o vía grupo
     * @param  list<string>  $trailerIds
     * @param  list<string>  $driverIds
     * @param  list<string>  $groupIds
     */
    public function __construct(
        public array $carrierIds = [],
        public array $truckIds = [],
        public array $trailerIds = [],
        public array $driverIds = [],
        public array $groupIds = [],
    ) {}

    public static function empty(): self
    {
        return new self;
    }

    public function isEmpty(): bool
    {
        return $this->carrierIds === []
            && $this->truckIds === []
            && $this->trailerIds === []
            && $this->driverIds === []
            && $this->groupIds === [];
    }
}
