<?php

declare(strict_types=1);

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

abstract class TestCase extends BaseTestCase
{
    /**
     * ¿Se ha comprobado ya el esquema en este proceso?
     */
    private static bool $schemaChecked = false;

    protected function setUp(): void
    {
        parent::setUp();

        $this->ensureSchema();
    }

    /**
     * Construye el esquema de pruebas si falta.
     *
     * No se usa RefreshDatabase. Construir estas 99 tablas cuesta unos seis
     * segundos —246 claves foráneas, 47 triggers, 89 CHECK— y hacerlo por cada
     * clase de prueba convertiría la suite en algo que nadie ejecuta. En su lugar
     * se construye una vez y cada prueba que escribe se envuelve en una
     * transacción (ver RefreshesDatabase).
     *
     * La comprobación es por proceso, no por prueba: una consulta a
     * information_schema por suite.
     */
    private function ensureSchema(): void
    {
        if (self::$schemaChecked) {
            return;
        }

        self::$schemaChecked = true;

        $tables = DB::table('information_schema.tables')
            ->where('table_schema', DB::getDatabaseName())
            ->count();

        if ($tables < 90) {
            Artisan::call('migrate', ['--force' => true]);
        }
    }
}
