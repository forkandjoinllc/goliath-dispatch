<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Authorization\Actor;
use App\Models\Load;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Convierte cargas entregadas en una liquidación al transportista.
 *
 * Es la otra cara de la factura. La factura le COBRA la tarifa de despacho; la
 * liquidación le PAGA la carga menos esa misma tarifa, menos sus descuentos, más
 * lo que se le reembolsa.
 *
 * LO QUE HACE QUE LAS DOS CARAS CUADREN
 *
 * Si la carga ya se facturó, la liquidación NO vuelve a calcular: reutiliza la
 * instantánea que usó la factura. Si cada una calculara la suya, entre una y
 * otra podría aprobarse un gasto y la tarifa descontada dejaría de coincidir con
 * la facturada. La diferencia sería pequeña y constante — la peor clase de
 * error, porque nadie la ve hasta que alguien cuadra un trimestre.
 *
 * Si la carga NO se ha facturado todavía, se congela una instantánea nueva, y a
 * partir de ahí manda esa: `carrier_settlement_lines.financial_snapshot_id` deja
 * dicho cuál, y la factura que venga después leerá la misma.
 *
 * FACTORING: la plataforma REGISTRA, no paga. Si el transportista tiene una
 * asignación de factoring viva, la liquidación lo anota para que quien pague
 * sepa a quién, pero aquí no se mueve un céntimo.
 */
final class SettlementBuilder
{
    /** columna de la línea => columna de la cabecera donde suma. */
    private const TOTALES = [
        'gross_rate_cents' => 'gross_rate_cents',
        'reimbursements_cents' => 'reimbursements_cents',
        'dispatch_fee_cents' => 'dispatch_fees_cents',
        'deductions_cents' => 'deductions_cents',
        'net_cents' => 'net_amount_cents',
    ];

    public function __construct(
        private readonly LoadCalculator $calculator,
        private readonly SnapshotStore $snapshots,
    ) {}

    /**
     * @param  list<Load>  $loads  cargas del MISMO transportista
     * @return string  el id de la liquidación
     */
    public function fromLoads(Actor $actor, string $carrierId, array $loads): string
    {
        $ahora = now();
        $settlementId = (string) Str::uuid();
        $numero = SettlementNumberGenerator::next((string) $actor->tenantId);

        $totales = [
            'gross_rate_cents' => 0,
            'reimbursements_cents' => 0,
            'dispatch_fees_cents' => 0,
            'deductions_cents' => 0,
            'net_amount_cents' => 0,
        ];

        $lineas = [];
        $fechas = [];

        foreach ($loads as $load) {
            $snapshot = $this->snapshots->usedByLiveInvoice($actor, (string) $load->id);

            if ($snapshot === null) {
                $id = $this->snapshots->freeze($actor, $load, $this->calculator->for($load), $ahora);
                $snapshot = $this->snapshots->byId($actor, $id);
            }

            if ($snapshot === null) {
                continue;
            }

            $linea = [
                'gross_rate_cents' => (int) $snapshot->carrier_gross_rate_cents,
                'reimbursements_cents' => (int) $snapshot->approved_reimbursable_expenses_cents,
                'dispatch_fee_cents' => (int) $snapshot->dispatch_fee_amount_cents,
                'deductions_cents' => (int) $snapshot->carrier_deductions_cents,
                'net_cents' => (int) $snapshot->net_carrier_settlement_cents,
            ];

            // La cabecera y la línea no llaman igual a dos de las cinco cifras
            // —el esquema las nombró así— y sumarlas «por nombre» a ciegas
            // dejaría dos totales en cero sin que nada fallara. El mapa está
            // escrito a mano por eso.
            foreach (self::TOTALES as $enLinea => $enCabecera) {
                $totales[$enCabecera] += $linea[$enLinea];
            }

            $fechas[] = $load->actual_delivery_at ?? $load->created_at;

            $lineas[] = [
                ...$linea,
                'id' => (string) Str::uuid(),
                'tenant_id' => $actor->tenantId,
                'settlement_id' => $settlementId,
                'load_id' => $load->id,
                'financial_snapshot_id' => (string) $snapshot->id,
                // Los textos se escriben AHORA y se guardan. Traducir al pintar
                // haría que una liquidación entregada en marzo cambiara de texto
                // en abril porque alguien retocó un diccionario.
                'description_en' => "Load {$load->load_number}",
                'description_es' => "Carga {$load->load_number}",
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ];
        }

        $periodo = $this->periodo($fechas, $ahora);

        DB::table('carrier_settlements')->insert([
            ...$totales,
            'id' => $settlementId,
            'tenant_id' => $actor->tenantId,
            'carrier_id' => $carrierId,
            'settlement_number' => $numero,
            'period_start' => $periodo[0],
            'period_end' => $periodo[1],
            'status' => 'draft',
            // Se anota a quién hay que pagarle. La plataforma no paga.
            'factoring_company_id' => $this->factoringOf($actor, $carrierId),
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        if ($lineas !== []) {
            DB::table('carrier_settlement_lines')->insert($lineas);
        }

        return $settlementId;
    }

    /**
     * @param  list<mixed>  $fechas
     * @return array{0: mixed, 1: mixed}
     */
    private function periodo(array $fechas, mixed $ahora): array
    {
        $marcas = [];

        foreach ($fechas as $f) {
            if ($f === null) {
                continue;
            }

            try {
                $marcas[] = CarbonImmutable::parse(is_object($f) ? (string) $f : $f);
            } catch (\Throwable) {
                // Una fecha ilegible no puede tumbar una liquidación entera.
            }
        }

        if ($marcas === []) {
            return [$ahora, $ahora];
        }

        return [min($marcas), max($marcas)];
    }

    private function factoringOf(Actor $actor, string $carrierId): ?string
    {
        $id = DB::table('factoring_assignments')
            ->where('tenant_id', $actor->tenantId)
            ->where('carrier_id', $carrierId)
            ->whereNull('deleted_at')
            ->orderByDesc('created_at')
            ->value('factoring_company_id');

        return $id === null ? null : (string) $id;
    }
}
