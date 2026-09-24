<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * La distancia que no es de ninguna unidad: del último eje de tracción al
 * primer eje del remolque.
 *
 * ## Por qué hace falta una tabla más
 *
 * `equipment_axle_spacings` guarda los huecos DE UNA UNIDAD, y eso está bien:
 * los dos huecos del tractor son del tractor lleve el remolque que lleve, y
 * los del remolque son del remolque lo arrastre quien lo arrastre.
 *
 * Pero en una combinación de cinco ejes hay CUATRO huecos, y solo cuatro menos
 * uno caben en las dos fichas. El que sobra —de la última tracción al primer
 * eje del remolque— no pertenece al camión ni al remolque: pertenece a la
 * pareja. Cambia el camión y cambia; cambia el remolque y cambia; y es
 * justamente el hueco del que depende la fórmula federal del puente y el que
 * pregunta toda oficina de permisos.
 *
 * Sin esta tabla, la suma de una ficha de camión se presentaba como «del
 * primer eje al último» y era verdad de la unidad, pero la distancia que pide
 * un permiso —del primer eje del tractor al último del remolque— no se podía
 * calcular: faltaba el tramo del medio y no había dónde ponerlo.
 *
 * ## Una fila por pareja, no por carga
 *
 * Un tractor y un remolque concretos miden lo que miden. Un RGN extensible
 * cambia de longitud de una carga a otra, y ese caso se anota con `notes` y se
 * ajusta en el permiso: la ficha guarda la medida NOMINAL de la pareja, que es
 * la que se toma una vez con la cinta y sirve para las demás.
 *
 * ## Lo que se guarda además
 *
 * Las tres medidas que toda hoja de permisos lleva escritas al margen:
 * parachoques a parachoques, del eje de dirección al kingpin, y del kingpin a
 * los ejes del remolque. Son opcionales, porque no todas las oficinas las
 * piden y no todo el mundo las ha tomado; la del medio no lo es, porque es la
 * razón de que la fila exista.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('equipment_combo_spacings', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('truck_id');
            $table->uuid('trailer_id');

            // La razón de ser de la fila: obligatoria.
            $table->unsignedInteger('drive_to_trailer_inches');

            // Las del margen de la hoja de permisos.
            $table->unsignedInteger('bumper_to_bumper_inches')->nullable();
            $table->unsignedInteger('kingpin_to_rear_inches')->nullable();
            $table->unsignedInteger('kingpin_to_trailer_axles_inches')->nullable();

            $table->date('measured_on')->nullable();
            $table->uuid('measured_by_user_id')->nullable();
            $table->string('notes', 500)->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'truck_id'], 'idx_combo_truck');
            $table->index(['tenant_id', 'trailer_id'], 'idx_combo_trailer');
        });

        /*
        | Una pareja no se mide dos veces.
        |
        | Con la misma columna generada que `vendor_carriers`, y por la misma
        | razón: el par vive mientras la fila no esté borrada, así que una
        | medida retirada y vuelta a tomar puede existir junto a la vieja sin
        | que el índice lo impida.
        */
        DB::statement(
            'alter table equipment_combo_spacings add column live_pair_key char(73)
             as (case when deleted_at is null then concat(truck_id, \':\', trailer_id) end) stored'
        );

        DB::statement(
            'alter table equipment_combo_spacings
             add constraint combo_spacings_live_uq unique (live_pair_key)'
        );

        /*
        | Un hueco de cero pulgadas no existe.
        |
        | Se escribe cuando alguien pone un cero en las dos casillas creyendo
        | que así lo deja en blanco, y guardarlo daría una distancia que
        | ninguna fórmula puede usar. La misma regla que
        | `chk_axle_spacing_inches` en la tabla de al lado.
        */
        DB::statement(
            'alter table equipment_combo_spacings
             add constraint chk_combo_drive_to_trailer check (drive_to_trailer_inches > 0)'
        );

        foreach (['bumper_to_bumper', 'kingpin_to_rear', 'kingpin_to_trailer_axles'] as $columna) {
            DB::statement(
                'alter table equipment_combo_spacings add constraint chk_combo_'.$columna.'
                 check ('.$columna.'_inches is null or '.$columna.'_inches > 0)'
            );
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('equipment_combo_spacings');
    }
};
