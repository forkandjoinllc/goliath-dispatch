<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * Cuán lejos llega una concesión.
 *
 * Portado literalmente de src/lib/permissions/types.ts. El orden de `rank()` es
 * significativo: cuando un rol y una excepción por usuario conceden el mismo
 * permiso, gana el ámbito más ancho.
 */
enum Scope: string
{
    /** Toda la plataforma, cualquier empresa. Solo Super Admin. */
    case Platform = 'platform';

    /** Todo lo que hay dentro de la empresa en la que se está actuando. */
    case Tenant = 'tenant';

    /** Solo lo que alcanza una asignación explícita al despachador. */
    case Assigned = 'assigned';

    /** Solo lo que pertenece a la empresa transportista del actor. */
    case Carrier = 'carrier';

    /** Solo lo que el actor posee o creó personalmente. */
    case Own = 'own';

    public function rank(): int
    {
        return match ($this) {
            self::Own => 1,
            self::Carrier => 2,
            self::Assigned => 3,
            self::Tenant => 4,
            self::Platform => 5,
        };
    }

    /** Verdadero si este ámbito es al menos tan ancho como $other. */
    public function atLeast(self $other): bool
    {
        return $this->rank() >= $other->rank();
    }
}
