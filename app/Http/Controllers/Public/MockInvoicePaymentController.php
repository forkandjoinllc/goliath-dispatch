<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Services\Payments\InvoicePaymentProvider;
use App\Support\Finance\InvoicePayments;
use App\Support\InertiaPage;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * La página de pago cuando no hay pasarela.
 *
 * Existe para poder recorrer entero el camino del FALLO, que es el que casi
 * nadie prueba y el que más se sufre. Solo responde con el adaptador simulado
 * atado: si algún día hay pasarela de verdad, esta ruta contesta 404 en vez de
 * ofrecer una forma de dar por cobrada una factura sin pagarla.
 *
 * Y la lección del lote 54: NO se llama a sí misma por HTTP. Resuelve el intento
 * invocando App\Support\Finance\InvoicePayments directamente. Una petición que
 * llama por red a su propio servidor espera a un trabajador que está ocupado
 * siendo ella misma.
 */
final class MockInvoicePaymentController
{
    use InertiaPage;

    public function show(Request $request, InvoicePaymentProvider $provider): Response
    {
        $this->soloSimulado($provider);
        $this->usesDictionary($request, ['invoices', 'common']);

        return Inertia::render('Public/MockInvoicePayment', [
            'reference' => (string) $request->query('reference'),
            'key' => (string) $request->query('key'),
            'amountCents' => (int) $request->query('amount'),
            'returnUrl' => base64_decode((string) $request->query('return'), true) ?: '/',
            'action' => $request->fullUrl(),
        ]);
    }

    public function decide(Request $request, InvoicePaymentProvider $provider): RedirectResponse
    {
        $this->soloSimulado($provider);

        $datos = $request->validate([
            'decision' => ['required', 'in:pay,fail'],
            'key' => ['required', 'string', 'max:120'],
            'reference' => ['required', 'string', 'max:255'],
            'return' => ['required', 'string'],
        ]);

        InvoicePayments::settle(
            idempotencyKey: $datos['key'],
            ok: $datos['decision'] === 'pay',
            failureCode: $datos['decision'] === 'pay' ? null : 'card_declined',
            failureMessage: $datos['decision'] === 'pay' ? null : 'Simulacro: pago rechazado.',
            providerReference: $datos['reference'],
        );

        return redirect()->away(base64_decode($datos['return'], true) ?: '/');
    }

    private function soloSimulado(InvoicePaymentProvider $provider): void
    {
        abort_if($provider->isLive(), 404);
    }
}
