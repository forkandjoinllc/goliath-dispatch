<?php

declare(strict_types=1);

namespace App\Services\Billing;

use Illuminate\Http\Client\Factory as Http;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Stripe de verdad, por su API HTTP.
 *
 * Sin la librería oficial y a propósito: lo que se usa aquí son tres llamadas
 * —crear una sesión de pago, crear una sesión de portal, y verificar una firma—
 * y el resto de esa librería es superficie que habría que mantener al día sin
 * usarla. La firma se verifica con el algoritmo publicado, que son quince
 * líneas y no cambia.
 *
 * ## La firma es la única puerta
 *
 * El webhook es un punto de entrada PÚBLICO y sin sesión. Sin verificar la
 * firma, cualquiera que conozca la URL manda un «pago recibido» y se activa la
 * suscripción de quien quiera, gratis. Por eso `parseWebhook()` devuelve nulo
 * antes de mirar nada más, y por eso el simulacro también firma: el camino de
 * «firma inválida» tiene que probarse con el adaptador que corre en las pruebas.
 *
 * La tolerancia de tiempo evita que alguien reenvíe un suceso legítimo de hace
 * un mes. Cinco minutos es lo que recomienda el proveedor.
 *
 * NUNCA se recibe ni se guarda un dato de tarjeta. El pago pasa en una página
 * alojada por Stripe. Ver la nota de BillingProvider.
 */
final class StripeBillingProvider implements BillingProvider
{
    private const BASE = 'https://api.stripe.com/v1';

    /** Margen de reenvío admitido para un suceso, en segundos. */
    private const TOLERANCIA = 300;

    public function __construct(
        private readonly Http $http,
        private readonly string $secret,
        private readonly string $webhookSecret,
    ) {}

    public function checkoutUrl(
        string $tenantId,
        string $planCode,
        string $customerEmail,
        string $returnUrl,
        string $cancelUrl,
    ): CheckoutSession {
        $priceId = (string) DB::table('saas_plans')->where('code', $planCode)->value('stripe_price_id');

        $respuesta = $this->http
            ->withToken($this->secret)
            ->asForm()
            ->post(self::BASE.'/checkout/sessions', [
                'mode' => 'subscription',
                'line_items[0][price]' => $priceId,
                'line_items[0][quantity]' => 1,
                'customer_email' => $customerEmail,
                'success_url' => $returnUrl,
                'cancel_url' => $cancelUrl,
                // La empresa viaja en los metadatos y vuelve en el suceso. Es lo
                // que permite saber a quién activar sin fiarse de la vuelta del
                // navegador, que puede no ocurrir nunca.
                'metadata[tenant_id]' => $tenantId,
                'metadata[plan_code]' => $planCode,
                'subscription_data[metadata][tenant_id]' => $tenantId,
                'subscription_data[metadata][plan_code]' => $planCode,
            ]);

        if (! $respuesta->successful()) {
            throw new \RuntimeException('Stripe rechazó la sesión de pago: '.$respuesta->body());
        }

        return new CheckoutSession(
            url: (string) $respuesta->json('url'),
            reference: (string) $respuesta->json('id'),
        );
    }

    public function parseWebhook(string $payload, string $signature): ?BillingEvent
    {
        if (! $this->firmaValida($payload, $signature)) {
            return null;
        }

        /** @var array<string, mixed>|null $suceso */
        $suceso = json_decode($payload, true);

        if (! is_array($suceso) || ! isset($suceso['id'], $suceso['type'])) {
            return null;
        }

        $tipoStripe = (string) $suceso['type'];
        $objeto = $suceso['data']['object'] ?? [];
        $meta = $objeto['metadata'] ?? [];

        return new BillingEvent(
            id: (string) $suceso['id'],
            // El vocabulario propio. Los nombres de Stripe cambian con su
            // versión de API; el ciclo de la suscripción no tiene por qué
            // enterarse.
            type: match ($tipoStripe) {
                'checkout.session.completed', 'invoice.paid', 'invoice.payment_succeeded' => BillingEvent::PAID,
                'invoice.payment_failed' => BillingEvent::PAYMENT_FAILED,
                'customer.subscription.deleted' => BillingEvent::CANCELLED,
                default => BillingEvent::IGNORED,
            },
            providerType: $tipoStripe,
            tenantId: isset($meta['tenant_id']) ? (string) $meta['tenant_id'] : null,
            customerId: isset($objeto['customer']) ? (string) $objeto['customer'] : null,
            subscriptionId: isset($objeto['subscription'])
                ? (string) $objeto['subscription']
                : (isset($objeto['id']) && str_starts_with((string) $objeto['id'], 'sub_') ? (string) $objeto['id'] : null),
            planCode: isset($meta['plan_code']) ? (string) $meta['plan_code'] : null,
            periodStart: isset($objeto['current_period_start']) ? (int) $objeto['current_period_start'] : null,
            periodEnd: isset($objeto['current_period_end']) ? (int) $objeto['current_period_end'] : null,
            failureMessage: isset($objeto['last_payment_error']['message'])
                ? (string) $objeto['last_payment_error']['message']
                : null,
            payload: is_array($suceso) ? $suceso : [],
        );
    }

    public function portalUrl(string $customerId, string $returnUrl): ?string
    {
        $respuesta = $this->http
            ->withToken($this->secret)
            ->asForm()
            ->post(self::BASE.'/billing_portal/sessions', [
                'customer' => $customerId,
                'return_url' => $returnUrl,
            ]);

        if (! $respuesta->successful()) {
            // El portal es una comodidad, no el camino crítico. Si el proveedor
            // no lo da, la pantalla simplemente no pinta el enlace — mejor que
            // llevar a una página de error.
            Log::warning('No se pudo abrir el portal de facturación', ['status' => $respuesta->status()]);

            return null;
        }

        return (string) $respuesta->json('url');
    }

    public function isLive(): bool
    {
        return $this->secret !== '' && $this->webhookSecret !== '';
    }

    public function name(): string
    {
        return 'stripe';
    }

    /**
     * El algoritmo de firma publicado por Stripe.
     *
     * La cabecera es `t=<hora>,v1=<firma>[,v1=<otra>]`. Se firma
     * `<hora>.<cuerpo>` con el secreto del webhook y se compara en tiempo
     * constante.
     */
    private function firmaValida(string $payload, string $signature): bool
    {
        if ($this->webhookSecret === '') {
            return false;
        }

        $hora = null;
        $firmas = [];

        foreach (explode(',', $signature) as $parte) {
            [$clave, $valor] = array_pad(explode('=', trim($parte), 2), 2, '');

            if ($clave === 't') {
                $hora = (int) $valor;
            } elseif ($clave === 'v1') {
                $firmas[] = $valor;
            }
        }

        if ($hora === null || $firmas === []) {
            return false;
        }

        // Un suceso legítimo de hace un mes reenviado hoy no vale. Sin esto, a
        // quien capture una entrega le basta con repetirla.
        if (abs(time() - $hora) > self::TOLERANCIA) {
            return false;
        }

        $esperada = hash_hmac('sha256', $hora.'.'.$payload, $this->webhookSecret);

        foreach ($firmas as $f) {
            if (hash_equals($esperada, $f)) {
                return true;
            }
        }

        return false;
    }
}
