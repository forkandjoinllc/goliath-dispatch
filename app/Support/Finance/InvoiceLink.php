<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Support\Branding\Brand;
use App\Support\Branding\Templates;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Throwable;

/**
 * El enlace por el que un cliente ve y paga su factura.
 *
 * ## El hueco
 *
 * «Enviar factura» la marcaba como enviada y nada más — la pantalla lo decía con
 * cuidado («quedó MARCADA como enviada»), así que no era una mentira, pero sí
 * era el hueco funcional más grande que quedaba: la factura no salía de aquí. El
 * despachador la mandaba por su cuenta desde su correo, el cliente pagaba por
 * transferencia, y alguien lo apuntaba a mano.
 *
 * ## Solo el hash del testigo
 *
 * Como los enlaces de rastreo y los vales de invitación. Quien lea la base de
 * datos no puede abrir la factura de nadie con lo que ve, y reenviar un enlace
 * es imposible por construcción: hay que emitir uno nuevo. Volver a mandar la
 * factura invalida el anterior, que es lo correcto — si se mandó a la dirección
 * equivocada, esa dirección deja de servir.
 *
 * ## A quién va: al TRANSPORTISTA, y a su gente de facturación
 *
 * Esta factura es lo que la casa de despacho le cobra al transportista por su
 * tarifa de despacho — no lo que le cobra al cliente por el flete. Así que va al
 * transportista, y dentro del transportista al contacto de FACTURACIÓN si lo
 * tiene: mandarle una factura al jefe de tráfico es cómo se consigue que la
 * pague nadie.
 *
 * El orden es: contacto de facturación, contacto principal, correo de la
 * empresa. Y en el idioma de ESE contacto — `carrier_contacts.preferred_locale`
 * existe y dice literalmente «el idioma en el que se le escribe a esta persona».
 * Es más fino de lo que se pudo hacer con el enlace de rastreo, donde el cliente
 * no tiene columna de idioma y hay que caer en el de la empresa.
 *
 * ## Con la cara de la empresa
 *
 * Reutiliza App\Support\Branding: el asunto y el cuerpo los puede escribir la
 * casa de despacho, y su pie va al final. Quien recibe esto no es usuario
 * nuestro.
 */
final class InvoiceLink
{
    /** El evento de plantilla de este correo. */
    public const EVENTO = 'invoice.sent';

    /** Días DESPUÉS del vencimiento que el enlace sigue valiendo. */
    private const DIAS_TRAS_VENCIMIENTO = 90;

    /**
     * Emite un testigo nuevo para esta factura y devuelve el texto plano.
     *
     * Es lo ÚNICO que sale en claro de aquí, y solo viaja al correo del cliente.
     */
    public static function issue(object $factura): string
    {
        $plano = Str::random(48);
        $ahora = CarbonImmutable::now();

        $vence = $factura->due_date === null
            ? $ahora->addDays(self::DIAS_TRAS_VENCIMIENTO)
            : CarbonImmutable::parse((string) $factura->due_date)->addDays(self::DIAS_TRAS_VENCIMIENTO);

        DB::table('invoices')->where('id', $factura->id)->update([
            'public_token_hash' => hash('sha256', $plano),
            'public_token_expires_at' => $vence,
            'updated_at' => $ahora,
        ]);

        return $plano;
    }

    /**
     * La factura de un testigo, y en qué estado está el enlace.
     *
     * Va sin ámbito de empresa a propósito: quien abre esta dirección no tiene
     * sesión y por tanto no tiene empresa. El testigo ES la autorización, y de
     * ahí sale el `tenant_id` que estrecha todo lo demás — nunca al revés.
     *
     * @return array{state: string, invoice: object|null}
     */
    public static function resolve(string $plano): array
    {
        $fila = app(TenantContext::class)->withoutTenant(fn () => DB::table('invoices')
            ->where('public_token_hash', hash('sha256', $plano))
            ->whereNull('deleted_at')
            ->first());

        if ($fila === null) {
            return ['state' => 'notFound', 'invoice' => null];
        }

        if ($fila->voided_at !== null) {
            return ['state' => 'voided', 'invoice' => null];
        }

        if ($fila->public_token_expires_at !== null
            && CarbonImmutable::parse((string) $fila->public_token_expires_at)->isPast()) {
            return ['state' => 'expired', 'invoice' => null];
        }

        return ['state' => 'active', 'invoice' => $fila];
    }

