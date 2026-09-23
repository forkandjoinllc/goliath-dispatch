<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * El equipo HABITUAL de un conductor: su camión y su remolque.
 *
 * ## Por qué no basta con `load_assignments`
 *
 * `load_assignments` dice qué camión llevó QUÉ CARGA. Es la verdad del
 * despacho y lo sigue siendo. Lo que no dice es qué camión lleva Eduardo
 * normalmente, y esa es la pregunta que se hace todo el día: el tablero la
 * hace en la columna de conductores, y quien crea una carga la hace cada vez
 * que elige conductor.
 *
 * Sin esta tabla, un conductor sin carga en curso no tiene equipo que enseñar,
 * y el despachador vuelve a elegir camión y remolque a mano en cada carga —
 * eligiendo casi siempre el mismo, y equivocándose el día que no.
 *
 * ## Lo que esta tabla NO decide
 *
 * No decide qué se despacha. Prerrellena la asignación de la carga y ahí se
 * puede cambiar: el camión de siempre está en el taller y hoy va otro. La
 * carga guarda lo que de verdad llevó, en `load_assignments`, como hasta ahora.
 *
 * ## Las reglas
 *
 * - **Con fechas.** Una asignación empieza un día y puede terminar otro. Sin
 *   fecha de fin, sigue vigente. Guardar el historial y no pisarlo importa
 *   porque una carga de marzo se mira con el camión que se llevó en marzo.
 * - **Un camión no puede estar con dos conductores a la vez.** Dos conductores
 *   con el mismo camión el mismo día es un estado que no existe en la calle, y
 *   si la base lo admite el tablero enseña dos veces el mismo camión.
 * - **Un conductor puede no tener remolque.** Es lo normal en una flota donde
 *   los remolques se sueltan y se recogen. `trailer_id` es nulo y no pasa nada.
 * - **El camión sí hace falta.** Una asignación sin camión ni remolque no
 *   asigna nada; la fila no tendría por qué existir.
 *
 * El solapamiento NO lo puede comprobar una restricción de MySQL —no hay tipo
 * rango ni exclusión— así que lo comprueba `Support\Fleet\StandingAssignment`
 * y lo vigila una prueba. Lo que sí se puede poner en la base, se pone: el
 * camión obligatorio, las fechas en orden, y el índice que hace barata la
 * pregunta de «¿quién lleva este camión hoy?».
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('driver_equipment_assignments', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('driver_id');
            $table->uuid('truck_id');
            $table->uuid('trailer_id')->nullable();

            $table->date('starts_on');
            $table->date('ends_on')->nullable();

            $table->uuid('assigned_by_user_id')->nullable();
            $table->string('notes', 500)->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'driver_id', 'starts_on'], 'idx_standing_driver');
            $table->index(['tenant_id', 'truck_id', 'starts_on'], 'idx_standing_truck');
            $table->index(['tenant_id', 'trailer_id', 'starts_on'], 'idx_standing_trailer');
        });

        DB::statement(
            'alter table driver_equipment_assignments
             add constraint chk_standing_dates check (ends_on is null or ends_on >= starts_on)'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_equipment_assignments');
    }
};
