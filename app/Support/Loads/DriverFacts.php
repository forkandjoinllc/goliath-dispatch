<?php

declare(strict_types=1);

namespace App\Support\Loads;

use Carbon\CarbonImmutable;

/**
 * Lo que se sabe de un conductor, en la forma que necesita la comparación.
 *
 * Existe para que DriverEligibility sea una función pura: se le pasan hechos y
 * requisitos, devuelve un veredicto, y se puede probar sin base de datos. La
 * alternativa —que la comparación consulte por su cuenta— la haría imposible de
 * probar y muy fácil de convertir en un N+1 dentro de una lista de conductores.
 */
final readonly class DriverFacts
{
    /**
     * @param  list<string>  $endorsements
     */
    public function __construct(
        public bool $twicCard = false,
        public ?CarbonImmutable $twicExpiresAt = null,
        public array $endorsements = [],
        /** Verdadero si de la licencia se sabe ALGO. Ver `endorsementsAreAuthoritative`. */
        public bool $licenceOnFile = false,
        public ?string $workAuthorization = null,
        public ?int $recordCleanYears = null,
        public ?CarbonImmutable $recordCheckedAt = null,
    ) {}

    /**
     * @param  object{twic_card?: mixed, twic_expires_at?: mixed, endorsements?: mixed, cdl_class?: mixed, license_state?: mixed, license_expires_at?: mixed, work_authorization?: mixed, record_clean_years?: mixed, record_checked_at?: mixed}  $row
     */
    public static function fromRow(object $row): self
    {
        $endorsements = $row->endorsements ?? [];

        if (is_string($endorsements)) {
            $decoded = json_decode($endorsements, true);
            $endorsements = is_array($decoded) ? $decoded : [];
        }

        return new self(
            twicCard: (bool) ($row->twic_card ?? false),
            twicExpiresAt: self::fecha($row->twic_expires_at ?? null),
            endorsements: array_values(array_map(
                static fn ($e): string => strtoupper((string) $e),
                is_array($endorsements) ? $endorsements : [],
            )),
            // Una lista de endosos vacía en un conductor del que no se sabe NADA
            // de su licencia no significa «no tiene endosos»: significa que
            // nadie ha metido la licencia todavía.
            licenceOnFile: ($row->cdl_class ?? null) !== null
                || ($row->license_state ?? null) !== null
                || ($row->license_expires_at ?? null) !== null,
            workAuthorization: self::texto($row->work_authorization ?? null),
            recordCleanYears: isset($row->record_clean_years) && $row->record_clean_years !== null
                ? (int) $row->record_clean_years
                : null,
            recordCheckedAt: self::fecha($row->record_checked_at ?? null),
        );
    }

    private static function fecha(mixed $v): ?CarbonImmutable
    {
        if ($v === null || $v === '') {
            return null;
        }

        if ($v instanceof CarbonImmutable) {
            return $v;
        }

        try {
            return CarbonImmutable::parse(is_object($v) ? (string) $v : $v);
        } catch (\Throwable) {
            return null;
        }
    }

    private static function texto(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }

        if ($v instanceof \BackedEnum) {
            return (string) $v->value;
        }

        $s = trim((string) $v);

        return $s === '' ? null : $s;
    }
}
