<?php

declare(strict_types=1);

namespace App\Services\Fmcsa;

use App\Enums\FmcsaLookupStatus;
use Illuminate\Http\Client\Factory as Http;
use Illuminate\Http\Client\Response as HttpResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * El directorio real: QCMobile, el servicio público de FMCSA.
 *
 * Solo se ata cuando hay `FMCSA_WEBKEY` en el entorno (ver AppServiceProvider).
 * La clave NO vive en el repositorio ni en ningún fichero versionado: entra por
 * el `.env` del servidor y solo se lee desde `config('services.fmcsa.web_key')`.
 *
 * Tres decisiones que no son de estilo:
 *
 *  • **Se cachea 24 horas.** El registro se mueve despacio y dar de alta a un
 *    transportista implica varias vueltas al mismo formulario. Sin caché, un
 *    alta corriente son cuatro o cinco consultas idénticas.
 *
 *  • **Un fallo del proveedor NUNCA sube como excepción.** Vuelve como
 *    `FmcsaLookup::error`, y la pantalla ofrece seguir a mano. Que FMCSA esté
 *    caído no puede impedir dar de alta a un transportista.
 *
 *  • **La clave nunca se registra.** El `Log::warning` de abajo escribe el
 *    USDOT y el código de estado, jamás la URL completa.
 *
 * ADVERTENCIA HONESTA: los nombres de campo de abajo siguen la forma
 * documentada de QCMobile, pero este adaptador no se ha ejecutado nunca contra
 * el servicio real —no hay clave todavía—. La primera consulta de verdad puede
 * exigir ajustar `mapear()`. La prueba que lo cubre usa `Http::fake()`, así que
 * demuestra el mapeo, no el contrato del proveedor.
 */
final class QcMobileDirectory implements FmcsaDirectory
{
    private const TTL_SEGUNDOS = 86400;

    public function __construct(
        private readonly Http $http,
        private readonly string $webKey,
        private readonly string $baseUrl,
    ) {}

    public function byDot(string $dotNumber): FmcsaLookup
    {
        $digits = self::digits($dotNumber);

        if (strlen($digits) < 5 || strlen($digits) > 8) {
            return FmcsaLookup::invalid('errors.dotFormat', $this->name());
        }

        return $this->recordar("dot:{$digits}", fn (): FmcsaLookup => $this->pedir(
            "carriers/{$digits}",
            $digits,
        ));
    }

    public function byDocket(string $mcNumber): FmcsaLookup
    {
        $digits = self::digits($mcNumber);

        if ($digits === '' || strlen($digits) > 8) {
            return FmcsaLookup::invalid('errors.mcFormat', $this->name());
        }

        return $this->recordar("mc:{$digits}", fn (): FmcsaLookup => $this->pedir(
            "carriers/docket-number/{$digits}",
            $digits,
            $digits,
        ));
    }

    public function name(): string
    {
        return 'qcmobile';
    }

    public function isLive(): bool
    {
        return true;
    }

    /**
     * @param  callable(): FmcsaLookup  $consulta
     */
    private function recordar(string $clave, callable $consulta): FmcsaLookup
    {
        $clave = "fmcsa:{$this->name()}:{$clave}";
        $guardado = Cache::get($clave);

        if ($guardado instanceof FmcsaLookup) {
            return $guardado;
        }

        $resultado = $consulta();

        // Solo se guarda lo que el registro AFIRMÓ. Un error de red cacheado
        // durante un día convertiría un problema de un minuto en uno de toda
        // una jornada.
        if ($resultado->status !== FmcsaLookupStatus::Error) {
            Cache::put($clave, $resultado, self::TTL_SEGUNDOS);
        }

        return $resultado;
    }

    private function pedir(string $ruta, string $referencia, ?string $mcConocido = null): FmcsaLookup
    {
        try {
            $respuesta = $this->http
                ->timeout(8)
                ->connectTimeout(4)
                ->retry(2, 250, throw: false)
                ->acceptJson()
                ->get(rtrim($this->baseUrl, '/')."/{$ruta}", ['webKey' => $this->webKey]);
        } catch (Throwable $e) {
            Log::warning('FMCSA QCMobile: la consulta falló', [
                'referencia' => $referencia,
                'excepcion' => $e::class,
            ]);

            return FmcsaLookup::error('errors.provider', true, $this->name());
        }

        if ($respuesta->status() === 404) {
            return FmcsaLookup::notFound(true, $this->name());
        }

        if (! $respuesta->successful()) {
            Log::warning('FMCSA QCMobile: respuesta no satisfactoria', [
                'referencia' => $referencia,
                'estado' => $respuesta->status(),
            ]);

            return FmcsaLookup::error('errors.provider', true, $this->name());
        }

        $carrier = $this->extraer($respuesta);

        if ($carrier === null) {
            // QCMobile contesta 200 con `content` vacío cuando no hay nadie con
            // ese número. Eso NO es un error: es una respuesta.
            return FmcsaLookup::notFound(true, $this->name());
        }

        // El número MC no viene en la ficha del transportista. Vive en otro
        // sitio del servicio, `carriers/{dot}/docket-numbers`, porque una misma
        // empresa puede tener varios expedientes (MC, FF, MX) y hasta más de uno
        // del mismo tipo. Sin esta segunda llamada, buscar por USDOT devolvía la
        // ficha entera con el MC en blanco.
        $mc = $mcConocido ?? $this->docketNumber((string) ($carrier['dotNumber'] ?? ''));

        return FmcsaLookup::found($this->mapear($carrier, $mc), true, $this->name());
    }

