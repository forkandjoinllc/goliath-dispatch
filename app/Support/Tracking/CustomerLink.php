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
 * Al contacto que ESPERA la carga, elegido por su cargo — ver `PREFERENCIA` y
 * `destinatario()`—; si el cliente no tiene contactos, al correo del propio
 * cliente. En ese orden y no al revés: `customers.email` suele ser la dirección
 * general de facturación, y el enlace de una carga concreta le sirve a quien la
 * espera, no a contabilidad.
 *
 * Hasta el lote 64 esto era «el contacto principal», y en la práctica era
 * siempre el correo general: no había forma de crear un contacto de cliente en
 * toda la aplicación, así que la búsqueda no encontraba nunca a nadie.
 *
 * Si no hay ninguno de los dos, no se manda, y desde el lote 64 se DICE — antes
 * el «no» se devolvía y quien llamaba lo tiraba.
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
     * Por cargo, a quién le sirve saber dónde va el camión.
     *
     * Contabilidad NO está en la lista, y esa ausencia es la decisión: se le
     * escribe para cobrar, no para contarle que un camión salió de Laredo. Si
     * no hay ninguno de estos, se cae al principal — ver `destinatario()`.
     */
    private const PREFERENCIA = ['traffic', 'dock', 'purchasing'];

    /**
     * Manda el enlace de esta carga al cliente, si procede.
     *
     * ## Devuelve el MOTIVO, no un sí o un no
     *
     * Antes devolvía `bool` y quien llamaba lo tiraba. Los cuatro «no» son cosas
     * distintas y solo una es un problema:
     *
     *  - `disabled` — la empresa apagó los enlaces públicos. Correcto.
     *  - `alreadySent` — ya salió uno. Correcto: dos enlaces distintos para la
     *    misma carga es cómo se consigue que el cliente abra el que no vale.
     *  - `noRecipient` — el cliente no tiene ni un contacto con correo. Es un
     *    dato que falta, y hay que decirlo.
     *  - `failed` — el correo se intentó y no salió. Es el peor, y era el más
     *    callado: quedaba una línea en el registro que no lee nadie, `sent_at`
     *    en nulo, y el cliente esperando un aviso que el sitio público le había
     *    prometido.
     *
     * @return 'sent'|'disabled'|'alreadySent'|'noRecipient'|'failed'
     */
    public static function sendForLoad(string $tenantId, string $loadId, ?string $createdByUserId): string
    {
        if (! TrackingLinks::enabledFor($tenantId)) {
            return 'disabled';
        }

        if (self::yaSeMando($tenantId, $loadId)) {
            return 'alreadySent';
        }

        $destinatario = self::destinatario($tenantId, $loadId);

        if ($destinatario === null) {
            return 'noRecipient';
        }

        $salio = self::emitirYMandar(
            $tenantId,
            $loadId,
            $destinatario['email'],
            $destinatario['locale'],
            $createdByUserId,
        );

        return $salio ? 'sent' : 'failed';
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
            $tenantId,
        );

        if ($salio) {
            TrackingLinks::markSent($enlace['id']);
        }

        return $salio;
    }

    /**
     * A quién y en qué idioma.
     *
     * ## A quién
     *
     * A quien ESPERA la carga, que no es lo mismo que quien la paga. Se busca
     * por cargo y en este orden: tráfico, el muelle, compras, el principal, y
     * cualquiera con correo. Contabilidad queda fuera de la preferencia a
     * propósito: la factura es suya y el aviso de que un camión va de camino no.
     *
     * Es la misma forma de elegir que usa `InvoiceLink` para la factura, con la
     * lista al revés — y no es casualidad que se parezcan: la pregunta «¿a quién
     * de esta empresa le importa esto?» es la misma y solo cambia el esto.
     *
     * Si no hay ningún contacto, el correo general del cliente. En ese orden y
     * no al revés: `customers.email` suele ser la dirección de facturación.
     *
     * ## En qué idioma
     *
     * En el DEL CONTACTO. Hasta este lote no había dónde guardarlo —ni
     * `customers` ni `customer_contacts` tenían columna— y se caía al idioma de
     * la empresa, así que una casa que trabaja en inglés les escribía en inglés
     * a sus clientes hispanohablantes. Los transportistas y los conductores sí
     * lo tenían; la asimetría no tenía ninguna razón de ser.
     *
     * Cuando se cae al correo general del cliente se usa
     * `customers.preferred_locale`, que es el espejo del contacto principal.
     *
     * @return array{email: string, locale: string}|null
     */
    private static function destinatario(string $tenantId, string $loadId): ?array
    {
        $cliente = DB::table('loads as l')
            ->join('customers as c', 'c.id', '=', 'l.customer_id')
            ->where('l.id', $loadId)
            ->where('l.tenant_id', $tenantId)
            ->first(['c.id', 'c.email', 'c.preferred_locale']);

        if ($cliente === null) {
            return null;
        }

        $contactos = DB::table('customer_contacts')
            ->where('tenant_id', $tenantId)
            ->where('customer_id', $cliente->id)
            ->whereNull('deleted_at')
            ->whereNotNull('email')
            ->where('email', '!=', '')
            ->get(['email', 'position', 'preferred_locale', 'is_primary']);

        $elegido = null;

        foreach (self::PREFERENCIA as $cargo) {
            $elegido = $contactos->firstWhere('position', $cargo);

            if ($elegido !== null) {
                break;
            }
        }

        $elegido ??= $contactos->firstWhere('is_primary', 1) ?? $contactos->first();

        if ($elegido !== null) {
            return [
                'email' => trim((string) $elegido->email),
                'locale' => self::idiomaValido($elegido->preferred_locale),
            ];
        }

        if ($cliente->email === null || trim((string) $cliente->email) === '') {
            return null;
        }

        return [
            'email' => trim((string) $cliente->email),
            'locale' => self::idiomaValido($cliente->preferred_locale),
        ];
    }

    /** Un idioma que la aplicación sepa hablar, o el respaldo. */
    private static function idiomaValido(mixed $locale): string
    {
        return in_array($locale, ['en', 'es'], true) ? (string) $locale : 'en';
    }

    /**
     * El idioma de la empresa, que ya solo se usa cuando no hay a quién
     * preguntárselo: en `sendTo()`, donde alguien teclea una dirección suelta
     * que no corresponde a ningún contacto.
     *
     * `tenants.default_locale`, y NO el idioma en que está trabajando quien
     * despacha: un despachador que tiene la aplicación en español no decide en
     * qué idioma lee su cliente.
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
