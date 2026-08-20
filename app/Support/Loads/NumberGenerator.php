<?php

declare(strict_types=1);

namespace App\Support\Loads;

use Illuminate\Support\Facades\DB;

/**
 * El siguiente número de carga de una empresa.
 *
 * Parece trivial y no lo es. `loads_tenant_number_uq` impide dos cargas con el
 * mismo número, así que un generador descuidado no corrompe nada — pero le
 * enseña a un usuario un error de clave duplicada mientras da de alta una carga,
 * que es peor que inútil: no sabe qué hizo mal porque no hizo nada mal.
 *
 * Dos despachadores dando de alta a la vez es lo normal en una oficina a las
 * ocho de la mañana. Por eso el contador se incrementa con un UPDATE atómico
 * dentro de una transacción y con la fila bloqueada, no leyendo y sumando uno.
 *
 * El prefijo y el contador viven en `tenant_settings` porque cada empresa
 * numera a su manera y algunas continúan la serie que traían de su sistema
 * anterior: obligarlas a empezar en 1 significaría tener dos series abiertas
 * para el mismo cliente.
 */
final class NumberGenerator
{
    public static function next(string $tenantId): string
    {
        // lockForUpdate: la fila de ajustes queda bloqueada hasta el commit, así
        // que dos peticiones simultáneas se ponen en fila en vez de leer las dos
        // el mismo número. Sin esto, el segundo choca contra el índice único.
        //
        // Tiene que correr DENTRO de una transacción para que el bloqueo
        // signifique algo; si no hay una abierta, se abre aquí.
        $run = static function () use ($tenantId): string {
            $settings = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first(['load_number_prefix', 'load_number_next_sequence']);

            $prefix = $settings->load_number_prefix ?? 'L';
            $sequence = (int) ($settings->load_number_next_sequence ?? 1);

            DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->update(['load_number_next_sequence' => $sequence + 1]);

            // Cinco dígitos con ceros: GD-24001 y GD-24010 ordenan igual como
            // texto que como número. Sin el relleno, «GD-9» saldría después de
            // «GD-10» en cualquier listado ordenado por número.
            return $prefix.'-'.str_pad((string) $sequence, 5, '0', STR_PAD_LEFT);
        };

        return DB::transactionLevel() > 0
            ? $run()
            : DB::transaction($run);
    }
}
