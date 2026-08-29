<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Authorization\Actor;
use App\Enums\AuditAction;
use App\Support\Audit;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * El libro de cobros de una factura.
 *
 * LA REGLA DE LA CASA: `invoices.amount_paid_cents` NO se incrementa; se
 * DERIVA de las filas de `payments` cada vez que algo cambia. Antes se sumaba
 * a mano sobre la columna y no se escribía ninguna fila, así que una factura
 * decía «cobrados 2.500» sin constancia de cuándo, con qué método, con qué
 * referencia ni quién lo anotó — y cuadrar contra el extracto del banco era
 * imposible.
 *
 * Derivar en vez de incrementar mata de raíz toda una familia de errores: dos
 * peticiones a la vez, un reembolso que se olvida de restar, una fila anulada
 * que sigue contando. La columna es una CACHÉ de la suma, no la verdad; la
 * verdad son las filas.
 *
 * Qué cuenta como dinero en casa: los cobros en estado `succeeded` o
 * `partially_refunded`, y de cada uno su importe MENOS lo reembolsado. Un cobro
 * `pending` —un cheque que todavía no ha compensado— no cuenta: está anotado
 * para no perderlo de vista, no para dar la factura por cobrada.
 */
final class PaymentLedger
{
    /** Estados en los que el dinero está de verdad en casa. */
    private const CUENTAN = ['succeeded', 'partially_refunded'];

    /**
     * Anota un cobro y recalcula la factura.
     *
     * @param  array{amount_cents: int, method: string, status: string, reference: ?string, received_at: ?string, notes: ?string}  $data
     * @return string  el id del cobro
     */
    public static function record(Actor $actor, object $invoice, array $data): string
    {
        return DB::transaction(function () use ($actor, $invoice, $data): string {
            $ahora = CarbonImmutable::now();
            $id = (string) Str::uuid();

            DB::table('payments')->insert([
                'id' => $id,
                'tenant_id' => $actor->tenantId,
                'invoice_id' => $invoice->id,
                'amount_cents' => $data['amount_cents'],
                'method' => $data['method'],
                'status' => $data['status'],
                'reference' => $data['reference'],
                // La fecha en que ENTRÓ el dinero, que no es la de hoy: los
                // cobros se anotan con días de retraso y cuadrar un mes exige
                // la fecha del banco, no la del teclado.
                'received_at' => $data['received_at'] !== null
                    ? CarbonImmutable::parse($data['received_at'])
                    : $ahora,
                'recorded_by_user_id' => $actor->auditUserId(),
                'notes' => $data['notes'],
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ]);

            Audit::record(
                $actor,
                AuditAction::PaymentRecorded,
                entityType: 'payment',
                entityId: $id,
                entityLabel: (string) $invoice->invoice_number,
                after: [
                    'amount_cents' => $data['amount_cents'],
                    'method' => $data['method'],
                    'status' => $data['status'],
                ],
            );

            self::resync($actor, (string) $invoice->id);

            return $id;
        });
    }

    /**
     * Devuelve dinero de un cobro concreto.
     *
     * Se reembolsa CONTRA UN COBRO y no contra la factura porque el dinero
     * vuelve por donde vino: a la tarjeta que se usó, a la cuenta que hizo la
     * transferencia. Un reembolso «de la factura» no sabría a cuál.
     */
    public static function refund(Actor $actor, object $payment, int $cents, ?string $reason): void
    {
        DB::transaction(function () use ($actor, $payment, $cents, $reason): void {
            $ahora = CarbonImmutable::now();
            $devuelto = (int) $payment->refunded_amount_cents + $cents;
            $total = (int) $payment->amount_cents;

            DB::table('payments')->where('id', $payment->id)->update([
                'refunded_amount_cents' => $devuelto,
                'refunded_at' => $ahora,
                // `refunded` solo cuando se devuelve TODO. Un reembolso parcial
                // sigue siendo un cobro que cuenta, por lo que queda.
                'status' => $devuelto >= $total ? 'refunded' : 'partially_refunded',
                'notes' => $reason ?? $payment->notes,
                'updated_at' => $ahora,
            ]);

            Audit::record(
                $actor,
                AuditAction::PaymentRefunded,
                entityType: 'payment',
                entityId: (string) $payment->id,
                entityLabel: (string) $payment->id,
                before: ['refunded_amount_cents' => (int) $payment->refunded_amount_cents],
                after: ['refunded_amount_cents' => $devuelto],
                reason: $reason,
            );

            self::resync($actor, (string) $payment->invoice_id);
        });
    }

