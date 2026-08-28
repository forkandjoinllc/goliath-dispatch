<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Lo que una carga EXIGE de quien la lleva.
 *
 * Es la otra mitad de lo que el lote 18 puso en `drivers`. Allí están los
 * hechos del conductor; aquí las preguntas de la carga. El sistema las compara
 * y dice cumple / no cumple / no consta — ver App\Support\Loads\DriverEligibility.
 * NO descarta a nadie: asigna una persona.
 *
 * `source` NO ES DECORACIÓN. Es de dónde sale el requisito: el contrato, la
 * base, el cliente. Para un requisito de autorización de trabajo el controlador
 * lo exige, y por una razón concreta: exigir ciudadanía sin un contrato que la
 * pida por escrito es discriminación por estatus migratorio (8 U.S.C. § 1324b),
 * no una regla de negocio. Este campo es lo que separa una cosa de la otra el
 * día que alguien pregunte. Esto no es asesoramiento legal.
 *
 * POR QUÉ NO HAY ÍNDICE ÚNICO SOBRE (carga, tipo, valor)
 *
 * Lo natural sería emular el índice parcial con una columna generada, como hace
 * el resto del esquema. No se puede: la columna tendría que depender de
 * `load_id`, y `load_id` es columna de una clave ajena con ON DELETE CASCADE.
 * MySQL prohíbe esa combinación —es el error 1215 que rompió el despliegue del
 * lote 15—. El duplicado se impide en el controlador, y aquí queda dicho por
 * qué no está donde debería.
 *
 * Reanudable: cada paso mira antes si ya está hecho. MySQL no tiene DDL
 * transaccional y una migración a medias no se registra.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('load_requirements')) {
            DB::statement("
                create table `load_requirements` (
                    `id` char(36) not null,
                    `tenant_id` char(36) not null,
                    `load_id` char(36) not null,
                    `requirement_type` varchar(30) not null,
                    `value` varchar(40) null,
                    `source` text null,
                    `notes` text null,
                    `created_by_user_id` char(36) null,
                    `created_at` datetime(3) not null default current_timestamp(3),
                    `updated_at` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
                    `deleted_at` datetime(3) null,
                    `deleted_by` char(36) null,
                    `deletion_reason` text null,
                    primary key (`id`),
                    unique key `load_requirements_tenant_id_uq` (`tenant_id`, `id`),
                    key `load_requirements_load_idx` (`tenant_id`, `load_id`)
                ) engine=innodb default charset=utf8mb4 collate=utf8mb4_0900_ai_ci
            ");
        }

        if (! $this->tieneRestriccion('chk_load_requirements_type')) {
            DB::statement("
                alter table load_requirements
                add constraint chk_load_requirements_type
                check (`requirement_type` in (
                    'twic','endorsement','work_authorization','clean_record'
                ))
            ");
        }

        // Aislamiento entre empresas por clave compuesta, igual que el resto del
        // esquema: un requisito no puede colgar de una carga de OTRA empresa
        // cliente aunque alguien fabrique el identificador a mano.
        if (! $this->tieneRestriccion('fk_load_requirements_load_xt')) {
            DB::statement('
                alter table load_requirements
                add constraint fk_load_requirements_load_xt
                foreign key (tenant_id, load_id) references loads (tenant_id, id)
                on delete cascade
            ');
        }

        if (! $this->tieneRestriccion('fk_load_requirements_tenant')) {
            DB::statement('
                alter table load_requirements
                add constraint fk_load_requirements_tenant
                foreign key (tenant_id) references tenants (id) on delete cascade
            ');
        }

        // `set null`: que un despachador se dé de baja no borra el requisito que
        // puso. Se pierde el nombre, no el hecho.
        if (! $this->tieneRestriccion('fk_load_requirements_created_by_user')) {
            DB::statement('
                alter table load_requirements
                add constraint fk_load_requirements_created_by_user
                foreign key (created_by_user_id) references users (id) on delete set null
            ');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('load_requirements');
    }

    /** CHECK o clave ajena, que en information_schema viven en la misma tabla. */
    private function tieneRestriccion(string $nombre): bool
    {
        if (! Schema::hasTable('load_requirements')) {
            return false;
        }

        return DB::table('information_schema.table_constraints')
            ->where('constraint_schema', DB::getDatabaseName())
            ->where('table_name', 'load_requirements')
            ->where('constraint_name', $nombre)
            ->exists();
    }
};
