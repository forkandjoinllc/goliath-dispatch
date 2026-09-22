<?php

declare(strict_types=1);

namespace App\Services\Vin;

use App\Support\Equipment\Vin;
use Illuminate\Http\Client\Factory as Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * La base de la NHTSA (vPIC), que es la oficial de EE. UU.
 *
 * Es la única fuente práctica del MODELO: las posiciones 4-8 del VIN las define
 * cada fabricante y solo la base las traduce.
 *
 * No pide credenciales —el servicio es público— pero sí pide salida a internet
 * desde el servidor. Por eso el decodificador que se usa de verdad encadena
 * este con el de respaldo: cuando esto no contesta, el año y la marca siguen
 * saliendo del propio número.
 *
 * ## Advertencia honesta
 *
 * Este adaptador NO se ha ejecutado nunca contra el servicio real desde este
 * proyecto: el contenedor donde se escribió tiene bloqueada la salida a
 * `vpic.nhtsa.dot.gov`. Lo que sus pruebas demuestran es el MAPEO —qué se hace
 * con la respuesta— con `Http::fake()`, no el contrato del proveedor. La
 * primera consulta de verdad puede exigir ajustar `mapear()`.
 */
final class NhtsaVinDecoder implements VinDecoder
{
    /** Un VIN no cambia de marca: se puede guardar mucho tiempo. */
    private const TTL_SEGUNDOS = 2_592_000;

    public function __construct(
        private readonly Http $http,
        private readonly string $baseUrl,
        private readonly int $timeout = 4,
    ) {}

    public function decode(string $vin): ?DecodedVin
    {
        $v = Vin::normalizar($vin);

        // La forma se comprueba antes de salir: preguntar por un número que no
        // es un VIN gasta una llamada y contesta basura.
        if (! Vin::sumaBien($v)) {
            return null;
        }

        $clave = "vin:nhtsa:{$v}";
        $guardado = Cache::get($clave);

        if (is_array($guardado)) {
            return new DecodedVin(
                make: $guardado['make'] ?? null,
                model: $guardado['model'] ?? null,
                year: $guardado['year'] ?? null,
                sources: [DecodedVin::DE_LA_NHTSA],
            );
        }

        try {
            $respuesta = $this->http
                ->timeout($this->timeout)
                ->acceptJson()
                ->get(rtrim($this->baseUrl, '/')."/DecodeVinValues/{$v}", ['format' => 'json']);

            if (! $respuesta->successful()) {
                return null;
            }

            $fila = $respuesta->json('Results.0');
        } catch (Throwable $e) {
            // Que el servicio esté caído no puede romper el alta de un camión:
            // se devuelve nulo y el de respaldo hace lo que puede.
            Log::warning('No se pudo decodificar un VIN contra la NHTSA', [
                'error' => $e->getMessage(),
            ]);

            return null;
        }

        if (! is_array($fila)) {
            return null;
        }

        $decodificado = self::mapear($fila);

        if ($decodificado === null) {
            return null;
        }

        Cache::put($clave, [
            'make' => $decodificado->make,
            'model' => $decodificado->model,
            'year' => $decodificado->year,
        ], self::TTL_SEGUNDOS);

        return $decodificado;
    }

    public function isLive(): bool
    {
        return true;
    }

    public function name(): string
    {
        return 'nhtsa';
    }

    /**
     * De la respuesta de vPIC a lo nuestro.
     *
     * vPIC contesta 200 con los campos VACÍOS cuando no conoce el número, y
     * además devuelve cadenas vacías en vez de nulos. Las dos cosas se tratan
     * igual: si no queda nada, no hay respuesta.
     *
     * @param  array<string, mixed>  $fila
     */
    private static function mapear(array $fila): ?DecodedVin
    {
        $texto = static function (mixed $valor): ?string {
            $v = is_string($valor) ? trim($valor) : '';

            return $v === '' ? null : $v;
        };

        $ano = $texto($fila['ModelYear'] ?? null);

        $decodificado = new DecodedVin(
            make: $texto($fila['Make'] ?? null),
            model: $texto($fila['Model'] ?? null),
            year: $ano === null || ! ctype_digit($ano) ? null : (int) $ano,
            sources: [DecodedVin::DE_LA_NHTSA],
        );

        return $decodificado->isEmpty() ? null : $decodificado;
    }
}
