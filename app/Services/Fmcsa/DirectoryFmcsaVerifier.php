<?php

declare(strict_types=1);

namespace App\Services\Fmcsa;

use App\Enums\FmcsaLookupStatus;
use App\Enums\VerificationStatus;

/**
 * Verifica comparando contra lo que devuelve el directorio real.
 *
 * No habla con nadie: le pregunta a FmcsaDirectory, que es quien tiene el
 * adaptador. Así la verificación y el alta consultan por el mismo camino, con
 * la misma caché y la misma clave, y no hay dos sitios que mantener el día que
 * cambie el proveedor.
 *
 * El nombre legal se compara NORMALIZADO —mayúsculas, sin puntuación y sin las
 * formas societarias— porque «Río Grande Trucking, L.L.C.» y «RIO GRANDE
 * TRUCKING LLC» son la misma empresa, y marcar eso como discrepancia enseñaría
 * a todo el mundo a ignorar el aviso.
 */
final class DirectoryFmcsaVerifier implements FmcsaVerifier
{
    public function __construct(private readonly FmcsaDirectory $directory) {}

    public function verify(string $dotNumber, ?string $mcNumber, ?string $legalName): FmcsaResult
    {
        $lookup = $this->directory->byDot($dotNumber);

        if ($lookup->status === FmcsaLookupStatus::Invalid) {
            return new FmcsaResult(
                status: VerificationStatus::Failed,
                errorMessage: 'El número USDOT no tiene un formato válido.',
                provider: $this->name(),
            );
        }

        if ($lookup->status === FmcsaLookupStatus::NotFound) {
            return new FmcsaResult(
                status: VerificationStatus::Failed,
                errorMessage: 'El registro no devolvió ningún transportista con ese USDOT.',
                provider: $this->name(),
            );
        }

        if ($lookup->status === FmcsaLookupStatus::Error || $lookup->carrier === null) {
            // Que el proveedor no conteste NO es que el transportista falle la
            // verificación. Queda pendiente, y alguien lo reintenta.
            return new FmcsaResult(
                status: VerificationStatus::Pending,
                errorMessage: 'El registro federal no contestó. Hay que reintentarlo.',
                provider: $this->name(),
            );
        }

        $carrier = $lookup->carrier;
        $normalized = $carrier->toNormalized();

        $coincide = $legalName === null
            || $carrier->legalName === null
            || self::clave($legalName) === self::clave($carrier->legalName);

        return new FmcsaResult(
            status: $coincide ? VerificationStatus::Verified : VerificationStatus::Mismatch,
            normalized: $normalized,
            rawDigest: hash('sha256', json_encode($normalized, JSON_THROW_ON_ERROR)),
            errorMessage: $coincide ? null : 'El nombre legal no coincide con el registrado en FMCSA.',
            provider: $this->name(),
        );
    }

    public function name(): string
    {
        return $this->directory->name();
    }

    /**
     * El nombre reducido a lo que lo identifica: sin acentos, sin puntuación y
     * sin la forma societaria.
     */
    private static function clave(string $nombre): string
    {
        $s = mb_strtoupper(trim($nombre));
        $s = strtr($s, ['Á' => 'A', 'É' => 'E', 'Í' => 'I', 'Ó' => 'O', 'Ú' => 'U', 'Ñ' => 'N', 'Ü' => 'U']);
        $s = preg_replace('/[^A-Z0-9 ]+/', ' ', $s) ?? $s;
        $s = preg_replace('/\b(LLC|INC|CORP|CO|LTD|LP|LLP|COMPANY|INCORPORATED|INTERNATIONAL|INTL|INTERNACIONAL|SA|SRL|INTL)\b/', ' ', $s) ?? $s;
        $s = preg_replace('/\s+/', ' ', $s) ?? $s;

        return trim($s);
    }
}
