<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sustituye las claves foráneas de una sola columna por claves compuestas
 * (tenant_id, padre_id), de modo que InnoDB rechace por sí solo cualquier fila
 * que cruce empresas. Va en su propia migración, después de las cinco de
 * dominio, porque necesita que existan todas las tablas y todas sus claves
 * únicas (tenant_id, id).
 *
 * Ver database/schema/85_cross_tenant_isolation.sql y docs/mysql-port.md.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(file_get_contents(database_path('schema/85_cross_tenant_isolation.sql')));
    }

    public function down(): void
    {
        // Las cinco migraciones de dominio hacen DROP TABLE en su propio down(),
        // que se lleva por delante estas restricciones. No hay nada que
        // deshacer por separado: revertir a FK de una columna reabriría el
        // agujero de aislamiento a cambio de nada.
    }
};
