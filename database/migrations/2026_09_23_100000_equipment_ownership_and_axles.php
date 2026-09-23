<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * La ficha de una unidad: de quién es, cuánto mide y cómo lleva los ejes.
 *
 * ## Tres cosas que faltaban
 *
 * **1. De quién es la unidad.** Propia, arrendada, o arrendada con opción a
 * compra. No estaba en ninguna parte, y es lo primero que pregunta un seguro y
 * lo que decide quién paga una avería.
 *
 * **2. Un tractor no tenía ni una medida.** `trailers` llevaba largo, ancho,
 * altura de plataforma, ejes y configuración; `trucks` no llevaba ninguna. Un
 * tractor tiene largo, ancho, alto y ejes como cualquier cosa que circula, y
 * sin ellos la mitad de una combinación no se puede medir.
 *
 * **3. Las distancias ENTRE ejes.** El número de ejes ya estaba (en remolques).
 * Lo que decide cuánto peso admite legalmente un conjunto no es cuántos ejes
 * tiene sino cómo están repartidos: dos ejes a 40 pulgadas y dos a 120 admiten
 * pesos distintos, y la fórmula federal del puente se calcula sobre esas
 * distancias. Por eso van en su propia tabla y ordenadas: son n-1 huecos para
 * n ejes, y el orden es el del vehículo de delante atrás.
 *
 * ## Por qué las medidas siguen en PULGADAS
 *
 * La pantalla las pide en pies y pulgadas por separado, que es como se leen de
 * una cinta métrica y como vienen en un permiso. La BASE guarda una sola cifra
 * en pulgadas, y la conversión se hace en el borde.
 *
 * Guardar dos columnas —pies y pulgadas— invitaría al estado imposible: 13
 * pies y 14 pulgadas. Y todo lo que ya compara medidas —`Oversize\Evaluator`
 * contra `oversize_rules`— trabaja en pulgadas desde el primer día. Una unidad
 * y una sola.
 */
return new class extends Migration
{
    private const PROPIEDAD = "'owned', 'leased', 'lease_to_own'";

    private const POR_OMISION = 'owned';

    public function up(): void
    {
        foreach (['trucks', 'trailers'] as $tabla) {
            Schema::table($tabla, function (Blueprint $table) use ($tabla): void {
                $table->string('ownership', 20)
                    ->default(self::POR_OMISION)
                    ->after('model');

                // Quién la arrienda y hasta cuándo. Nulo cuando es propia, y
                // no se exige: una flota que acaba de empezar a registrar esto
                // no tiene por qué saberlo de cada unidad el primer día.
                $table->string('lessor_name', 160)->nullable()->after('ownership');
                $table->date('lease_ends_on')->nullable()->after('lessor_name');

                if ($tabla === 'trucks') {
                    $table->unsignedSmallInteger('length_inches')->nullable()->after('lease_ends_on');
                    $table->unsignedSmallInteger('width_inches')->nullable()->after('length_inches');
                    $table->unsignedSmallInteger('height_inches')->nullable()->after('width_inches');
                    $table->unsignedSmallInteger('axle_count')->nullable()->after('height_inches');
                    $table->string('axle_configuration', 60)->nullable()->after('axle_count');
                }
            });

            DB::statement("alter table {$tabla} add constraint chk_{$tabla}_ownership check (ownership in (".self::PROPIEDAD.'))');
        }

        /*
         * Las distancias entre ejes consecutivos.
         *
         * Una fila por HUECO, no por eje: con cinco ejes hay cuatro distancias.
         * `position` es el hueco, de 1 en adelante y contando de delante atrás,
         * y es único por unidad para que no haya dos «la distancia entre el
         * segundo y el tercero».
         *
         * `owner_type` y `owner_id` es el mismo par que ya usan los documentos
         * y los medios de equipo. Se repite el vocabulario a propósito: una
         * tercera forma de decir «de qué unidad es esta fila» sería una tercera
         * consulta que escribir en cada sitio.
         */
        Schema::create('equipment_axle_spacings', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->string('owner_type', 20);
            $table->uuid('owner_id');
            $table->unsignedTinyInteger('position');
            $table->unsignedSmallInteger('inches');
            $table->timestamps();

            $table->unique(['owner_type', 'owner_id', 'position'], 'uq_axle_spacing_position');
            $table->index(['tenant_id', 'owner_type', 'owner_id'], 'idx_axle_spacing_owner');
        });

        DB::statement("alter table equipment_axle_spacings add constraint chk_axle_spacing_owner check (owner_type in ('truck', 'trailer'))");

        // Una distancia de cero pulgadas no es una distancia: es una fila que
        // alguien dejó a medias, y la fórmula del puente dividiría por ella.
        DB::statement('alter table equipment_axle_spacings add constraint chk_axle_spacing_inches check (inches > 0)');

        DB::statement('alter table equipment_axle_spacings add constraint chk_axle_spacing_position check (position > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('equipment_axle_spacings');

        foreach (['trucks', 'trailers'] as $tabla) {
            DB::statement("alter table {$tabla} drop constraint chk_{$tabla}_ownership");

            Schema::table($tabla, function (Blueprint $table) use ($tabla): void {
                $columnas = ['ownership', 'lessor_name', 'lease_ends_on'];

                if ($tabla === 'trucks') {
                    $columnas = [...$columnas, 'length_inches', 'width_inches', 'height_inches', 'axle_count', 'axle_configuration'];
                }

                $table->dropColumn($columnas);
            });
        }
    }
};
