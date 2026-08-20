<?php

declare(strict_types=1);

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * Solo lo que debe existir en CUALQUIER entorno, producción incluida.
 *
 * Los datos de demostración bilingües (empresas, transportistas, cargas) van en
 * un seeder aparte que no se ejecuta en producción — ver fase 3.
 */
class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $this->call([
            PermissionCatalogSeeder::class,
            SaasPlanSeeder::class,
        ]);
    }
}
