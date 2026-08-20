<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Sobre qué importe se cobra la tarifa de despacho de cada empresa.
 *
 * El esquema portado fija los nombres de las columnas del cálculo pero no esta
 * decisión, y no es un detalle: sobre seis cargas de demostración las dos
 * lecturas se separan en $621, todos ellos salidos del bolsillo del
 * transportista. Ver docs/finanzas.md.
 *
 * Va en los ajustes de la empresa y no como constante en el código porque esto
 * es multiempresa: cada casa de despacho firma su propio contrato con sus
 * transportistas, y una que cobre sobre el bruto íntegro no puede obligar a las
 * demás a hacer lo mismo.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenant_settings', function ($table): void {
            $table->string('dispatch_fee_base', 30)
                ->default('commissionable_base')
                ->after('default_carrier_dispatch_fee_bps');
        });

        // El CHECK va en SQL crudo: el resto del esquema usa CHECK y no ENUM
        // (ver docs/mysql-port.md), y un valor fuera de la lista aquí no daría
        // un error sino un cálculo silenciosamente distinto.
        DB::statement("
            alter table tenant_settings
            add constraint chk_tenant_settings_dispatch_fee_base
            check (dispatch_fee_base in ('commissionable_base','carrier_gross_rate'))
        ");
    }

    public function down(): void
    {
        DB::statement('alter table tenant_settings drop check chk_tenant_settings_dispatch_fee_base');

        Schema::table('tenant_settings', function ($table): void {
            $table->dropColumn('dispatch_fee_base');
        });
    }
};
