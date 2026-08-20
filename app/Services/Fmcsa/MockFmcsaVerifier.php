<?php

declare(strict_types=1);

namespace App\Services\Fmcsa;

use App\Enums\VerificationStatus;

/**
 * El adaptador que se usa cuando NO hay credenciales de FMCSA.
 *
 * Es deliberadamente honesto: se identifica como `mock`, lo dice dentro del
 * propio payload normalizado, y nunca devuelve `verified` sin dejar constancia
 * de que nadie ha consultado a FMCSA. La alternativa —devolver «verificado» a
 * secas en desarrollo— acabaría con alguien creyendo que la integración está
 * hecha, que es exactamente el error que este adaptador tiene que impedir.
 *
 * El resultado es determinista a partir del número DOT, no aleatorio: así una
 * demostración enseña siempre lo mismo y una prueba puede afirmar sobre ello.
 */
final class MockFmcsaVerifier implements FmcsaVerifier
{
    public function verify(string $dotNumber, ?string $mcNumber, ?string $legalName): FmcsaResult
    {
        $digits = preg_replace('/\D+/', '', $dotNumber) ?? '';

        if ($digits === '' || strlen($digits) < 5) {
            return new FmcsaResult(
                status: VerificationStatus::Failed,
                normalized: $this->envelope($dotNumber, $mcNumber, null),
                errorMessage: 'El número USDOT no tiene un formato válido.',
            );
        }

        // El último dígito decide el desenlace. Con un solo camino, la pantalla
        // de discrepancia y la de fallo no se verían nunca en una demostración.
        $status = match ((int) substr($digits, -1) % 10) {
            0 => VerificationStatus::Mismatch,
            1 => VerificationStatus::Failed,
            default => VerificationStatus::Verified,
        };

        return new FmcsaResult(
            status: $status,
            normalized: $this->envelope($dotNumber, $mcNumber, $legalName, $status),
            rawDigest: hash('sha256', "mock:{$dotNumber}:{$mcNumber}"),
            errorMessage: match ($status) {
                VerificationStatus::Mismatch => 'El nombre legal no coincide con el registrado.',
                VerificationStatus::Failed => 'El proveedor no devolvió ningún registro para ese USDOT.',
                default => null,
            },
        );
    }

    public function name(): string
    {
        return 'mock';
    }

    /**
     * @return array<string, mixed>
     */
    private function envelope(
        string $dot,
        ?string $mc,
        ?string $legalName,
        ?VerificationStatus $status = null,
    ): array {
        return [
            'dot_number' => $dot,
            'mc_number' => $mc,
            'legal_name' => $legalName,
            'operating_status' => $status === VerificationStatus::Verified ? 'AUTHORIZED' : null,
            // Esta línea es el punto del adaptador. Va dentro del dato, no en un
            // comentario, para que siga ahí cuando alguien lea la fila dentro de
            // dos años sin este código delante.
            'source' => 'mock adapter — no FMCSA credentials configured, nothing was queried',
        ];
    }
}
