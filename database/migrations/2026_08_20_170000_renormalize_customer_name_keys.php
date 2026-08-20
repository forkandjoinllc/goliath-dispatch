<?php

declare(strict_types=1);

use App\Support\Customers\NameKey;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Rellena `customers.company_name_normalized` con la clave que produce NameKey.
 *
 * Las filas anteriores a esta migración se escribieron con una normalización más
 * pobre que no quitaba los sufijos societarios, así que «Permian Basin Equipment
 * Co.» y «Permian Basin Equipment» quedaban como clientes distintos. La
 * detección de duplicados existe justo para eso y no lo veía.
 *
 * No hay `down()` que valga: la normalización antigua no se puede reconstruir a
 * partir de la nueva, y aunque se pudiera, volver a una clave peor no es algo
 * que nadie quiera. Recalcular es idempotente, así que reejecutarla no hace daño.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Consulta cruda: las migraciones no deben depender de los modelos, que
        // cambian, ni del scope global de empresa, que aquí estorbaría — esto
        // tiene que alcanzar a todas las empresas.
        DB::table('customers')
            ->select('id', 'company_name', 'company_name_normalized')
            ->orderBy('id')
            ->chunkById(500, function ($rows): void {
                foreach ($rows as $row) {
                    $key = NameKey::for((string) $row->company_name);

                    if ($key === $row->company_name_normalized) {
                        continue;
                    }

                    DB::table('customers')
                        ->where('id', $row->id)
                        ->update(['company_name_normalized' => $key]);
                }
            });
    }

    public function down(): void
    {
        // Deliberadamente vacío. Ver la cabecera.
    }
};
