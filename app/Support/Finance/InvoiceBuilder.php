<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Authorization\Actor;
use App\Models\Load;
use App\Support\Loads\BillingState;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Convierte cargas entregadas en una factura al transportista.
 *
 * Lo que se factura es la TARIFA DE DESPACHO: el porcentaje que la casa de
 * despacho cobra al transportista por conseguirle y gestionarle la carga. Por
 * eso `invoices.carrier_id` es obligatorio en el esquema y `customer_id` no lo
 * es — el cliente lo factura el transportista, no nosotros.
 *
 * LO IMPORTANTE DE ESTA CLASE ES QUE CONGELA
 *
 * Antes de escribir una línea de factura se guarda un `financial_snapshots` con
 * el cálculo entero de esa carga: entradas y salidas. A partir de ahí la
 * factura no depende de nada vivo. Si mañana se le sube la tarifa al
 * transportista, se aprueba un gasto o se corrige la tarifa del cliente, la
 * factura emitida sigue diciendo lo que decía — que es lo único que permite
 * cobrarla y defenderla.
 *
 * `financial_snapshots` es de solo añadir: cada versión es una fila nueva. Ver
 * la migración del esquema y docs/finanzas.md.
 */
final class InvoiceBuilder
{
    public function __construct(
        private readonly LoadCalculator $calculator,
        private readonly SnapshotStore $snapshots,
    ) {}

    /**
     * @param  list<Load>  $loads  cargas del MISMO transportista
     * @return string el id de la factura
     */
    public function fromLoads(Actor $actor, string $carrierId, array $loads, int $paymentTermsDays): string
    {
        $ahora = now();
        $invoiceId = (string) Str::uuid();
        $numero = InvoiceNumberGenerator::next((string) $actor->tenantId);

        $subtotal = 0;
        $lineas = [];
        $secuencia = 0;

        foreach ($loads as $load) {
            $financials = $this->calculator->for($load);
            $snapshotId = $this->snapshots->freeze($actor, $load, $financials, $ahora);

            // La comisión del despachador se DEVENGA aquí, con la instantánea
            // recién congelada: facturar es el momento en que la casa gana su
            // tarifa, y por tanto en que el despachador gana su parte. El
            // esquema impide devengarla dos veces sobre la misma instantánea.
            CommissionLedger::accrue($actor, $load, $snapshotId, $financials, CarbonImmutable::parse($ahora));

            $importe = $financials->dispatchFee;
            $subtotal += $importe;

            $lineas[] = [
                'id' => (string) Str::uuid(),
                'tenant_id' => $actor->tenantId,
                'invoice_id' => $invoiceId,
                'load_id' => $load->id,
                // Qué instantánea se usó. Sin esto, la liquidación de esta
                // misma carga podría descontar una tarifa calculada otro día
                // —la diferencia es pequeña y constante, que es la peor clase
                // de error—. Ver SettlementBuilder.
                'financial_snapshot_id' => $snapshotId,
                'sequence' => ++$secuencia,
                // Las dos descripciones se escriben AHORA y se guardan. Traducir
                // al pintar haría que una factura emitida en marzo cambiara de
                // texto en abril porque alguien retocó un diccionario.
                'description_en' => "Dispatch fee — load {$load->load_number}",
                'description_es' => "Tarifa de despacho — carga {$load->load_number}",
                'quantity' => 1,
                'unit_amount_cents' => $importe,
                'amount_cents' => $importe,
                'kind' => 'dispatch_fee',
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ];

            // Qué cargas están facturadas NO se decide con una columna en
            // `loads`: el hecho está en estas líneas, y quien pregunte que
            // pregunte aquí —`Billable`—. `loads.status` es una PROYECCIÓN de
            // esa respuesta, no una segunda verdad; la escribe `BillingState`
            // al final de este método y la deshace al anular. Ese «al anular»
            // es lo que faltaba, y es la razón por la que durante mucho tiempo
            // esto no se escribió en absoluto.
        }

        DB::table('invoices')->insert([
            'id' => $invoiceId,
            'tenant_id' => $actor->tenantId,
            'invoice_number' => $numero,
            'carrier_id' => $carrierId,
            'load_id' => count($loads) === 1 ? $loads[0]->id : null,
            'status' => 'draft',
            'subtotal_cents' => $subtotal,
            'adjustments_cents' => 0,
            'total_cents' => $subtotal,
            'amount_paid_cents' => 0,
            'balance_cents' => $subtotal,
            'payment_terms_days' => $paymentTermsDays,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        DB::table('invoice_line_items')->insert($lineas);

        // Y la carga deja de estar «pendiente de facturar» en el mismo acto.
        // Antes no pasaba nada aquí: el panel dejaba de contarla —lee las
        // líneas— pero su ficha seguía en `pod_received`, y la única forma de
        // moverla era un botón que no comprobaba que esta factura existiera.
        BillingState::alFacturar(
            (string) $actor->tenantId,
            $invoiceId,
            array_map(static fn (Load $l): string => (string) $l->id, $loads),
            CarbonImmutable::parse($ahora),
            $actor->auditUserId(),
        );

        return $invoiceId;
    }
}
