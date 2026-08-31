<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Services\Billing\BillingProvider;
use App\Services\Billing\MockBillingProvider;
use App\Support\InertiaPage;
use App\Support\TenantContext;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * La página de pago del adaptador simulado.
 *
 * Existe para que el arco entero —ir a pagar, pagar, que llegue el suceso, que
 * se active la suscripción— funcione sin credenciales de nadie: en la
 * demostración, en las pruebas, y en el portátil de quien esté trabajando.
 *
 * Tiene DOS botones, pagar y fallar, y el segundo es el importante. El camino
 * del pago rechazado es el que nadie prueba y el que más se sufre, porque es el
 * que deja a un cliente sin sistema. Con un proveedor de verdad hace falta una
 * tarjeta de prueba especial para provocarlo; aquí es un botón.
 *
 * La ruta va FIRMADA y caduca. Sin firma, cualquiera podría abrir la página de
 * pago de otra empresa y activarle la suscripción — que es justo lo que este
 * módulo existe para que no pase.
 *
 * Se registra siempre, también con Stripe configurado, y no pasa nada: solo
 * responde si el proveedor atado es el simulado. Quitarla del enrutador según la
 * configuración haría que las pruebas del arco dependieran de qué hay en el
 * `.env`, que es lo contrario de una prueba.
 */
final class MockCheckoutController
{
    use InertiaPage;

    public function show(Request $request, BillingProvider $provider): Response
    {
        $this->soloSimulado($provider);
        $this->usesDictionary($request, ['billing', 'common']);

        return Inertia::render('Public/MockCheckout', [
            'reference' => (string) $request->query('reference'),
            'tenant' => (string) $request->query('tenant'),
            'plan' => (string) $request->query('plan'),
            'returnUrl' => base64_decode((string) $request->query('return'), true) ?: '/billing',
            'cancelUrl' => base64_decode((string) $request->query('cancel'), true) ?: '/billing',
            // La URL firmada entera, para poder reenviarla al decidir.
            'action' => $request->fullUrl(),
        ]);
    }

    /**
     * Decide: pagar o fallar.
     *
     * Y aquí está lo que hace que este simulacro valga: NO toca la suscripción.
     * Fabrica el suceso, lo firma, y lo manda al webhook igual que haría el
     * proveedor. Si atajara —si activara la suscripción directamente— el camino
     * que se prueba no sería el que corre en producción, y el arco de verdad
     * quedaría sin probar precisamente donde importa.
     */
    public function decide(Request $request, BillingProvider $provider): RedirectResponse
    {
        $this->soloSimulado($provider);

        $datos = $request->validate([
            'decision' => ['required', 'in:pay,fail'],
            'reference' => ['required', 'string', 'max:120'],
            'tenant' => ['required', 'string', 'size:36'],
            'plan' => ['required', 'string', 'max:40'],
            'return' => ['required', 'string'],
            'cancel' => ['required', 'string'],
        ]);

        $ahora = time();

        $suceso = [
            'id' => 'evt_mock_'.Str::lower(Str::random(24)),
            'type' => $datos['decision'] === 'pay' ? 'paid' : 'payment_failed',
            'tenant_id' => $datos['tenant'],
            'customer_id' => 'cus_mock_'.substr($datos['tenant'], 0, 8),
            'subscription_id' => 'sub_mock_'.substr($datos['tenant'], 0, 8),
            'plan_code' => $datos['plan'],
            'period_start' => $ahora,
            'period_end' => strtotime('+1 month', $ahora),
            'failure_message' => $datos['decision'] === 'fail' ? 'La tarjeta fue rechazada (simulado).' : null,
            'checkout_reference' => $datos['reference'],
        ];

        $cuerpo = (string) json_encode($suceso);

        /** @var MockBillingProvider $provider */
        $firma = $provider->sign($cuerpo);

        // Se entrega al MISMO controlador del webhook, invocándolo, no por HTTP.
        //
        // La primera versión hacía `Http::post(url('/billing/webhook'))`, que es
        // lo que haría el proveedor de verdad, y parecía lo más fiel. Lo encontró
        // el navegador: el servidor se quedaba TREINTA SEGUNDOS colgado y
        // devolvía un error. Una petición que llama por red a su propio servidor
        // espera a un trabajador que está ocupado siendo ella misma — con un
        // solo proceso PHP eso es un abrazo mortal, y un servidor pequeño en
        // producción tiene exactamente un proceso libre menos de los que cree.
        //
        // Invocándolo se recorre el mismo camino en todo lo que importa: se
        // comprueba la firma, se escribe el libro, se aplica el ciclo. Lo único
        // que no se ejerce es el enrutado —la exención de CSRF y el limitador—
        // y eso sí lo prueban las pruebas, que llaman a la ruta de verdad.
        $peticion = Request::create('/billing/webhook', 'POST', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X-Billing-Signature' => $firma,
        ], $cuerpo);

        app(BillingWebhookController::class)($peticion, $provider, app(TenantContext::class));

        $destino = base64_decode((string) $datos['return'], true) ?: '/billing';

        return redirect()->away($destino);
    }

    private function soloSimulado(BillingProvider $provider): void
    {
        if (! $provider instanceof MockBillingProvider) {
            // 404 y no 403: con un proveedor de verdad atado, esta página
            // sencillamente no existe.
            throw new NotFoundHttpException;
        }
    }
}
