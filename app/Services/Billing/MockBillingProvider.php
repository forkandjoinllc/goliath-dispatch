<?php

declare(strict_types=1);

namespace App\Services\Billing;

use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;

/**
 * El cobro sin proveedor: el arco entero, sin credenciales de nadie.
 *
 * No es un doble de pruebas: es el adaptador que corre en la demostración y en
 * cualquier instalación sin claves de Stripe. Hace lo mismo que el de verdad
 * salvo mover dinero — manda a una página de pago, esa página vuelve, y llega un
 * suceso firmado que activa la suscripción.
 *
 * La «página de pago» es una ruta de la propia aplicación con dos botones,
 * pagar y fallar. Que se pueda fallar a voluntad es lo importante: el camino del
 * pago rechazado es el que nadie prueba y el que más se sufre, porque es el que
 * deja a un cliente sin sistema.
 *
 * ## La firma también se comprueba aquí
 *
 * Podría aceptar cualquier cosa —es un simulacro— y no lo hace: firma con la
 * clave de la aplicación y verifica igual que el real. Si el simulacro se
 * saltara la comprobación, el camino de «firma inválida» no se probaría nunca y
 * el día de conectar Stripe de verdad se descubriría que nunca funcionó.
 */
final class MockBillingProvider implements BillingProvider
{
    public function checkoutUrl(
        string $tenantId,
        string $planCode,
        string $customerEmail,
        string $returnUrl,
        string $cancelUrl,
    ): CheckoutSession {
        $referencia = 'cs_mock_'.Str::lower(Str::random(24));

        // Firmada y temporal: sin firma, cualquiera podría abrir la página de
        // pago simulada de OTRA empresa y activarle la suscripción.
        $url = URL::temporarySignedRoute('billing.mock.checkout', now()->addHours(2), [
            'reference' => $referencia,
            'tenant' => $tenantId,
            'plan' => $planCode,
            'return' => base64_encode($returnUrl),
            'cancel' => base64_encode($cancelUrl),
        ]);

        return new CheckoutSession($url, $referencia);
    }

    public function parseWebhook(string $payload, string $signature): ?BillingEvent
    {
        if (! hash_equals($this->sign($payload), $signature)) {
            return null;
        }

        /** @var array<string, mixed>|null $datos */
        $datos = json_decode($payload, true);

        if (! is_array($datos) || ! isset($datos['id'], $datos['type'])) {
            return null;
        }

        $tipo = (string) $datos['type'];

        return new BillingEvent(
            id: (string) $datos['id'],
            type: in_array($tipo, BillingEvent::TYPES, true) ? $tipo : BillingEvent::IGNORED,
            providerType: 'mock.'.$tipo,
            tenantId: isset($datos['tenant_id']) ? (string) $datos['tenant_id'] : null,
            customerId: isset($datos['customer_id']) ? (string) $datos['customer_id'] : null,
            subscriptionId: isset($datos['subscription_id']) ? (string) $datos['subscription_id'] : null,
            planCode: isset($datos['plan_code']) ? (string) $datos['plan_code'] : null,
            periodStart: isset($datos['period_start']) ? (int) $datos['period_start'] : null,
            periodEnd: isset($datos['period_end']) ? (int) $datos['period_end'] : null,
            failureMessage: isset($datos['failure_message']) ? (string) $datos['failure_message'] : null,
            payload: $datos,
        );
    }

    public function portalUrl(string $customerId, string $returnUrl): ?string
    {
        // El proveedor de verdad tiene un portal de cliente. El simulacro no
        // inventa uno: devuelve nulo y la pantalla no pinta el enlace, que es
        // más honesto que llevar a una página vacía.
        return null;
    }

    public function isLive(): bool
    {
        return false;
    }

    public function name(): string
    {
        return 'mock';
    }

    /**
     * La firma de un cuerpo, para que el simulacro se comporte como el real.
     *
     * Con la clave de la aplicación, que ya existe y no hay que configurar.
     */
    public function sign(string $payload): string
    {
        return hash_hmac('sha256', $payload, (string) config('app.key'));
    }
}
