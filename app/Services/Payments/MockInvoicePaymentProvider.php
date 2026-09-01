<?php

declare(strict_types=1);

namespace App\Services\Payments;

use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;

/**
 * El cobro de facturas SIN pasarela.
 *
 * Manda a una página propia donde se elige si el pago entra o falla. Existe para
 * que el camino del fallo —el que casi nadie prueba y el que más se sufre— se
 * pueda recorrer entero sin una cuenta de Stripe.
 *
 * `isLive()` devuelve falso y la pantalla lo dice. Un cobro simulado que se
 * presentara como real sería la peor mentira que este módulo podría contar.
 */
final class MockInvoicePaymentProvider implements InvoicePaymentProvider
{
    public function checkoutUrl(
        string $tenantId,
        string $invoiceId,
        int $amountCents,
        string $idempotencyKey,
        string $returnUrl,
    ): PaymentSession {
        $referencia = 'pi_mock_'.Str::lower(Str::random(24));

        // Firmada y temporal: sin firma, cualquiera podría abrir la página de
        // pago simulada de OTRA factura y darla por cobrada.
        $url = URL::temporarySignedRoute('invoices.mock.pay', now()->addHours(2), [
            'reference' => $referencia,
            'key' => $idempotencyKey,
            'amount' => $amountCents,
            'return' => base64_encode($returnUrl),
        ]);

        return new PaymentSession($url, $referencia);
    }

    public function isLive(): bool
    {
        return false;
    }

    public function name(): string
    {
        return 'mock';
    }
}
