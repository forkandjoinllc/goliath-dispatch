<?php

declare(strict_types=1);

namespace App\Support\Reports;

use App\Authorization\Actor;
use App\Enums\Scope;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Los números de un periodo.
 *
 * DE DÓNDE SALEN, Y POR QUÉ IMPORTA
 *
 * El dinero se lee de las LÍNEAS DE FACTURAS VIVAS y de la instantánea
 * financiera que cada línea usó — no se recalcula. Un informe que recalcula
 * contesta distinto cada vez que alguien aprueba un gasto viejo, y entonces el
 * margen de marzo cambia en abril sin que nadie haya tocado marzo. Aquí un
 * periodo cerrado dice siempre lo mismo.
 *
 * Eso significa que estos informes cuentan TRABAJO FACTURADO, no trabajo hecho:
 * una carga entregada y sin facturar no aparece en el margen. Es deliberado —
 * mezclar lo facturado con lo previsto da un número que no es ninguna de las dos
 * cosas.
 *
 * La ANTIGÜEDAD DEL COBRO sí sale de `invoices`, porque pregunta otra cosa:
 * cuánto se debe hoy y desde cuándo. Y el saldo de una factura lo deriva
 * PaymentLedger de sus cobros, así que esa columna sí es de fiar.
 */
final class PeriodReport
{
    public function __construct(
        private readonly Actor $actor,
        private readonly Scope $scope,
        private readonly CarbonImmutable $from,
        private readonly CarbonImmutable $to,
    ) {}

    /**
     * Lo facturado por transportista.
     *
     * @return list<array<string, mixed>>
     */
    public function byCarrier(): array
    {
        return $this->billed()
            ->join('carriers as c', 'c.id', '=', 'i.carrier_id')
            ->groupBy('i.carrier_id', 'c.legal_name', 'c.dba')
            ->orderByDesc(DB::raw('sum(s.dispatch_fee_amount_cents)'))
            ->get([
                'i.carrier_id',
                'c.legal_name',
                'c.dba',
                DB::raw('count(distinct li.load_id) as loads'),
                DB::raw('sum(s.carrier_gross_rate_cents) as gross'),
                DB::raw('sum(s.dispatch_fee_amount_cents) as fee'),
                DB::raw('sum(s.net_carrier_settlement_cents) as net'),
                DB::raw('sum(s.gross_margin_cents) as margin'),
            ])
            ->map(static fn ($r): array => [
                'id' => (string) $r->carrier_id,
                'name' => (string) ($r->dba ?: $r->legal_name),
                'loads' => (int) $r->loads,
                'grossCents' => (int) $r->gross,
                'feeCents' => (int) $r->fee,
                'netCents' => (int) $r->net,
                'marginCents' => (int) $r->margin,
            ])
            ->all();
    }

    /**
     * Lo facturado por cliente final.
     *
     * Al cliente lo factura el transportista, no nosotros — aquí se mira para
     * saber de dónde sale el volumen, no para cobrarle nada.
     *
     * @return list<array<string, mixed>>
     */
    public function byCustomer(): array
    {
        return $this->billed()
            ->join('loads as l', 'l.id', '=', 'li.load_id')
            ->leftJoin('customers as cu', 'cu.id', '=', 'l.customer_id')
            ->groupBy('l.customer_id', 'cu.company_name')
            ->orderByDesc(DB::raw('sum(s.customer_charge_cents)'))
            ->get([
                'l.customer_id',
                'cu.company_name',
                DB::raw('count(distinct li.load_id) as loads'),
                DB::raw('sum(s.customer_charge_cents) as charge'),
                DB::raw('sum(s.dispatch_fee_amount_cents) as fee'),
                DB::raw('sum(s.gross_margin_cents) as margin'),
            ])
            ->map(static fn ($r): array => [
                'id' => $r->customer_id === null ? null : (string) $r->customer_id,
                'name' => $r->company_name,
                'loads' => (int) $r->loads,
                'chargeCents' => (int) $r->charge,
                'feeCents' => (int) $r->fee,
                'marginCents' => (int) $r->margin,
            ])
            ->all();
    }

    /**
     * Antigüedad del cobro: cuánto se debe y desde cuándo.
     *
     * Los tramos son los de siempre en cobros —corriente, 1-30, 31-60, 61-90 y
     * más de 90— porque es el reparto que entiende cualquiera que haya cuadrado
     * una cartera, y cambiarlo solo obligaría a traducirlo.
     *
     * @return array<string, array{amountCents: int, count: int}>
     */
    public function aging(): array
    {
        $hoy = CarbonImmutable::now()->startOfDay();

        $filas = $this->invoices()
            ->where('i.balance_cents', '>', 0)
            ->whereNotIn('i.status', ['draft', 'voided'])
            ->get(['i.id', 'i.balance_cents', 'i.due_date']);

        $tramos = [
            'current' => ['amountCents' => 0, 'count' => 0],
            'd1_30' => ['amountCents' => 0, 'count' => 0],
            'd31_60' => ['amountCents' => 0, 'count' => 0],
            'd61_90' => ['amountCents' => 0, 'count' => 0],
            'd90plus' => ['amountCents' => 0, 'count' => 0],
        ];

        foreach ($filas as $f) {
            // Sin fecha de vencimiento se cuenta como corriente: no se puede
            // decir que algo esté vencido si nunca se dijo cuándo vencía.
            $dias = $f->due_date === null
                ? 0
                : (int) CarbonImmutable::parse((string) $f->due_date)->startOfDay()->diffInDays($hoy, false);

            $clave = match (true) {
                $dias <= 0 => 'current',
                $dias <= 30 => 'd1_30',
                $dias <= 60 => 'd31_60',
                $dias <= 90 => 'd61_90',
                default => 'd90plus',
            };

            $tramos[$clave]['amountCents'] += (int) $f->balance_cents;
            $tramos[$clave]['count']++;
        }

        return $tramos;
    }

