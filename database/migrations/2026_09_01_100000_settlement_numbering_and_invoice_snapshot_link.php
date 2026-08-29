<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Dos huecos que hacían falta para liquidar a los transportistas.
 *
 * 1. LA SERIE DE LIQUIDACIONES
 *
 * `tenant_settings` traía contador para cargas y para facturas, pero no para
 * liquidaciones, y `carrier_settlements_tenant_number_uq` exige un número único
 * por empresa. Sin contador habría que inventarse el número al vuelo, que es
 * exactamente cómo se acaban viendo dos liquidaciones con el mismo.
 *
 * 2. QUÉ INSTANTÁNEA USÓ CADA LÍNEA DE FACTURA
 *
 * `carrier_settlement_lines` ya tenía `financial_snapshot_id` — el esquema lo
 * previó — pero `invoice_line_items` no. Y sin ese enlace las dos caras del
 * mismo dinero pueden separarse: se le factura al transportista una tarifa de
 * despacho calculada en marzo y se le descuenta en la liquidación otra
 * calculada en abril, porque entre medias se aprobó un gasto. La diferencia es
 * pequeña y constante, que es la peor clase de error: nadie la ve hasta que
 * alguien cuadra un trimestre.
 *
 * Con el enlace, la liquidación REUTILIZA la instantánea que usó la factura en
 * vez de calcular otra. Ver App\Support\Finance\SettlementBuilder.
 *
 * Reanudable: cada paso mira antes si ya está hecho.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('tenant_settings', 'settlement_number_prefix')) {
            DB::statement("
                alter table `tenant_settings`
                add `settlement_number_prefix` varchar(12) not null default 'STL'
                after `invoice_number_next_sequence`
            ");
        }

        if (! Schema::hasColumn('tenant_settings', 'settlement_number_next_sequence')) {
            DB::statement('
                alter table `tenant_settings`
                add `settlement_number_next_sequence` int not null default 1000
                after `settlement_number_prefix`
            ');
        }

        if (! Schema::hasColumn('invoice_line_items', 'financial_snapshot_id')) {
            DB::statement('
                alter table `invoice_line_items`
                add `financial_snapshot_id` char(36) null after `load_id`
            ');
        }

        if (! $this->tieneRestriccion('fk_invoice_line_items_financial_snapshot')) {
            // `set null` y no `cascade`: una instantánea no se borra nunca
            // —`financial_snapshots` es de solo añadir— pero si algún día una
            // purga se llevara una, la línea de factura tiene que sobrevivir.
            // El importe ya está escrito en ella.
            DB::statement('
                alter table invoice_line_items
                add constraint fk_invoice_line_items_financial_snapshot
                foreign key (financial_snapshot_id) references financial_snapshots (id)
                on delete set null
            ');
        }
    }

    public function down(): void
    {
        if ($this->tieneRestriccion('fk_invoice_line_items_financial_snapshot')) {
            DB::statement('alter table invoice_line_items drop foreign key fk_invoice_line_items_financial_snapshot');
        }

        if (Schema::hasColumn('invoice_line_items', 'financial_snapshot_id')) {
            DB::statement('alter table invoice_line_items drop column financial_snapshot_id');
        }

        foreach (['settlement_number_next_sequence', 'settlement_number_prefix'] as $columna) {
            if (Schema::hasColumn('tenant_settings', $columna)) {
                DB::statement("alter table tenant_settings drop column `{$columna}`");
            }
        }
    }

    private function tieneRestriccion(string $nombre): bool
    {
        return DB::table('information_schema.table_constraints')
            ->where('constraint_schema', DB::getDatabaseName())
            ->where('table_name', 'invoice_line_items')
            ->where('constraint_name', $nombre)
            ->exists();
    }
};
