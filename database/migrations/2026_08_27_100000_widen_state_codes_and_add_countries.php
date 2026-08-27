<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Los estados dejan de caber en dos letras, y toda dirección dice de qué país es.
 *
 * El esquema portado dio por hecho Estados Unidos: `varchar(2)` para el estado y
 * ninguna columna de país en la mitad de las tablas. En cuanto se despacha a
 * México deja de valer — los códigos ISO 3166-2 de los estados mexicanos tienen
 * TRES letras: NLE (Nuevo León), CMX (Ciudad de México), JAL (Jalisco). Meterlos
 * en dos letras obligaría a inventarse abreviaturas que nadie reconocería en un
 * permiso ni en una matrícula.
 *
 * Canadá sí cabe en dos (ON, QC, BC), pero un `varchar(3)` uniforme es una
 * columna que no hay que volver a mirar.
 *
 * Ensanchar NO pierde datos: todo lo que cabía en dos letras cabe en tres. Por
 * eso `down()` puede ser destructivo y se dice aquí en voz alta: volver a
 * `varchar(2)` TRUNCA los códigos mexicanos. Solo tiene sentido si nunca se
 * guardó ninguno.
 *
 * Las columnas de país nacen con 'US' por omisión porque eso es lo que hay
 * ahora en las filas: no se está afirmando nada nuevo sobre ellas, se está
 * escribiendo lo que ya se suponía.
 */
return new class extends Migration
{
    /**
     * tabla => columnas de subdivisión que pasan a varchar(3).
     *
     * @var array<string, list<string>>
     */
    private array $estados = [
        'carriers' => ['physical_state', 'mailing_state'],
        'customers' => ['physical_state', 'billing_state'],
        'customer_locations' => ['state'],
        'drivers' => ['license_state'],
        'trucks' => ['plate_state'],
        'trailers' => ['plate_state'],
        'factoring_companies' => ['address_state'],
        'load_stops' => ['state'],
        'tenant_settings' => ['address_state'],

        // Los permisos de sobredimensión también hablan de estados, y son los
        // que más van a doler el día que una carga cruce a México: un permiso
        // se pide POR estado atravesado.
        'route_states' => ['state_code'],
        'oversize_rules' => ['state_code'],
        'permits' => ['state_code'],
        'escorts' => ['state_code'],
    ];

    /**
     * Las que son NOT NULL. `modify` reescribe la definición entera, así que
     * hay que devolverles su «not null» o dejarían de serlo en silencio.
     *
     * @var array<string, list<string>>
     */
    private array $obligatorias = [
        'route_states' => ['state_code'],
        'oversize_rules' => ['state_code'],
        'permits' => ['state_code'],
    ];

    /**
     * tabla => [columna de país nueva => columna detrás de la cual va].
     *
     * `carriers`, `customer_locations`, `load_stops` y `tenant_settings` ya
     * tenían país; no salen aquí.
     *
     * @var array<string, array<string, string>>
     */
    private array $paises = [
        'customers' => [
            'physical_country' => 'physical_state',
            'billing_country' => 'billing_state',
        ],
        'drivers' => ['license_country' => 'license_state'],
        'trucks' => ['plate_country' => 'plate_state'],
        'trailers' => ['plate_country' => 'plate_state'],
        'factoring_companies' => ['address_country' => 'address_state'],
    ];

    public function up(): void
    {
        foreach ($this->estados as $tabla => $columnas) {
            foreach ($columnas as $columna) {
                // MODIFY en SQL crudo y no `->change()`: el `change()` de Laravel
                // reconstruye la definición entera de la columna a partir de lo
                // que cree que hay, y aquí lo único que debe cambiar es el ancho.
                $nulo = in_array($columna, $this->obligatorias[$tabla] ?? [], true) ? 'not null' : 'null';

                DB::statement("alter table `{$tabla}` modify `{$columna}` varchar(3) {$nulo}");
            }
        }

        foreach ($this->paises as $tabla => $columnas) {
            Schema::table($tabla, function (Blueprint $table) use ($tabla, $columnas): void {
                foreach ($columnas as $nueva => $despuesDe) {
                    if (Schema::hasColumn($tabla, $nueva)) {
                        continue;
                    }

                    $table->string($nueva, 2)->nullable()->default('US')->after($despuesDe);
                }
            });
        }
    }

    public function down(): void
    {
        foreach ($this->paises as $tabla => $columnas) {
            Schema::table($tabla, function (Blueprint $table) use ($columnas): void {
                $table->dropColumn(array_keys($columnas));
            });
        }

        // ATENCIÓN: esto TRUNCA los códigos de tres letras. Ver la cabecera.
        foreach ($this->estados as $tabla => $columnas) {
            foreach ($columnas as $columna) {
                $nulo = in_array($columna, $this->obligatorias[$tabla] ?? [], true) ? 'not null' : 'null';

                DB::statement("alter table `{$tabla}` modify `{$columna}` varchar(2) {$nulo}");
            }
        }
    }
};
