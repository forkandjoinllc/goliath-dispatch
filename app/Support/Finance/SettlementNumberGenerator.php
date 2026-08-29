<?php

declare(strict_types=1);

namespace App\Support\Finance;

use Illuminate\Support\Facades\DB;

/**
 * El siguiente número de liquidación de una empresa.
 *
 * Igual que el de facturas y por lo mismo: fila bloqueada dentro de una
 * transacción. `carrier_settlements_tenant_number_uq` no perdona, y liquidar a
 * ocho transportistas un viernes por la tarde es justo cuando dos personas lo
 * hacen a la vez.
 */
final class SettlementNumberGenerator
{
    public static function next(string $tenantId): string
    {
        $run = static function () use ($tenantId): string {
            $settings = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first(['settlement_number_prefix', 'settlement_number_next_sequence']);

            $prefix = $settings->settlement_number_prefix ?? 'STL';
            $sequence = (int) ($settings->settlement_number_next_sequence ?? 1);

            DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->update(['settlement_number_next_sequence' => $sequence + 1]);

            return $prefix.'-'.str_pad((string) $sequence, 5, '0', STR_PAD_LEFT);
        };

        return DB::transactionLevel() > 0 ? $run() : DB::transaction($run);
    }
}
