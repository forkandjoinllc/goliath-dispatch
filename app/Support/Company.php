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
        return $tenantId === null
            ? self::platform()
            : self::tenant($tenantId);
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
            'email' => self::text(config('company.email')),
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
            'email' => self::text($settings->contact_email),
        ];

        // Sin calle no hay domicilio que enseñar. Devolver el bloque a medias
        // pintaría un encabezado «Oficina» encima de una ciudad suelta.
        return $bloque['line1'] === null ? null : $bloque;
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
