<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Authorization\Actor;
use App\Enums\AuditAction;
use App\Support\Audit;
use App\Support\Loads\BillingState;
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

    /** La disputa se resolvió a nuestro favor: el dinero se queda. */
    public const DISPUTA_GANADA = 'won';

    /** La disputa se perdió: el banco retiró el dinero. */
    public const DISPUTA_PERDIDA = 'lost';

    /** Los dos únicos desenlaces que puede tener una disputa. */
    public const DESENLACES = [self::DISPUTA_GANADA, self::DISPUTA_PERDIDA];

    /**
     * Anota un cobro y recalcula la factura.
     *
     * @param  array{amount_cents: int, method: string, status: string, reference: ?string, received_at: ?string, notes: ?string}  $data
     * @return string el id del cobro
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

            self::resync((string) $actor->tenantId, (string) $invoice->id);

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

            self::resync((string) $actor->tenantId, (string) $payment->invoice_id);
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

            self::resync((string) $actor->tenantId, (string) $payment->invoice_id);
        });
    }

    /**
     * Cierra una disputa, en cualquiera de sus dos desenlaces.
     *
     * SIN ESTO NO SE PUEDE ABRIR NINGUNA. Una disputa que no sabe terminar
     * deja la factura en «en disputa» para siempre: fuera de la reclamación
     * nocturna, fuera de la cartera y sin forma de volver a cobrarla. Abrir
     * una puerta sin construirle la salida es peor que no abrirla.
     *
     * GANADA: el banco nos dio la razón, el dinero se queda. El cobro vuelve a
     * `succeeded` y cuenta otra vez.
     *
     * PERDIDA: el banco se lo llevó. El cobro queda `failed` —no `refunded`,
     * que diría que lo devolvimos nosotros, ni borrado, que diría que nunca
     * llegó—. Su `disputed_at` y su motivo NO se tocan: el historial tiene que
     * poder decir que ese dinero entró, se disputó y acabó así.
     *
     * En los dos casos la factura la recalcula `resync()`, que es quien sabe
     * si queda alguna otra disputa viva. Este método no decide el estado de la
     * factura, y esa es la razón de que no pueda desincronizarse de él.
     */
    public static function resolveDispute(Actor $actor, object $payment, string $desenlace, string $reason): void
    {
        DB::transaction(function () use ($actor, $payment, $desenlace, $reason): void {
            $ahora = CarbonImmutable::now();
            $estado = $desenlace === self::DISPUTA_GANADA ? 'succeeded' : 'failed';

            DB::table('payments')->where('id', $payment->id)->update([
                'status' => $estado,
                'updated_at' => $ahora,
            ]);

            Audit::record(
                $actor,
                AuditAction::FinancialChanged,
                entityType: 'payment',
                entityId: (string) $payment->id,
                entityLabel: (string) $payment->id,
                before: ['status' => 'disputed'],
                after: ['status' => $estado, 'outcome' => $desenlace],
                reason: $reason,
            );

            self::resync((string) $actor->tenantId, (string) $payment->invoice_id);
        });
    }

    /**
     * Recalcula la factura DESDE sus cobros.
     *
     * El único sitio que toca `amount_paid_cents`, `balance_cents`, `status` y
     * `paid_at` por causa de un cobro. Que sea uno solo es lo que hace que la
     * columna y las filas no puedan separarse.
     *
     * ESO LO DECÍA ESTE COMENTARIO Y NO ERA VERDAD. `InvoicePayments` tenía su
     * propio `aplicarALaFactura()` que escribía las mismas cuatro columnas por
     * la vía de la pasarela, sumando sobre la columna en vez de recalcular
     * desde las filas y —lo caro— sin pasar por `statusFor()`. Un cobro que
     * aterrizara después de anular la factura la marcaba PAGADA, que es
     * exactamente lo que `statusFor()` existe para impedir.
     *
     * RECIBE UN `tenantId`, NO UN `Actor`, y ese cambio es la mitad del
     * arreglo. El método nunca usó del actor otra cosa que su empresa, pero
     * pedirlo entero lo volvía inalcanzable desde el webhook de la pasarela
     * —que no tiene actor— y esa es la razón por la que alguien escribió el
     * segundo escritor en vez de llamar a éste. Una firma que pide de más
     * fabrica duplicados.
     */
    public static function resync(string $tenantId, string $invoiceId): void
    {
        $factura = DB::table('invoices')
            ->where('tenant_id', $tenantId)
            ->where('id', $invoiceId)
            ->first(['id', 'total_cents', 'status', 'due_date']);

        if ($factura === null) {
            return;
        }

        $cobrado = (int) DB::table('payments')
            ->where('tenant_id', $tenantId)
            ->where('invoice_id', $invoiceId)
            ->whereNull('deleted_at')
            ->whereIn('status', self::CUENTAN)
            ->sum(DB::raw('amount_cents - refunded_amount_cents'));

        $ahora = CarbonImmutable::now();

        // La disputa de la FACTURA se deduce de sus cobros; no se recuerda por
        // su cuenta. Mientras quede un cobro en disputa la factura lo está, y
        // en cuanto no queda ninguno deja de estarlo sin que nadie tenga que
        // acordarse de apagarla. Guardar el estado por separado era justo la
        // forma de que las dos verdades se separaran.
        $disputa = self::disputaViva($tenantId, $invoiceId);

        $total = (int) $factura->total_cents;
        $estado = self::statusFor((string) $factura->status, $total - $cobrado, $factura->due_date, $disputa !== null, $ahora);

        // El SALDO de una factura que no depende del dinero tampoco se toca.
        //
        // Anular pone el saldo a cero: una factura anulada no debe nada, pase
        // lo que pase después. Recalcularlo aquí le devolvería un saldo vivo a
        // algo que se anuló, y la pantalla de vencidos volvería a contarlo.
        // Lo que SÍ se apunta siempre es lo cobrado: el dinero llegó, y
        // esconderlo sería la mentira contraria.
        $saldo = in_array($estado, self::SIN_SALDO, true) ? 0 : $total - $cobrado;

        DB::table('invoices')->where('id', $invoiceId)->update([
            'amount_paid_cents' => $cobrado,
            'balance_cents' => $saldo,
            'status' => $estado,
            'paid_at' => $estado === 'paid' && $cobrado > 0 ? $ahora : null,
            // Las dos direcciones por el mismo sitio: se ponen cuando hay
            // disputa y se quitan cuando ya no la hay. `PeriodReport::aging()`
            // lleva desde el primer día excluyendo las facturas con
            // `disputed_at`, y hasta hoy esa cláusula no podía dispararse
            // porque la columna no la escribía nadie: la cartera contaba como
            // deuda corriente un dinero que el banco estaba reclamando.
            'disputed_at' => $disputa?->disputed_at,
            'dispute_reason' => $disputa?->dispute_reason,
            'updated_at' => $ahora,
        ]);

        // Y las cargas de la factura, al día con ella. En los dos sentidos: un
        // reembolso que reabra la factura devuelve sus cargas a `invoiced`. Sin
        // esta línea la ficha de carga seguiría diciendo «Cobrada» encima de una
        // factura que vuelve a deber, que es la misma contradicción que este
        // método existe para no tener un nivel más arriba.
        BillingState::sincronizarCobro($tenantId, $invoiceId, $ahora);
    }

    /**
     * En qué estado queda la factura después de mover el saldo.
     *
     * Los estados que NO dependen del dinero se respetan: una factura anulada,
     * en disputa o dada por incobrable no vuelve a «pagada» porque entre un
     * cobro. Y una que estaba pagada y recibe un reembolso vuelve a deber —
     * a «vencida» si ya pasó su fecha, y si no a «enviada».
     */
    /**
     * Los estados en los que el dinero ya no manda.
     *
     * `disputed` ESTABA en esta lista y ha salido, y las dos mitades del
     * cambio importan.
     *
     * Estaba porque alguien previó —con razón— que una factura en disputa no
     * debía volver a «pagada» porque entrara otro cobro. Pero nadie escribía
     * nunca `invoices.status = 'disputed'`: disputar un cobro solo tocaba la
     * fila de `payments`. La guarda estaba puesta y el estado que la dispara
     * no podía existir, así que la factura seguía en «enviada» o «vencida»,
     * la barredora nocturna la reclamaba como a un moroso corriente, y un
     * cobro posterior la pasaba a «pagada» con la disputa viva encima — el
     * error exacto contra el que esta lista se escribió.
     *
     * Sale porque ahora la disputa se DEDUCE de los cobros en cada recálculo,
     * y un estado deducido no puede además ser pegajoso: si se quedara aquí,
     * la factura seguiría en disputa para siempre después de resolverse.
     *
     * @var list<string>
     */
    private const SIN_SALDO = ['voided', 'uncollectable', 'draft'];

    /**
     * Estados que NO sobreviven a que la factura vuelva a deber.
     *
     * `paid` ya estaba: un reembolso la devuelve a «enviada». `disputed` se le
     * une por lo mismo — resuelta la disputa, la factura es lo que su saldo
     * diga, no lo que fue.
     *
     * @var list<string>
     */
    private const VUELVEN_A_ENVIADA = ['paid', 'disputed'];

    private static function statusFor(string $actual, int $saldo, mixed $vence, bool $enDisputa, CarbonImmutable $ahora): string
    {
        // Anulada, incobrable o borrador mandan sobre la disputa: una factura
        // anulada no debe nada, la esté reclamando el banco o no.
        if (in_array($actual, self::SIN_SALDO, true)) {
            return $actual;
        }

        if ($enDisputa) {
            return 'disputed';
        }

        if ($saldo <= 0) {
            return 'paid';
        }

        $vencida = $vence !== null && CarbonImmutable::parse((string) $vence)->endOfDay()->isBefore($ahora);

        return $vencida ? 'overdue' : (in_array($actual, self::VUELVEN_A_ENVIADA, true) ? 'sent' : $actual);
    }

    /**
     * El cobro en disputa más reciente de una factura, si queda alguno.
     *
     * El más reciente y no «alguno»: su motivo y su fecha son los que la
     * pantalla enseña, y enseñar los de una disputa anterior ya resuelta sería
     * contar mal lo que está pasando ahora.
     */
    private static function disputaViva(string $tenantId, string $invoiceId): ?object
    {
        return DB::table('payments')
            ->where('tenant_id', $tenantId)
            ->where('invoice_id', $invoiceId)
            ->whereNull('deleted_at')
            ->where('status', 'disputed')
            ->orderByDesc('disputed_at')
            ->first(['disputed_at', 'dispute_reason']);
    }
}
