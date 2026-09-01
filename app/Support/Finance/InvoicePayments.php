<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Los intentos de cobro de una factura, y el cobro que entra.
 *
 * ## Intento y cobro son dos cosas
 *
 * `payment_attempts` guarda TODO lo que se intentó: el que salió bien, el que
 * falló por fondos, el que el cliente abandonó a medias. `payments` guarda solo
 * el dinero que llegó.
 *
 * La diferencia importa el día que un cliente dice que lo intentó tres veces y
 * no le funcionó. Con solo `payments` la respuesta es «no consta ningún pago»,
 * que es cierta y no ayuda. Con los intentos se ve que hubo tres, con qué código
 * fallaron y a qué hora — y eso es lo que se le manda a la pasarela.
 *
 * ## La idempotencia la da el índice, no una comprobación
 *
 * `payment_attempts_idempotency_uq` es único sobre `idempotency_key`. Dos
 * pulsaciones del mismo botón mandan la MISMA clave, y la segunda inserción
 * revienta contra el índice en vez de convertirse en un segundo cobro. Es la
 * misma decisión que el libro de sucesos del lote 54, y por el mismo motivo: una
 * comprobación de «¿ya existe?» seguida de un insert tiene una ventana entre las
 * dos, y las pasarelas reintentan justo ahí.
 *
 * ## Marcar pagada la factura es del suceso, no del navegador
 *
 * La vuelta del cliente a la página no cambia nada. Lo que mueve la factura es
 * el resultado que da el proveedor. Es lo mismo que decidió el lote 54 para la
 * suscripción, y por la misma razón: quien paga y se queda sin cobertura porque
 * cerró la pestaña es el caso que hay que evitar.
 */
final class InvoicePayments
{
    /**
     * El intento PENDIENTE de esta factura por este importe, si lo hay.
     *
     * Es lo que hace que dos pulsaciones del mismo botón sean un solo intento —
     * y, a la vez, que después de un pago rechazado se pueda volver a intentar.
     *
     * Atarlo a una clave fija por factura e importe tenía las dos propiedades al
     * revés: el doble clic se colapsaba bien, y un cobro rechazado dejaba la
     * factura IMPAGABLE PARA SIEMPRE, porque el segundo intento chocaba contra
     * la clave del primero. Lo encontró el navegador, recorriendo el camino del
     * fallo antes que el del éxito.
     */
    public static function pendiente(string $tenantId, string $invoiceId, int $amountCents): ?object
    {
        return DB::table('payment_attempts')
            ->where('tenant_id', $tenantId)
            ->where('invoice_id', $invoiceId)
            ->where('amount_cents', $amountCents)
            ->where('status', 'pending')
            ->orderByDesc('attempted_at')
            ->first();
    }

    /**
     * Registra un intento. Devuelve su id, o null si esa clave ya se usó.
     *
     * Null NO es un error: significa «esto ya se intentó», que es exactamente lo
     * que la clave existe para decir.
     */
    public static function start(
        string $tenantId,
        string $invoiceId,
        int $amountCents,
        string $method,
        string $idempotencyKey,
        ?string $providerReference,
    ): ?string {
        $id = (string) Str::uuid();
        $ahora = CarbonImmutable::now();

        try {
            DB::table('payment_attempts')->insert([
                'id' => $id,
                'tenant_id' => $tenantId,
                'invoice_id' => $invoiceId,
                'method' => $method,
                'amount_cents' => $amountCents,
                'status' => 'pending',
                'idempotency_key' => $idempotencyKey,
                'provider_reference' => $providerReference,
                'attempted_at' => $ahora,
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ]);
        } catch (\Illuminate\Database\UniqueConstraintViolationException) {
            return null;
        }

        return $id;
    }

