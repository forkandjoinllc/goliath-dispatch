<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Los datos de contacto que enseña el sitio público.
 *
 * Qué empresa se enseña depende de bajo qué dominio se está sirviendo:
 *
 *  - Con empresa activa —el sitio va bajo el dominio verificado de un cliente—
 *    se enseñan los datos de ESE cliente, de `tenant_settings`.
 *  - Sin empresa activa —goliathdispatch.com— se enseñan los de la plataforma,
 *    de `config/company.php`.
 *
 * El orden importa y no es simétrico: si un cliente no ha rellenado su
 * domicilio, NO se cae al de Goliath. Se enseña menos. Poner la dirección del
 * operador en la página de su cliente le diría a los visitantes de ese cliente
 * que la empresa está en Davie, Florida, que es falso y además revela dónde
 * está el proveedor de alguien que quizá no quiere contarlo.
 */
final class Company
{
    /**
     * @return array<string, mixed>|null
     */
    public static function forSite(?string $tenantId): ?array
    {
        $bloque = $tenantId === null
            ? self::platform()
            : self::tenant($tenantId);

        return $bloque === null ? null : [...$bloque, ...self::maps($bloque)];
    }

    /**
     * Las dos URL del mapa, construidas a partir del domicilio que se va a
     * enseñar.
     *
     * A partir del domicilio y no de unas coordenadas escritas aparte: dos
     * fuentes para el mismo sitio acaban discrepando el día que la empresa se
     * muda, y el mapa señalando la oficina vieja es peor que no tener mapa.
     *
     * Sirve igual para una empresa cliente: su página lleva SU mapa sin que
     * haya que tocar nada.
     *
     * @param  array<string, mixed>  $bloque
     * @return array{mapEmbedUrl: string|null, directionsUrl: string|null}
     */
    private static function maps(array $bloque): array
    {
        $partes = array_values(array_filter([
            $bloque['line1'] ?? null,
            $bloque['city'] ?? null,
            $bloque['state'] ?? null,
            $bloque['postalCode'] ?? null,
        ]));

        // Sin calle no se busca nada: una consulta con solo la ciudad
        // señalaría el centro del pueblo y parecería la oficina.
        if ($partes === [] || ($bloque['line1'] ?? null) === null) {
            return ['mapEmbedUrl' => null, 'directionsUrl' => null];
        }

        $consulta = rawurlencode(implode(', ', $partes));
        $zoom = (int) config('company.map.zoom', 16);

        return [
            'mapEmbedUrl' => config('company.map.provider', 'google') === 'google'
                ? "https://www.google.com/maps?q={$consulta}&z={$zoom}&output=embed"
                : null,
            // Siempre. `dir/?api=1` abre la aplicación de mapas del visitante
            // —la suya, no la nuestra— y funciona igual en móvil y escritorio.
            'directionsUrl' => "https://www.google.com/maps/dir/?api=1&destination={$consulta}",
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function platform(): array
    {
        /** @var array<string, mixed> $address */
        $address = (array) config('company.address', []);

        return [
            'legalName' => (string) config('company.legal_name'),
            'line1' => self::text($address['line1'] ?? null),
            'line2' => self::text($address['line2'] ?? null),
            'city' => self::text($address['city'] ?? null),
            'state' => self::text($address['state'] ?? null),
            'postalCode' => self::text($address['postal_code'] ?? null),
            'country' => self::text($address['country'] ?? null),
            'phone' => self::text(config('company.phone')),
            'phoneHref' => self::text(config('company.phone_href')) ?? self::dialable(config('company.phone')),
            'email' => self::text(config('company.email')),
            'hours247' => (bool) config('company.hours_247', false),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function tenant(string $tenantId): ?array
    {
        // Consulta en crudo y no por el modelo: esto corre en el sitio público,
        // donde puede no haber contexto de empresa resuelto todavía, y el scope
        // global lanzaría.
        $settings = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->first([
                'address_line1', 'address_line2', 'address_city', 'address_state',
                'address_postal_code', 'address_country', 'contact_phone', 'contact_email',
            ]);

        $name = DB::table('tenants')
            ->where('id', $tenantId)
            ->value('legal_name');

        if ($settings === null) {
            return null;
        }

        $bloque = [
            'legalName' => self::text($name),
            'line1' => self::text($settings->address_line1),
            'line2' => self::text($settings->address_line2),
            'city' => self::text($settings->address_city),
            'state' => self::text($settings->address_state),
            'postalCode' => self::text($settings->address_postal_code),
            'country' => self::text($settings->address_country),
            'phone' => self::text($settings->contact_phone),
            'phoneHref' => self::dialable($settings->contact_phone),
            'email' => self::text($settings->contact_email),
            // El horario de una empresa cliente vive en `business_hours`, que
            // es una tabla por días y no un «siempre abierto». Hasta que haya
            // pantalla para pintarla, no se afirma nada.
            'hours247' => false,
        ];

        // Sin calle no hay domicilio que enseñar. Devolver el bloque a medias
        // pintaría un encabezado «Oficina» encima de una ciudad suelta.
        return $bloque['line1'] === null ? null : $bloque;
    }

    /**
     * El número tal y como se marca: sin paréntesis, guiones ni espacios.
     *
     * Se conserva el `+` inicial si lo trae. No se inventa ninguno: un prefijo
     * de país deducido de la longitud acierta con los números de EE. UU. y
     * falla con el primero que no lo sea.
     */
    private static function dialable(mixed $value): ?string
    {
        $texto = self::text($value);

        if ($texto === null) {
            return null;
        }

        $marcable = preg_replace('/(?!^\+)[^\d]/', '', $texto);

        return $marcable === '' ? null : $marcable;
    }

    private static function text(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }
}
