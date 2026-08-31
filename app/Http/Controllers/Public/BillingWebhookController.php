<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Services\Billing\BillingEvent;
use App\Services\Billing\BillingProvider;
use App\Support\Billing\EventLedger;
use App\Support\Billing\Subscriptions;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Los sucesos del proveedor de cobro.
 *
 * Es el único punto de entrada de la aplicación que es PÚBLICO, sin sesión, y
 * capaz de cambiar el dinero. Cada decisión de aquí sale de eso.
 *
 * ## 1. La firma es la puerta, y va primero
 *
 * Antes de mirar nada más. Sin ella, cualquiera que conozca la URL manda un
 * «pago recibido» y se activa la suscripción que quiera, gratis. Y se comprueba
 * con el CUERPO EN CRUDO, no con lo que Laravel haya decodificado: la firma es
 * sobre los bytes, y volver a serializar un array cambia un espacio y la
 * invalida.
 *
 * ## 2. Se contesta 200 casi siempre, y no por pereza
 *
 * Un proveedor de pagos reintenta lo que no le contesta bien, con espera
 * creciente, durante días. Eso es exactamente lo que se quiere para un fallo
 * transitorio —una base de datos que no respondió— y exactamente lo que NO se
 * quiere para un suceso que ya procesamos o que no nos interesa: reintentarlo
 * mil veces no lo mejora, y el ruido tapa los reintentos que sí importan.
 *
 * Así que: firma mal → 400 y no se vuelve a intentar. Suceso repetido o
 * ignorado → 200. Fallo nuestro al procesarlo → 500, para que vuelva.
 *
 * ## 3. Sin empresa en el contexto
 *
 * No hay sesión, así que `ResolveTenant` no ha puesto ninguna. Todo lo que
 * escribe este camino usa `DB::table` con la empresa que venga en el suceso, y
 * las lecturas van dentro de `withoutTenant()`. Confiar en un contexto que no
 * existe es cómo se escriben filas con `tenant_id` nulo.
 */
final class BillingWebhookController
{
    public function __invoke(Request $request, BillingProvider $provider, TenantContext $context): Response
    {
        // El cuerpo en crudo. La firma es sobre los bytes.
        $cuerpo = $request->getContent();
        $firma = (string) ($request->header('Stripe-Signature') ?? $request->header('X-Billing-Signature') ?? '');

        $evento = $provider->parseWebhook($cuerpo, $firma);

        if ($evento === null) {
            // 400 y no 401: no hay nadie a quien pedirle que se identifique. Y
            // sin cuerpo del error, que no se le explica a quien lo intenta qué
            // le falta.
            Log::warning('Suceso de cobro con firma inválida', ['ip' => $request->ip()]);

            return response('', 400);
        }

        return $context->withoutTenant(function () use ($evento): Response {
            $filaId = EventLedger::record($evento);

            if ($filaId === null) {
                // Ya estaba. Es lo NORMAL, no un error: el proveedor reenvía por
                // diseño. 200 para que deje de reenviar.
                return response('', 200);
            }

            if ($evento->type === BillingEvent::IGNORED) {
                EventLedger::ignored($filaId);

                return response('', 200);
            }

            try {
                $resultado = Subscriptions::apply($evento);
            } catch (Throwable $e) {
                EventLedger::failed($filaId, $e->getMessage());

                Log::error('No se pudo aplicar un suceso de cobro', [
                    'event' => $evento->id,
                    'type' => $evento->providerType,
                    'error' => $e->getMessage(),
                ]);

                // 500 a propósito: que vuelva. Un pago que no se aplicó por un
                // fallo nuestro tiene que reintentarse, y el proveedor es quien
                // sabe hacerlo bien.
                return response('', 500);
            }

            EventLedger::processed($filaId);

            Log::info('Suceso de cobro aplicado', ['event' => $evento->id, 'result' => $resultado]);

            return response('', 200);
        });
    }
}
