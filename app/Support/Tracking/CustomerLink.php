<?php

declare(strict_types=1);

namespace App\Support\Tracking;

use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Mandarle al cliente el enlace de rastreo de su carga.
 *
 * Junta las tres cosas que hacían falta y que estaban sueltas: A QUIÉN, con qué
 * enlace, y dejando constancia de que salió.
 *
 * ## A quién
 *
 * Al contacto PRINCIPAL del cliente, y si no tiene, al correo del propio
 * cliente. En ese orden y no al revés: `customers.email` suele ser la dirección
 * general de facturación, y el enlace de una carga concreta le sirve a quien la
 * espera, no a contabilidad.
 *
 * Si no hay ninguno de los dos, no se manda y no pasa nada malo. Una carga sin
 * dirección de contacto es un dato que falta, no un error que haya que gritar en
 * mitad de un despacho.
 *
 * ## Cuándo
 *
 * Al despachar, que es justo lo que dice el sitio público. UNA vez: si la carga
 * vuelve a pasar por despachada —una corrección, una reasignación— no se manda
 * otro. Dos correos con dos enlaces distintos para la misma carga es cómo se
 * consigue que el cliente abra el que ya no vale.
 *
 * ## Y no se manda si la empresa apagó los enlaces públicos
 *
 * `tenant_settings.public_tracking_enabled` ya existía y ya lo respeta la
 * creación manual. Un ajuste que la creación manual respeta y el envío
 * automático se salta sería el mismo defecto de siempre por la puerta de atrás.
 */
final class CustomerLink
{
    /**
     * Manda el enlace de esta carga al cliente, si procede.
     *
     * @return bool si se mandó
     */
    public static function sendForLoad(string $tenantId, string $loadId, ?string $createdByUserId): bool
    {
        if (! TrackingLinks::enabledFor($tenantId)) {
            return false;
        }

        if (self::yaSeMando($tenantId, $loadId)) {
            return false;
        }

        $destinatario = self::destinatario($tenantId, $loadId);

        if ($destinatario === null) {
            return false;
        }

        return self::emitirYMandar(
            $tenantId,
            $loadId,
            $destinatario['email'],
            $destinatario['locale'],
            $createdByUserId,
        );
    }

    /**
     * Manda el enlace a una dirección concreta, porque alguien lo ha pedido.
     *
     * El caso de «el cliente llama y dice que no le llegó». Emite un enlace
     * NUEVO en vez de reenviar el viejo: el token no se guarda en claro en
     * ninguna parte —solo su hash— así que reenviarlo es imposible por
     * construcción, y eso es una propiedad que conviene conservar.
     */
    public static function sendTo(string $tenantId, string $loadId, string $email, ?string $createdByUserId): bool
    {
        if (! TrackingLinks::enabledFor($tenantId)) {
            return false;
        }

        return self::emitirYMandar($tenantId, $loadId, $email, self::idiomaDeLaEmpresa($tenantId), $createdByUserId);
    }

    private static function emitirYMandar(
        string $tenantId,
        string $loadId,
        string $email,
        string $locale,
        ?string $createdByUserId,
    ): bool {
        $enlace = TrackingLinks::issue(
            tenantId: $tenantId,
            loadId: $loadId,
            label: null,
            recipientEmail: $email,
            ttlHours: null,
            createdByUserId: $createdByUserId,
        );

        $salio = LinkMailer::send(
            $email,
            // Con el prefijo del idioma del destinatario: lo abre desde un
            // correo, sin sesión ni cookie, y sin esto leería lo que diga el
            // navegador de su oficina.
            url('/'.$locale.'/t/'.$enlace['token']),
            self::nombreDeLaEmpresa($tenantId),
            $locale,
        );

        if ($salio) {
            TrackingLinks::markSent($enlace['id']);
        }

        return $salio;
    }

    /** @return array{email: string, locale: string}|null */
    private static function destinatario(string $tenantId, string $loadId): ?array
    {
        $cliente = DB::table('loads as l')
            ->join('customers as c', 'c.id', '=', 'l.customer_id')
            ->where('l.id', $loadId)
            ->where('l.tenant_id', $tenantId)
            ->first(['c.id', 'c.email']);

        if ($cliente === null) {
            return null;
        }

        $contacto = DB::table('customer_contacts')
            ->where('tenant_id', $tenantId)
            ->where('customer_id', $cliente->id)
            ->whereNull('deleted_at')
            ->whereNotNull('email')
            ->orderByDesc('is_primary')
            ->value('email');

        $email = $contacto ?? $cliente->email;

        if ($email === null || trim((string) $email) === '') {
            return null;
        }

        return [
            'email' => trim((string) $email),
            'locale' => self::idiomaDeLaEmpresa($tenantId),
        ];
    }

    /**
     * El idioma del correo.
     *
     * `tenants.default_locale`, y NO el idioma en que está trabajando quien
     * despacha: un despachador que tiene la aplicación en español no decide en
     * qué idioma lee su cliente.
     *
     * Es el mejor dato que hay hoy, y es peor de lo que debería: ni `customers`
     * ni `customer_contacts` tienen columna de idioma, así que una casa que
     * trabaja en inglés y tiene tres clientes hispanohablantes les escribe en
     * inglés a los tres. `carriers` sí la tiene —«el idioma en el que se le
     * escribe a esta persona»— y la asimetría no tiene ninguna razón de ser.
     * Está en docs/tracking-link.md, en «lo que falta».
     */
    private static function idiomaDeLaEmpresa(string $tenantId): string
    {
        $locale = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenants')
            ->where('id', $tenantId)
            ->value('default_locale'));

        return in_array($locale, ['en', 'es'], true) ? (string) $locale : 'en';
    }

    private static function nombreDeLaEmpresa(string $tenantId): string
    {
        $nombre = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenants')
            ->where('id', $tenantId)
            ->value('display_name'));

        return (string) ($nombre ?? '');
    }

    /** ¿Ya salió uno para esta carga? */
    private static function yaSeMando(string $tenantId, string $loadId): bool
    {
        return DB::table('public_tracking_links')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->whereNotNull('sent_at')
            ->whereNull('deleted_at')
            ->exists();
    }
}