    /**
     * Gastos aprobados del periodo, por tratamiento.
     *
     * Solo los que cuentan: un gasto presentado y sin revisar no ha movido el
     * dinero de nadie.
     *
     * @return array<string, int>
     */
    public function expensesByTreatment(): array
    {
        $query = DB::table('expenses as e')
            ->where('e.tenant_id', $this->actor->tenantId)
            ->whereNull('e.deleted_at')
            ->whereIn('e.status', ['approved', 'reimbursed'])
            ->whereBetween('e.created_at', [$this->from, $this->to]);

        $this->narrowByCarrier($query, 'e.carrier_id');

        return $query
            ->groupBy('e.treatment_snapshot')
            ->pluck(DB::raw('sum(e.amount_cents)'), 'e.treatment_snapshot')
            ->map(static fn ($v): int => (int) $v)
            ->all();
    }

    /**
     * Comisiones devengadas en el periodo, por despachador.
     *
     * @return list<array<string, mixed>>
     */
    public function commissionsByDispatcher(): array
    {
        if (! $this->scope->atLeast(Scope::Tenant)) {
            return [];
        }

        return DB::table('dispatcher_commissions as dc')
            ->leftJoin('users as u', 'u.id', '=', 'dc.dispatcher_user_id')
            ->where('dc.tenant_id', $this->actor->tenantId)
            ->whereNull('dc.deleted_at')
            ->where('dc.status', '!=', 'voided')
            ->whereBetween('dc.created_at', [$this->from, $this->to])
            ->groupBy('dc.dispatcher_user_id', 'u.first_name', 'u.last_name')
            ->orderByDesc(DB::raw('sum(dc.amount_cents)'))
            ->get([
                'dc.dispatcher_user_id',
                'u.first_name',
                'u.last_name',
                DB::raw('sum(dc.amount_cents) as total'),
                DB::raw("sum(case when dc.status = 'paid' then dc.amount_cents else 0 end) as paid"),
            ])
            ->map(static fn ($r): array => [
                'id' => (string) $r->dispatcher_user_id,
                'name' => trim("{$r->first_name} {$r->last_name}"),
                'totalCents' => (int) $r->total,
                'paidCents' => (int) $r->paid,
                'owedCents' => (int) $r->total - (int) $r->paid,
            ])
            ->all();
    }

    /**
     * Cargas por estado, contadas en el periodo.
     *
     * @return array<string, int>
     */
    public function loadsByStatus(): array
    {
        $query = DB::table('loads as l')
            ->where('l.tenant_id', $this->actor->tenantId)
            ->whereNull('l.deleted_at')
            ->whereBetween('l.created_at', [$this->from, $this->to]);

        $this->narrowByCarrier($query, 'l.carrier_id');

        return $query
            ->groupBy('l.status')
            ->pluck(DB::raw('count(*)'), 'l.status')
            ->map(static fn ($v): int => (int) $v)
            ->all();
    }

    // ------------------------------------------------------------------ ayudas

    /**
     * Las líneas de facturas VIVAS del periodo, con su instantánea.
     *
     * `deleted_at is null` en la línea y estado distinto de `voided` en la
     * factura: una factura anulada no cuenta como facturación. La fecha que
     * manda es la de EMISIÓN de la factura, no la de la carga — un informe de
     * marzo enseña lo que se facturó en marzo.
     */
    private function billed(): Builder
    {
        $query = DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->join('financial_snapshots as s', 's.id', '=', 'li.financial_snapshot_id')
            ->where('li.tenant_id', $this->actor->tenantId)
            ->whereNull('li.deleted_at')
            ->whereNull('i.deleted_at')
            ->whereNotIn('i.status', ['draft', 'voided'])
            ->whereBetween('i.created_at', [$this->from, $this->to]);

        $this->narrowByCarrier($query, 'i.carrier_id');

        return $query;
    }

    private function invoices(): Builder
    {
        $query = DB::table('invoices as i')
            ->where('i.tenant_id', $this->actor->tenantId)
            ->whereNull('i.deleted_at');

        $this->narrowByCarrier($query, 'i.carrier_id');

        return $query;
    }

    /**
     * Estrecha por transportista según el alcance concedido.
     *
     * Un transportista ve lo suyo; un despachador, lo de los transportistas que
     * lleva. Sin esto un informe sería la puerta de atrás a todos los números de
     * la empresa para quien tiene el resto de pantallas estrechadas.
     */
    private function narrowByCarrier(Builder $query, string $column): void
    {
        if ($this->scope->atLeast(Scope::Tenant)) {
            return;
        }

        if ($this->scope === Scope::Carrier) {
            $query->where($column, $this->actor->carrierId ?? '');

            return;
        }

        $ids = $this->actor->assignments->carrierIds;

        if ($ids === []) {
            $query->whereRaw('1 = 0');

            return;
        }

        $query->whereIn($column, $ids);
    }
}
