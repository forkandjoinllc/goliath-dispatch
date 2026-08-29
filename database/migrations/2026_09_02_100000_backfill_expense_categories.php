<?php

declare(strict_types=1);

use App\Support\Finance\DefaultExpenseCategories;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Las categorías de gasto que le faltan a cada empresa ya existente.
 *
 * `ProvisionTenant` ya las crea para las nuevas, pero las que se dieron de alta
 * antes se quedaron sin ninguna — y sin categorías la pantalla de gastos no
 * sirve para nada, porque `expenses.category_id` es NOT NULL.
 *
 * No es una migración de esquema: no toca ninguna tabla. Es un relleno, y por
 * eso `down()` no deshace nada. Borrar categorías que alguien puede haber usado
 * ya en un gasto rompería las filas que las apuntan; y si se ejecutara sobre una
 * empresa que las creó a mano, borraría su trabajo.
 *
 * Reanudable por construcción: `ensureFor()` solo crea las que faltan y no toca
 * las que estén. Una empresa que haya cambiado el tratamiento de «combustible»
 * a propósito no se lo encuentra revertido.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Sin el scope de empresa delante: esto recorre TODAS a propósito.
        DB::table('tenants')
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->chunkById(200, function ($tenants): void {
                foreach ($tenants as $t) {
                    DefaultExpenseCategories::ensureFor((string) $t->id);
                }
            });
    }

    public function down(): void
    {
        // A propósito, nada. Ver la cabecera.
    }
};
