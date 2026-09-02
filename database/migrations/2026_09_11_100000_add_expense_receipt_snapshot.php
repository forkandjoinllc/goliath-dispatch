<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Si este gasto exigía recibo cuando se presentó.
 *
 * ## Por qué una copia y no leer la categoría
 *
 * Porque la tabla ya tomó esta decisión una vez. `expenses.treatment_snapshot`
 * existe justo para esto: la categoría dice hoy cómo trata el dinero, y el
 * gasto guarda cómo lo trataba EL DÍA QUE SE PRESENTÓ, para que cambiar una
 * categoría el trimestre que viene no reescriba lo que ya se liquidó.
 *
 * Con el recibo pasa igual y peor. Si mañana alguien marca «peajes» como
 * categoría que exige recibo, sin esta columna todos los peajes aprobados el
 * año pasado pasarían a estar aprobados sin el papel que ahora hace falta — y
 * un informe de cumplimiento diría que se aprobaron mal cosas que se aprobaron
 * bien. La regla que se aplicó es la que estaba puesta entonces.
 *
 * ## Las filas que ya existen
 *
 * Se rellenan con lo que diga su categoría HOY, que es la única información que
 * hay. No es exacto para un gasto de hace seis meses cuya categoría cambió
 * entretanto, y conviene decirlo aquí en vez de fingir que sí: es la mejor
 * aproximación disponible, y a partir de ahora cada gasto guarda la suya.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('expenses', function (Blueprint $table): void {
            $table->boolean('requires_receipt_snapshot')->default(false)->after('treatment_snapshot');
        });

        DB::statement('
            update expenses e
            join expense_categories c on c.id = e.category_id
            set e.requires_receipt_snapshot = c.requires_receipt
        ');
    }

    public function down(): void
    {
        Schema::table('expenses', fn (Blueprint $table) => $table->dropColumn('requires_receipt_snapshot'));
    }
};
