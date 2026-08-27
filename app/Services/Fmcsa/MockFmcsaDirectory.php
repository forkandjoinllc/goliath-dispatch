<?php

declare(strict_types=1);

namespace App\Services\Fmcsa;

/**
 * El directorio que contesta cuando NO hay credenciales de FMCSA.
 *
 * No consulta nada. Fabrica una ficha determinista a partir del USDOT para que
 * una demostración enseñe siempre lo mismo y una prueba pueda afirmar sobre
 * ello, y lo dice dentro del propio dato: `source` viaja hasta la fila que se
 * guarda y hasta la pantalla, donde se pinta un aviso.
 *
 * `isLive()` devuelve falso, y de eso depende que el formulario deje los campos
 * EDITABLES. Bloquear campos rellenados con datos inventados sería la peor de
 * las dos mentiras posibles.
 *
 * Reserva deliberada de números para poder probar los tres desenlaces sin red:
 *
 *   • terminado en 0 → no existe (el registro contesta y no tiene a nadie)
 *   • terminado en 1 → el proveedor falla
 *   • cualquier otro → ficha completa
 */
final class MockFmcsaDirectory implements FmcsaDirectory
{
    private const SOURCE = 'mock adapter — no FMCSA credentials configured, nothing was queried';

    public function byDot(string $dotNumber): FmcsaLookup
    {
        $digits = self::digits($dotNumber);

        if (strlen($digits) < 5 || strlen($digits) > 8) {
            return FmcsaLookup::invalid('errors.dotFormat', $this->name());
        }

        return $this->fabricate($digits, null);
    }

    public function byDocket(string $mcNumber): FmcsaLookup
    {
        $digits = self::digits($mcNumber);

        if ($digits === '' || strlen($digits) > 8) {
            return FmcsaLookup::invalid('errors.mcFormat', $this->name());
        }

        // Un MC simulado se traduce a un USDOT simulado estable, para que buscar
        // por uno o por otro lleve a la misma ficha inventada.
        return $this->fabricate(str_pad($digits, 7, '0', STR_PAD_LEFT), $digits);
    }

    public function name(): string
    {
        return 'mock';
    }

    public function isLive(): bool
    {
        return false;
    }

    private function fabricate(string $dot, ?string $mc): FmcsaLookup
    {
        $ultimo = (int) substr($dot, -1);

        if ($ultimo === 0) {
            return FmcsaLookup::notFound(false, $this->name());
        }

        if ($ultimo === 1) {
            return FmcsaLookup::error('errors.provider', false, $this->name());
        }

        $ciudades = [
            ['Laredo', 'TX', '78040'],
            ['Doral', 'FL', '33172'],
            ['Joliet', 'IL', '60432'],
            ['Fontana', 'CA', '92335'],
            ['Newark', 'NJ', '07105'],
        ];
        [$ciudad, $estado, $cp] = $ciudades[$ultimo % count($ciudades)];

        return FmcsaLookup::found(
            new FmcsaCarrier(
                dotNumber: $dot,
                mcNumber: $mc ?? (string) (100000 + (int) substr($dot, -5)),
                legalName: 'DEMO CARRIER '.$dot.' LLC',
                dbaName: $ultimo % 3 === 0 ? 'DEMO EXPRESS' : null,
                phone: '+1956555'.substr(str_pad($dot, 4, '0', STR_PAD_LEFT), -4),
                line1: (1000 + $ultimo * 7).' Commerce St',
                city: $ciudad,
                state: $estado,
                postalCode: $cp,
                country: 'US',
                entityType: 'CARRIER',
                operatingStatus: $ultimo === 2 ? 'NOT AUTHORIZED' : 'AUTHORIZED',
                allowedToOperate: $ultimo !== 2,
                safetyRating: match ($ultimo % 4) {
                    0 => 'SATISFACTORY',
                    1 => 'CONDITIONAL',
                    2 => null,
                    default => 'SATISFACTORY',
                },
                safetyRatingDate: $ultimo % 4 === 2 ? null : '2024-0'.max(1, $ultimo % 9).'-15',
                powerUnits: 2 + $ultimo,
                driverCount: 2 + $ultimo,
                source: self::SOURCE,
            ),
            live: false,
            provider: $this->name(),
        );
    }

    private static function digits(string $valor): string
    {
        return preg_replace('/\D+/', '', $valor) ?? '';
    }
}
