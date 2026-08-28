<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Authorization\Actor;
use App\Models\Load;
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
    public function __construct(private readonly LoadCalculator $calculator) {}

    /**
     * @param  list<Load>  $loads  cargas del MISMO transportista
     * @return string  el id de la factura
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
            $snapshotId = $this->freeze($actor, $load, $financials, $ahora);

            $importe = $financials->dispatchFee;
            $subtotal += $importe;

            $lineas[] = [
                'id' => (string) Str::uuid(),
                'tenant_id' => $actor->tenantId,
                'invoice_id' => $invoiceId,
                'load_id' => $load->id,
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

            // Qué cargas están facturadas NO se marca con una columna en
            // `loads`. Se sabe preguntando por las líneas de factura vivas, que
            // es donde está el hecho. Una columna paralela solo puede
            // desincronizarse: se anula una factura y la carga se queda marcada
            // como facturada para siempre.
            unset($snapshotId);
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

        return $invoiceId;
    }

    /**
     * Congela el cálculo de una carga y devuelve el id de la instantánea.
     */
    private function freeze(Actor $actor, Load $load, LoadFinancials $financials, mixed $ahora): string
    {
        // La versión se calcula con la fila bloqueada: dos personas facturando a
        // la vez la misma carga no pueden escribir dos veces la versión 1.
        $version = 1 + (int) DB::table('financial_snapshots')
            ->where('tenant_id', $actor->tenantId)
            ->where('load_id', $load->id)
            ->lockForUpdate()
            ->max('version');

        $id = (string) Str::uuid();

        DB::table('financial_snapshots')->insert([
            ...$financials->toSnapshotColumns(),
            'id' => $id,
            'tenant_id' => $actor->tenantId,
            'load_id' => $load->id,
            'version' => $version,
            // Quién calculó esto y cuándo. La instantánea es la respuesta a
            // «¿de dónde salió esta cifra?», y media respuesta no sirve.
            'computed_by_user_id' => $actor->auditUserId(),
            'computed_at' => $ahora,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return $id;
    }
}
