<?php

declare(strict_types=1);

namespace App\Support\Billing;

use App\Services\Billing\BillingEvent;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * El ciclo de una suscripción, movido por los sucesos del proveedor.
 *
 * ## El webhook es la fuente de la verdad, no la vuelta del navegador
 *
 * Es la decisión que gobierna todo lo demás y la que más fácil es equivocar.
 *
 * Lo tentador es activar la suscripción cuando la persona vuelve de pagar: el
 * navegador aterriza en `/billing/done`, se marca `active`, y se acabó. Y
 * funciona el 95% de las veces, que es justo lo que lo hace peligroso.
 *
 * El otro 5% es: paga, se le va el móvil, cierra la pestaña, el pago SÍ ocurre y
 * su suscripción se queda en `past_due` para siempre. Nos ha pagado y le hemos
 * dejado sin sistema. Se descubre por una llamada furiosa, no por un registro.
 *
 * Así que la vuelta del navegador no cambia NADA: solo enseña una página. Quien
 * mueve la suscripción es el suceso del proveedor, que llega aunque no haya
 * nadie mirando y se reintenta si fallamos.
 *
 * ## Los estados
 *
 * El CHECK de `tenant_subscriptions.status` admite seis:
 * `trialing | active | past_due | suspended | cancelled | incomplete`.
 *
 *  - `trialing` → `active` al primer pago.
 *  - `active` → `past_due` cuando un cobro falla. NO se suspende: cortarle el
 *    acceso a una empresa porque su tarjeta caducó un martes es una decisión de
 *    negocio y no le toca tomarla a un webhook. Suspender sigue siendo un acto
 *    humano y explícito desde la pantalla de plataforma — igual que decidió el
 *    lote del barrido de avisos, y por la misma razón.
 *  - `past_due` → `active` cuando el pago siguiente entra.
 *  - cualquiera → `cancelled` cuando el proveedor dice que se acabó.
 */
final class Subscriptions
{
    /**
     * Aplica un suceso a la suscripción que le corresponde.
     *
     * @return string qué se hizo, para el rastro
     */
    public static function apply(BillingEvent $evento): string
    {
        $suscripcion = self::find($evento);

        if ($suscripcion === null) {
            // No se inventa una empresa a partir de un suceso. Un suceso sin
            // suscripción reconocible se anota en el libro y no toca nada: es
            // más honesto que adivinar a quién activar.
            return 'sin suscripción';
        }

        return match ($evento->type) {
            BillingEvent::PAID => self::markPaid($suscripcion, $evento),
            BillingEvent::PAYMENT_FAILED => self::markFailed($suscripcion, $evento),
            BillingEvent::CANCELLED => self::markCancelled($suscripcion),
            default => 'ignorado',
        };
    }

    private static function markPaid(object $s, BillingEvent $e): string
    {
        $cambios = [
            'status' => 'active',
            // Se limpia: si la empresa venía de un impago, ya no lo debe.
            'past_due_since' => null,
            'updated_at' => now(),
        ];

        if ($e->customerId !== null) {
            $cambios['stripe_customer_id'] = $e->customerId;
        }

        if ($e->subscriptionId !== null) {
            $cambios['stripe_subscription_id'] = $e->subscriptionId;
        }

        if ($e->periodStart !== null) {
            $cambios['current_period_start'] = CarbonImmutable::createFromTimestamp($e->periodStart);
        }

        if ($e->periodEnd !== null) {
            $cambios['current_period_end'] = CarbonImmutable::createFromTimestamp($e->periodEnd);
        }

        // Cambiar de plan también pasa por aquí: la sesión de pago llevaba el
        // código del plan y el suceso lo devuelve.
        if ($e->planCode !== null) {
            $planId = DB::table('saas_plans')->where('code', $e->planCode)->value('id');

            if ($planId !== null) {
                $cambios['plan_id'] = $planId;
            }
        }

        DB::table('tenant_subscriptions')->where('id', $s->id)->update($cambios);

        // La empresa vuelve a estar al corriente. `tenants.status` es lo que
        // mira el resto del sistema; dejarlo en `past_due` después de cobrar
        // sería la misma clase de mentira que este proyecto lleva persiguiendo.
        self::syncTenantStatus((string) $s->tenant_id, 'active');

        return 'activada';
    }

    private static function markFailed(object $s, BillingEvent $e): string
    {
        DB::table('tenant_subscriptions')->where('id', $s->id)->update([
            'status' => 'past_due',
            // La fecha del PRIMER impago, no la del último. Es lo que contesta
            // «¿cuánto lleva debiendo?», que es la pregunta con la que alguien
            // decide suspender. Sobreescribirla en cada reintento la volvería
            // «lleva debiendo desde ayer» para siempre.
            'past_due_since' => $s->past_due_since ?? now(),
            'updated_at' => now(),
        ]);

        self::syncTenantStatus((string) $s->tenant_id, 'past_due');

        return 'impago';
    }

    private static function markCancelled(object $s): string
    {
        DB::table('tenant_subscriptions')->where('id', $s->id)->update([
            'status' => 'cancelled',
            'cancelled_at' => now(),
            'updated_at' => now(),
        ]);

        // Cancelada NO es suspendida. La empresa deja de pagar y conserva el
        // acceso hasta que una persona decida otra cosa: sus cargas, sus
        // facturas y sus documentos siguen siendo suyos, y el sistema no es
        // quién para cerrarles la puerta por su cuenta.
        self::syncTenantStatus((string) $s->tenant_id, 'cancelled');

        return 'cancelada';
    }

    /**
     * Encuentra la suscripción del suceso.
     *
     * Por el id del proveedor primero, y por la empresa de los metadatos
     * después. Los dos caminos existen porque el primer suceso de una empresa
     * —el que la convierte en cliente— todavía no tiene id de suscripción
     * guardado por nuestra parte: viene en el suceso y es justo lo que hay que
     * aprender de él.
     */
    private static function find(BillingEvent $e): ?object
    {
        if ($e->subscriptionId !== null) {
            $fila = DB::table('tenant_subscriptions')
                ->where('stripe_subscription_id', $e->subscriptionId)
                ->first();

            if ($fila !== null) {
                return $fila;
            }
        }

        if ($e->tenantId !== null) {
            return DB::table('tenant_subscriptions')->where('tenant_id', $e->tenantId)->first();
        }

        return null;
    }

    /**
     * Mantiene `tenants.status` de acuerdo con la suscripción.
     *
     * Son dos columnas que dicen cosas parecidas y NO son la misma: la empresa
     * puede estar suspendida por un motivo que no tenga nada que ver con el
     * dinero. Por eso `suspended` no se toca desde aquí nunca — lo pone una
     * persona y solo una persona lo quita.
     */
    private static function syncTenantStatus(string $tenantId, string $nuevo): void
    {
        $actual = (string) DB::table('tenants')->where('id', $tenantId)->value('status');

        if ($actual === 'suspended') {
            return;
        }

        DB::table('tenants')->where('id', $tenantId)->update([
            'status' => $nuevo,
            'updated_at' => now(),
        ]);
    }
}
