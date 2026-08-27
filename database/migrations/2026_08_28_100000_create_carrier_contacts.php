<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Un transportista tiene más de una persona a la que llamar.
 *
 * `carriers` traía UNA en cuatro columnas sueltas —`contact_first_name`,
 * `contact_last_name`, `email`, `phone`— y eso no aguanta el uso real: el que
 * firma el contrato no es el que contesta a las tres de la mañana cuando un
 * camión se para en la I-35.
 *
 * Las cuatro columnas viejas NO se borran, y no es pereza. Son NOT NULL, medio
 * sistema las lee —el listado, las facturas, los correos de incorporación— y
 * FMCSA escribe en ellas al dar de alta. Lo que se hace es convertirlas en el
 * ESPEJO del contacto principal: la tabla manda, y quien guarda copia el
 * principal ahí. Así nada de lo que ya funciona se entera del cambio.
 *
 * El retrollenado de abajo crea el contacto principal de cada transportista que
 * ya existe. Sin él, abrir una ficha vieja enseñaría una lista de contactos
 * vacía junto a un contacto que sí está en la cabecera — y quien lo viera
 * pensaría, con razón, que se ha perdido un dato.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL «UN SOLO PRINCIPAL» NO SE APOYA EN UNA COLUMNA GENERADA SOBRE
 * `carrier_id`
 *
 * La primera versión de esta migración calculaba `live_primary_key` a partir de
 * `carrier_id`, como hace el resto del esquema con sus índices únicos parciales.
 * MySQL la rechazó con el error 1215 al añadir la clave ajena, y tenía razón:
 *
 *   «A foreign key constraint on the base column of a STORED generated column
 *    cannot use CASCADE as ON UPDATE or ON DELETE referential action.»
 *
 * `carrier_id` es columna base de la generada y columna de una ajena con
 * ON DELETE CASCADE. Las dos cosas a la vez no se pueden.
 *
 * La salida es que la columna generada NO dependa de `carrier_id`: es una
 * bandera que solo mira `deleted_at` e `is_primary`, y `carrier_id` entra en el
 * ÍNDICE, que no está sujeto a esa restricción. El invariante que se garantiza
 * es exactamente el mismo — un principal vivo por transportista — y lo sigue
 * garantizando la base de datos, no el buen comportamiento del controlador.
 * ────────────────────────────────────────────────────────────────────────────
 */
return new class extends Migration
{
    public function up(): void
    {
        // MySQL no tiene DDL transaccional: la versión anterior de esta
        // migración creó la tabla y murió al añadir la clave ajena, dejándola a
        // medias y SIN registrarse en `migrations`. Si esa tabla huérfana sigue
        // ahí, se tira antes de empezar.
        //
        // Esto solo puede ejecutarse sobre restos: una migración ya registrada
        // no vuelve a llamar a up().
        Schema::dropIfExists('carrier_contacts');

        Schema::create('carrier_contacts', function (Blueprint $table): void {
            $table->char('id', 36)->primary();
            $table->char('tenant_id', 36);
            $table->char('carrier_id', 36);

            $table->string('first_name', 100);
            $table->string('last_name', 100);
            $table->string('email', 255)->nullable();
            $table->string('phone', 32)->nullable();

            // El principal es el que se copia a las columnas de `carriers`. Hay
            // exactamente uno por transportista, y lo garantiza el índice de
            // abajo, no el buen comportamiento del controlador.
            $table->boolean('is_primary')->default(false);

            $table->text('notes')->nullable();

            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();
            $table->dateTime('deleted_at', 3)->nullable();
            $table->char('deleted_by', 36)->nullable();
            $table->text('deletion_reason')->nullable();

            $table->unique(['tenant_id', 'id'], 'carrier_contacts_tenant_id_uq');
            $table->index(['tenant_id', 'carrier_id'], 'carrier_contacts_carrier_idx');
        });

        // Un solo principal vivo por transportista. Emulación de índice parcial,
        // igual que en el resto del esquema: la bandera vale NULL salvo para el
        // principal vivo, y MySQL ignora los NULL en un índice único.
        //
        // La bandera NO mira `carrier_id` — ver la cabecera. `carrier_id` va en
        // el índice, que es donde no estorba.
        DB::statement('
            alter table carrier_contacts
            add column `live_primary_flag` tinyint(1)
            generated always as (
                case when `deleted_at` is null and `is_primary` = 1 then 1 end
            ) stored
        ');

        DB::statement('
            alter table carrier_contacts
            add unique key `carrier_contacts_primary_uq`
            (`tenant_id`, `carrier_id`, `live_primary_flag`)
        ');

        // Aislamiento entre empresas por clave compuesta, igual que el resto del
        // esquema: un contacto no puede colgar de un transportista de OTRA
        // empresa cliente aunque alguien fabrique el identificador a mano.
        DB::statement('
            alter table carrier_contacts
            add constraint fk_carrier_contacts_carrier_xt
            foreign key (tenant_id, carrier_id)
            references carriers (tenant_id, id)
            on delete cascade
        ');

        DB::statement('
            alter table carrier_contacts
            add constraint fk_carrier_contacts_tenant
            foreign key (tenant_id) references tenants (id) on delete cascade
        ');

        $this->retrollenar();
    }

    public function down(): void
    {
        Schema::dropIfExists('carrier_contacts');
    }

    /**
     * El contacto principal de cada transportista que ya existía.
     */
    private function retrollenar(): void
    {
        DB::table('carriers')
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->chunkById(500, function ($filas): void {
                $ahora = now();
                $lote = [];

                foreach ($filas as $c) {
                    $lote[] = [
                        'id' => (string) Str::uuid(),
                        'tenant_id' => $c->tenant_id,
                        'carrier_id' => $c->id,
                        'first_name' => $c->contact_first_name,
                        'last_name' => $c->contact_last_name,
                        'email' => $c->email,
                        'phone' => $c->phone,
                        'is_primary' => true,
                        'created_at' => $ahora,
                        'updated_at' => $ahora,
                    ];
                }

                if ($lote !== []) {
                    DB::table('carrier_contacts')->insert($lote);
                }
            });
    }
};
