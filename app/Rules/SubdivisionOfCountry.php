<?php

declare(strict_types=1);

namespace App\Rules;

use App\Support\Geo\Regions;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * El estado tiene que ser de ese país.
 *
 * Sin esta regla el desplegable es una cortesía y nada más: el servidor
 * aceptaría igual un `physical_country=CA` con `physical_state=TX` enviado a
 * mano, y esa dirección no la arregla nadie después porque nadie la mira.
 *
 * Vacío es válido a propósito. Media plataforma admite direcciones incompletas
 * —un transportista recién dado de alta desde FMCSA puede no traer estado— y
 * el esquema deja NULL. Lo que esta regla impide no es que falte: es que sea
 * imposible.
 */
final class SubdivisionOfCountry implements ValidationRule
{
    public function __construct(private readonly mixed $country) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $pais = is_string($this->country) ? $this->country : null;
        $estado = is_string($value) ? $value : null;

        // Un país que no despachamos ya lo rechaza su propia regla; aquí eso
        // sería un segundo mensaje sobre el mismo error, en el campo que no es.
        if ($pais !== null && ! Regions::isCountry($pais)) {
            return;
        }

        if (! Regions::isSubdivisionOf($pais ?? Regions::DEFAULT_COUNTRY, $estado)) {
            $fail(__('validation.state'));
        }
    }
}