    /**
     * El resultado de un intento.
     *
     * Si salió bien: se anota el cobro en `payments`, se suma a la factura y, si
     * queda saldada, se marca pagada. Todo en una transacción — un cobro anotado
     * con una factura que sigue debiendo es peor que ninguno de los dos.
     */
    public static function settle(
        string $idempotencyKey,
        bool $ok,
        ?string $failureCode = null,
        ?string $failureMessage = null,
        ?string $providerReference = null,
    ): bool {
        return app(TenantContext::class)->withoutTenant(function () use (
            $idempotencyKey, $ok, $failureCode, $failureMessage, $providerReference
        ): bool {
            $intento = DB::table('payment_attempts')
                ->where('idempotency_key', $idempotencyKey)
                ->first();

            if ($intento === null || $intento->status !== 'pending') {
                // Ya resuelto: un reintento del proveedor no vuelve a cobrar.
                return false;
            }

            return DB::transaction(function () use (
                $intento, $ok, $failureCode, $failureMessage, $providerReference
            ): bool {
                $ahora = CarbonImmutable::now();

                DB::table('payment_attempts')->where('id', $intento->id)->update([
                    'status' => $ok ? 'succeeded' : 'failed',
                    'failure_code' => $ok ? null : $failureCode,
                    'failure_message' => $ok ? null : $failureMessage,
                    'provider_reference' => $providerReference ?? $intento->provider_reference,
                    'updated_at' => $ahora,
                ]);

                if (! $ok) {
                    return true;
                }

                $paymentId = (string) Str::uuid();

                DB::table('payments')->insert([
                    'id' => $paymentId,
                    'tenant_id' => $intento->tenant_id,
                    'invoice_id' => $intento->invoice_id,
                    'amount_cents' => $intento->amount_cents,
                    'method' => $intento->method,
                    'status' => 'succeeded',
                    'reference' => $providerReference ?? $intento->provider_reference,
                    'received_at' => $ahora,
                    // Sin `recorded_by_user_id`: no lo anotó una persona. Poner
                    // ahí al despachador diría que él lo registró a mano, que es
                    // justo lo que este lote deja de hacer falta.
                    'created_at' => $ahora,
                    'updated_at' => $ahora,
                ]);

                DB::table('payment_attempts')->where('id', $intento->id)
                    ->update(['payment_id' => $paymentId, 'updated_at' => $ahora]);

                self::aplicarALaFactura((string) $intento->invoice_id, (int) $intento->amount_cents, $ahora);

                return true;
            });
        });
    }

    /** Suma el cobro a la factura y la cierra si ya no debe nada. */
    private static function aplicarALaFactura(string $invoiceId, int $centavos, CarbonImmutable $ahora): void
    {
        $factura = DB::table('invoices')->where('id', $invoiceId)->first();

        if ($factura === null) {
            return;
        }

        $pagado = (int) $factura->amount_paid_cents + $centavos;
        $saldo = max(0, (int) $factura->total_cents - $pagado);

        DB::table('invoices')->where('id', $invoiceId)->update([
            'amount_paid_cents' => $pagado,
            'balance_cents' => $saldo,
            // Solo se marca pagada cuando NO QUEDA NADA. Un pago parcial deja la
            // factura viva: darla por pagada con saldo pendiente es cómo se
            // pierde dinero sin que salte ninguna alarma.
            'status' => $saldo === 0 ? 'paid' : $factura->status,
            'paid_at' => $saldo === 0 ? $ahora : $factura->paid_at,
            'updated_at' => $ahora,
        ]);
    }

    /**
     * Los intentos de una factura, para la pantalla de finanzas.
     *
     * @return list<array<string, mixed>>
     */
    public static function forInvoice(string $tenantId, string $invoiceId): array
    {
        return DB::table('payment_attempts')
            ->where('tenant_id', $tenantId)
            ->where('invoice_id', $invoiceId)
            ->orderByDesc('attempted_at')
            ->get(['id', 'method', 'amount_cents', 'status', 'failure_code', 'attempted_at'])
            ->map(static fn (object $a): array => [
                'id' => (string) $a->id,
                'method' => (string) $a->method,
                'amountCents' => (int) $a->amount_cents,
                'status' => (string) $a->status,
                'failureCode' => $a->failure_code,
                'attemptedAt' => substr((string) $a->attempted_at, 0, 16),
            ])
            ->all();
    }
}
