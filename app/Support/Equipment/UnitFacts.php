<?php

declare(strict_types=1);

namespace App\Support\Equipment;

use Carbon\CarbonImmutable;

/**
 * Lo que se sabe de un camión o un remolque, sin la base de datos delante.
 *
 * Existe para que App\Support\Equipment\Eligibility pueda ser una función pura,
 * por el mismo motivo que DriverFacts: una regla que necesita una consulta para
 * contestar se convierte en un N+1 en cuanto se pinta una lista de veinte
 * unidades, y no se puede probar sin montar filas.
 */
final class UnitFacts
{
    public function __construct(
        public readonly string $unitNumber,
        public readonly string $status,
        public readonly ?CarbonImmutable $nextInspectionDueAt,
        public readonly ?CarbonImmutable $registrationExpiresAt,
        /**
         * Los lados que faltan por fotografiar. Vacío significa que están los
         * cuatro; ver App\Support\Equipment\Media.
         *
         * Se pasa como dato y no se consulta aquí dentro para que la regla siga
         * siendo pura: una lista de veinte unidades son dos consultas, no
         * cuarenta.
         *
         * @var list<string>
         */
        public readonly array $missingAngles = [],
    ) {}

    /** @param  list<string>  $missingAngles */
    public static function fromRow(object $fila, array $missingAngles = []): self
    {
        $fecha = static fn (mixed $v): ?CarbonImmutable => $v === null || $v === ''
            ? null
            : CarbonImmutable::parse((string) $v);

        return new self(
            unitNumber: (string) ($fila->unit_number ?? ''),
            status: (string) ($fila->status ?? ''),
            nextInspectionDueAt: $fecha($fila->next_inspection_due_at ?? null),
            registrationExpiresAt: $fecha($fila->registration_expires_at ?? null),
            missingAngles: $missingAngles,
        );
    }
}