    /**
     * Marca un cobro como disputado.
     *
     * Deja de contar como dinero en casa desde ese momento: el banco puede
     * retirarlo. Dar por cobrada una factura cuyo pago está en disputa es
     * exactamente el error que este estado existe para evitar.
     */
    public static function dispute(Actor $actor, object $payment, string $reason): void
    {
        DB::transaction(function () use ($actor, $payment, $reason): void {
            $ahora = CarbonImmutable::now();

            DB::table('payments')->where('id', $payment->id)->update([
                'status' => 'disputed',
                'disputed_at' => $ahora,
                'dispute_reason' => $reason,
                'updated_at' => $ahora,
            ]);

            Audit::record(
                $actor,
                AuditAction::PaymentFailed,
                entityType: 'payment',
                entityId: (string) $payment->id,
                entityLabel: (string) $payment->id,
                after: ['status' => 'disputed'],
                reason: $reason,
            );

            self::resync($actor, (string) $payment->invoice_id);
        });
    }

    /**
     * Recalcula la factura DESDE sus cobros.
     *
     * Es el único sitio que toca `amount_paid_cents`, `balance_cents`, `status`
     * y `paid_at` por causa de un cobro. Que sea uno solo es lo que hace que la
     * columna y las filas no puedan separarse.
     */
    public static function resync(Actor $actor, string $invoiceId): void
    {
        $factura = DB::table('invoices')
            ->where('tenant_id', $actor->tenantId)
            ->where('id', $invoiceId)
            ->first(['id', 'total_cents', 'status', 'due_date']);

        if ($factura === null) {
            return;
        }

        $cobrado = (int) DB::table('payments')
            ->where('tenant_id', $actor->tenantId)
            ->where('invoice_id', $invoiceId)
            ->whereNull('deleted_at')
            ->whereIn('status', self::CUENTAN)
            ->sum(DB::raw('amount_cents - refunded_amount_cents'));

        $total = (int) $factura->total_cents;
        $saldo = $total - $cobrado;
        $ahora = CarbonImmutable::now();

        DB::table('invoices')->where('id', $invoiceId)->update([
            'amount_paid_cents' => $cobrado,
            'balance_cents' => $saldo,
            'status' => self::statusFor((string) $factura->status, $saldo, $factura->due_date, $ahora),
            'paid_at' => $saldo <= 0 && $cobrado > 0 ? $ahora : null,
            'updated_at' => $ahora,
        ]);
    }

    /**
     * En qué estado queda la factura después de mover el saldo.
     *
     * Los estados que NO dependen del dinero se respetan: una factura anulada,
     * en disputa o dada por incobrable no vuelve a «pagada» porque entre un
     * cobro. Y una que estaba pagada y recibe un reembolso vuelve a deber —
     * a «vencida» si ya pasó su fecha, y si no a «enviada».
     */
    private static function statusFor(string $actual, int $saldo, mixed $vence, CarbonImmutable $ahora): string
    {
        if (in_array($actual, ['voided', 'disputed', 'uncollectable', 'draft'], true)) {
            return $actual;
        }

        if ($saldo <= 0) {
            return 'paid';
        }

        $vencida = $vence !== null && CarbonImmutable::parse((string) $vence)->endOfDay()->isBefore($ahora);

        return $vencida ? 'overdue' : ($actual === 'paid' ? 'sent' : $actual);
    }
}