    /**
     * Manda la factura al contacto del cliente.
     *
     * @return array{sent: bool, to: ?string}
     */
    public static function send(object $factura): array
    {
        $tenantId = (string) $factura->tenant_id;
        $destino = self::destinatario($tenantId, (string) $factura->carrier_id);

        if ($destino === null) {
            return ['sent' => false, 'to' => null];
        }

        $token = self::issue($factura);
        $marca = Brand::for($tenantId);
        $locale = $destino['locale'];

        $fichas = [
            'tenant' => $marca['name'],
            'invoice' => (string) $factura->invoice_number,
            'amount' => self::dinero((int) $factura->balance_cents),
            'url' => url('/'.$locale.'/i/'.$token),
        ];

        $mensaje = Templates::render(
            $tenantId,
            self::EVENTO,
            $locale,
            $fichas,
            self::linea('invoices.email.subject', $locale, $fichas),
            self::linea('invoices.email.body', $locale, $fichas),
        );

        $cuerpo = $mensaje['body'].($marca['emailFooter'] === null ? '' : "\n\n—\n".$marca['emailFooter']);

        try {
            Mail::mailer(config('mail.default'))->raw(
                $cuerpo,
                static function ($m) use ($destino, $mensaje): void {
                    $m->to($destino['email'])->subject($mensaje['subject']);
                },
            );
        } catch (Throwable $e) {
            // Que no salga el correo NO puede impedir emitir la factura: la
            // factura existe, el plazo corre, y el enlace queda creado para
            // mandarlo a mano. Lo contrario sería no poder facturar porque el
            // servidor de correo tuvo un mal minuto.
            Log::warning('No salió el correo de la factura', ['error' => $e->getMessage()]);

            return ['sent' => false, 'to' => $destino['email']];
        }

        return ['sent' => true, 'to' => $destino['email']];
    }

    /**
     * A quién se le manda la factura de este transportista, y en qué idioma.
     *
     * Facturación primero, principal después, correo de la empresa al final.
     *
     * @return array{email: string, locale: string}|null
     */
    public static function destinatario(string $tenantId, string $carrierId): ?array
    {
        $contactos = DB::table('carrier_contacts')
            ->where('tenant_id', $tenantId)
            ->where('carrier_id', $carrierId)
            ->whereNull('deleted_at')
            ->whereNotNull('email')
            ->get(['email', 'position', 'is_primary', 'preferred_locale']);

        $elegido = $contactos->firstWhere('position', 'billing')
            ?? $contactos->firstWhere('is_primary', 1)
            ?? $contactos->first();

        if ($elegido !== null && trim((string) $elegido->email) !== '') {
            return [
                'email' => trim((string) $elegido->email),
                'locale' => self::locale($elegido->preferred_locale),
            ];
        }

        $carrier = DB::table('carriers')
            ->where('tenant_id', $tenantId)
            ->where('id', $carrierId)
            ->first(['email', 'preferred_locale']);

        if ($carrier === null || trim((string) $carrier->email) === '') {
            return null;
        }

        return [
            'email' => trim((string) $carrier->email),
            'locale' => self::locale($carrier->preferred_locale),
        ];
    }

    private static function locale(mixed $valor): string
    {
        return in_array($valor, ['en', 'es'], true) ? (string) $valor : 'en';
    }

    private static function dinero(int $centavos): string
    {
        return '$'.number_format($centavos / 100, 2);
    }

    /** @param array<string, string> $params */
    private static function linea(string $clave, string $locale, array $params): string
    {
        $texto = __($clave, [], $locale);

        if (! is_string($texto)) {
            return $clave;
        }

        return Templates::sustituir($texto, $params);
    }
}
