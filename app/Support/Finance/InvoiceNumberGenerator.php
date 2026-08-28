<?php

declare(strict_types=1);

namespace App\Support\Finance;

use Illuminate\Support\Facades\DB;

/**
 * El siguiente número de factura de una empresa.
 *
 * Gemelo de App\Support\Loads\NumberGenerator, y por las mismas razones: el
 * contador se incrementa con la fila bloqueada dentro de una transacción, no
 * leyendo y sumando uno. Dos personas facturando a la vez a final de mes es lo
 * normal, e `invoices_tenant_number_uq` convertiría la carrera en un error de
 * clave duplicada delante de quien está cobrando.
 *
 * No se comparte código con el de cargas a propósito: son dos series con dos
 * prefijos y dos contadores, y un helper genérico con el nombre de la columna
 * por parámetro sería más difícil de leer que estas veinte líneas.
 */
final class InvoiceNumberGenerator
{
    public static function next(string $tenantId): string
    {
        $run = static function () use ($tenantId): string {
            $settings = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first(['invoice_number_prefix', 'invoice_number_next_sequence']);

            $prefix = $settings->invoice_number_prefix ?? 'INV';
            $sequence = (int) ($settings->invoice_number_next_sequence ?? 1);

            DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->update(['invoice_number_next_sequence' => $sequence + 1]);

            return $prefix.'-'.str_pad((string) $sequence, 5, '0', STR_PAD_LEFT);
        };

        return DB::transactionLevel() > 0 ? $run() : DB::transaction($run);
    }
}
