<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Authorization\PermissionDescriptionsEs;
use App\Authorization\Permissions;
use App\Authorization\RoleMatrix;
use App\Enums\Role;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Copia el catálogo de permisos y la matriz de roles a la base de datos.
 *
 * Ojo con lo que esto NO es: la comprobación en tiempo de ejecución lee de
 * App\Authorization\Permissions y RoleMatrix, no de estas tablas. Aquí se
 * duplica solo para poder consultarlo con SQL — informes de quién puede qué,
 * pantallas de administración, auditorías. Si las dos versiones discreparan,
 * manda el código; por eso este seeder es idempotente y se puede volver a
 * ejecutar en cada despliegue para forzar que coincidan.
 *
 * Es reejecutable: actualiza las descripciones que cambien, inserta lo nuevo y
 * borra lo que ya no exista en el catálogo.
 */
class PermissionCatalogSeeder extends Seeder
{
    public function run(): void
    {
        $now = now()->format('Y-m-d H:i:s.v');

        $rows = [];
        foreach (Permissions::ALL as $key => $descriptionEn) {
            $parts = Permissions::parts($key);
            $rows[] = [
                'id' => (string) Str::uuid(),
                'key' => $key,
                'resource' => $parts['resource'],
                'action' => $parts['action'],
                'description_en' => $descriptionEn,
                'description_es' => PermissionDescriptionsEs::get($key),
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        // upsert por `key`: conserva el id de las filas existentes, que es lo que
        // referencian user_permission_overrides. Regenerarlos rompería esas
        // excepciones por usuario en silencio.
        DB::table('permissions')->upsert(
            $rows,
            ['key'],
            ['resource', 'action', 'description_en', 'description_es', 'updated_at'],
        );

        DB::table('permissions')->whereNotIn('key', Permissions::keys())->delete();

        $ids = DB::table('permissions')->pluck('id', 'key');

        $grants = [];
        foreach (Role::cases() as $role) {
            foreach (RoleMatrix::for($role) as $key => $scope) {
                $grants[] = [
                    'id' => (string) Str::uuid(),
                    'role' => $role->value,
                    'permission_id' => $ids[$key],
                    'scope' => $scope->value,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }

        DB::table('role_permissions')->upsert(
            $grants,
            ['role', 'permission_id'],
            ['scope', 'updated_at'],
        );

        // Una concesión retirada del código debe desaparecer de la tabla. Sin
        // esto, quitar un permiso a un rol lo dejaría visible en los informes
        // para siempre.
        $valid = collect($grants)->map(fn (array $g): string => $g['role'].'|'.$g['permission_id']);
        DB::table('role_permissions')
            ->whereNotIn(DB::raw("concat(role, '|', permission_id)"), $valid)
            ->delete();

        $this->command->info(sprintf(
            'Catálogo de permisos: %d permisos, %d concesiones en %d roles.',
            count($rows), count($grants), count(Role::cases()),
        ));
    }
}