    /**
     * El número MC (expediente) de un transportista, si tiene.
     *
     * Un fallo aquí NO estropea la búsqueda: se devuelve null y el campo del
     * formulario queda vacío para que lo escriba quien esté dando el alta. Que
     * el registro no conteste a la segunda llamada no puede tirar la primera,
     * que es la que trae el nombre y la dirección.
     *
     * Se prefiere un expediente activo. Si hay varios y ninguno se declara
     * activo, se coge el primero con prefijo MC: es el que aparece en un
     * contrato de transporte.
     */
    private function docketNumber(string $dot): ?string
    {
        if ($dot === '') {
            return null;
        }

        try {
            $respuesta = $this->http
                ->timeout(6)
                ->connectTimeout(4)
                ->retry(1, 250, throw: false)
                ->acceptJson()
                ->get(rtrim($this->baseUrl, '/')."/carriers/{$dot}/docket-numbers", ['webKey' => $this->webKey]);
        } catch (Throwable $e) {
            Log::warning('FMCSA QCMobile: no se pudieron leer los expedientes', [
                'referencia' => $dot,
                'excepcion' => $e::class,
            ]);

            return null;
        }

        if (! $respuesta->successful()) {
            return null;
        }

        $cuerpo = $respuesta->json();
        $contenido = is_array($cuerpo) ? ($cuerpo['content'] ?? null) : null;

        if (! is_array($contenido)) {
            return null;
        }

        $candidatos = [];

        foreach ($contenido as $fila) {
            if (! is_array($fila)) {
                continue;
            }

            $expediente = $fila['docketNumber'] ?? $fila;

            if (! is_array($expediente)) {
                continue;
            }

            $prefijo = strtoupper((string) ($expediente['prefix'] ?? 'MC'));

            if ($prefijo !== 'MC') {
                continue;
            }

            $numero = self::texto($expediente['docketNumber'] ?? null);

            if ($numero === null) {
                continue;
            }

            $activo = strtoupper((string) ($expediente['status'] ?? '')) === 'A';
            $candidatos[] = ['numero' => $numero, 'activo' => $activo];
        }

        if ($candidatos === []) {
            return null;
        }

        foreach ($candidatos as $c) {
            if ($c['activo']) {
                return $c['numero'];
            }
        }

        return $candidatos[0]['numero'];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function extraer(HttpResponse $respuesta): ?array
    {
        $cuerpo = $respuesta->json();

        if (! is_array($cuerpo)) {
            return null;
        }

        $contenido = $cuerpo['content'] ?? null;

        // Por USDOT llega un objeto; por número MC, una lista. Se acepta la
        // primera de la lista: un número de expediente identifica a uno.
        if (is_array($contenido) && array_is_list($contenido)) {
            $contenido = $contenido[0] ?? null;
        }

        if (! is_array($contenido)) {
            return null;
        }

        $carrier = $contenido['carrier'] ?? $contenido;

        return is_array($carrier) ? $carrier : null;
    }

    /**
     * @param  array<string, mixed>  $c
     */
    private function mapear(array $c, ?string $mcConocido): FmcsaCarrier
    {
        return new FmcsaCarrier(
            dotNumber: (string) ($c['dotNumber'] ?? ''),
            mcNumber: $mcConocido,
            legalName: self::texto($c['legalName'] ?? null),
            dbaName: self::texto($c['dbaName'] ?? null),
            phone: self::texto($c['telephone'] ?? null),
            line1: self::texto($c['phyStreet'] ?? null),
            city: self::texto($c['phyCity'] ?? null),
            state: self::texto($c['phyState'] ?? null),
            postalCode: self::texto($c['phyZipcode'] ?? null),
            country: self::texto($c['phyCountry'] ?? null) ?? 'US',
            entityType: self::texto(
                is_array($c['censusTypeId'] ?? null) ? ($c['censusTypeId']['censusTypeDesc'] ?? null) : null
            ),
            operatingStatus: self::estadoOperativo($c),
            allowedToOperate: match (strtoupper((string) ($c['allowedToOperate'] ?? ''))) {
                'Y' => true,
                'N' => false,
                default => null,
            },
            safetyRating: self::texto($c['safetyRating'] ?? null),
            safetyRatingDate: self::fecha($c['safetyRatingDate'] ?? null),
            powerUnits: self::entero($c['totalPowerUnits'] ?? null),
            driverCount: self::entero($c['totalDrivers'] ?? null),
            source: 'FMCSA QCMobile',
        );
    }

    /**
     * @param  array<string, mixed>  $c
     */
    private static function estadoOperativo(array $c): ?string
    {
        $explicito = self::texto($c['statusCode'] ?? null);

        return match (strtoupper((string) $explicito)) {
            'A' => 'ACTIVE',
            'I' => 'INACTIVE',
            default => $explicito,
        };
    }

    private static function texto(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }

        $s = trim((string) $v);

        return $s === '' ? null : $s;
    }

    private static function entero(mixed $v): ?int
    {
        return is_numeric($v) ? (int) $v : null;
    }

    /**
     * QCMobile publica la fecha de calificación unas veces como milisegundos y
     * otras como texto. Se devuelve siempre como fecha de calendario, que es lo
     * único que alguien va a leer.
     */
    private static function fecha(mixed $v): ?string
    {
        if (is_numeric($v)) {
            $segundos = (int) $v;

            if ($segundos > 100000000000) {
                $segundos = intdiv($segundos, 1000);
            }

            return date('Y-m-d', $segundos);
        }

        $texto = self::texto($v);

        if ($texto === null) {
            return null;
        }

        $marca = strtotime($texto);

        return $marca === false ? null : date('Y-m-d', $marca);
    }

    private static function digits(string $valor): string
    {
        return preg_replace('/\D+/', '', $valor) ?? '';
    }
}
