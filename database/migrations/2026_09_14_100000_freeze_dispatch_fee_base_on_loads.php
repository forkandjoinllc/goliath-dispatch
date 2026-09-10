<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Con qué base se acordó cobrar la tarifa de despacho de ESTA carga.
 *
 * ## Por qué una copia y no leer los ajustes
 *
 * Porque las otras tres entradas de dinero ya lo hacen, y por escrito. Encima
 * mismo de la línea que fallaba, en `LoadCalculator`:
 *
 * > Los puntos básicos salen de la CARGA, no del transportista ni de los
 * > ajustes. Están congelados ahí desde que se acordó la carga precisamente
 * > para que subirle la tarifa a un transportista hoy no reescriba lo que se
 * > pactó el mes pasado.
 *
 * `carrier_dispatch_fee_bps`, `dispatcher_commission_bps` y
 * `dispatcher_commission_basis` viven en `loads`. La cuarta —la base sobre la
 * que se aplica el porcentaje— se leía viva de `tenant_settings`.
 *
 * Medido sobre una carga que ya existía, con un gasto excluido de $1.000:
 *
 * | | antes | después de cambiar el ajuste |
 * |---|---|---|
 * | Tarifa de despacho | $300,00 | $400,00 |
 * | Lo que cobra el transportista | $3.700,00 | $3.600,00 |
 * | Comisión del despachador | $75,00 | $100,00 |
 *
 * Y la pantalla de Ajustes dice tres veces, en los dos idiomas, que cambiarla
 * no reescribe nada de lo que ya existe.
 *
 * ## Es la regla que la tabla de gastos ya tomó
 *
 * `expenses.treatment_snapshot` existe por esto mismo: la categoría dice hoy
 * cómo trata el dinero, y el gasto guarda cómo lo trataba el día que se
 * presentó. Esta columna es esa misma decisión aplicada a la única entrada de
 * dinero de una carga que se había quedado fuera.
 *
 * ## Las filas que ya existen
 *
 * Se rellenan con lo que digan los ajustes de su empresa HOY, que es
 * exactamente el valor con el que se vienen calculando. El importe de ninguna
 * carga abierta se mueve por esta migración: lo que cambia es que a partir de
 * ahora deja de moverse solo.
 *
 * Las liquidaciones ya cerradas no dependían de esto —conservan su cifra en
 * `financial_snapshots`, que es de solo añadir—, pero el snapshot guardaba los
 * puntos básicos y la base de la COMISIÓN y no la de la TARIFA: no se podía
 * saber con cuál se había calculado. La columna se añade también ahí.
 */
return new class extends Migration
{
    private const BASES = "'commissionable_base', 'carrier_gross_rate'";

    private const POR_OMISION = 'commissionable_base';

    public function up(): void
    {
        Schema::table('loads', function (Blueprint $table): void {
            $table->string('dispatch_fee_base', 32)
                ->default(self::POR_OMISION)
                ->after('dispatcher_commission_basis');
        });

        // Lo que la empresa tiene puesto hoy es lo que se venía usando, así que
        // copiarlo deja todos los importes donde estaban.
        DB::statement('
            update loads l
            join tenant_settings s on s.tenant_id = l.tenant_id
            set l.dispatch_fee_base = s.dispatch_fee_base
        ');

        DB::statement('alter table loads add constraint chk_loads_dispatch_fee_base check (dispatch_fee_base in ('.self::BASES.'))');

        Schema::table('financial_snapshots', function (Blueprint $table): void {
            $table->string('dispatch_fee_base', 32)
                ->default(self::POR_OMISION)
                ->after('dispatcher_commission_basis');
        });

        DB::statement('
            update financial_snapshots f
            join tenant_settings s on s.tenant_id = f.tenant_id
            set f.dispatch_fee_base = s.dispatch_fee_base
        ');

        DB::statement('alter table financial_snapshots add constraint chk_financial_snapshots_dispatch_fee_base check (dispatch_fee_base in ('.self::BASES.'))');
    }

    public function down(): void
    {
        DB::statement('alter table loads drop constraint chk_loads_dispatch_fee_base');
        DB::statement('alter table financial_snapshots drop constraint chk_financial_snapshots_dispatch_fee_base');

        Schema::table('loads', fn (Blueprint $t) => $t->dropColumn('dispatch_fee_base'));
        Schema::table('financial_snapshots', fn (Blueprint $t) => $t->dropColumn('dispatch_fee_base'));
    }
};
