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

        // CurrentActor está registrado como `scoped`: en producción vive lo que
        // dura la petición y muere con el proceso de PHP. En las pruebas el
        // contenedor es el MISMO durante toda la prueba, así que el Actor
        // resuelto durante el POST /login —cuando todavía no hay empresa activa,
        // porque LoginResponse la fija al final de esa misma petición— sobrevivía
        // a las peticiones siguientes con tenantId y role en nulo.
        //
        // Registrarlo como transitorio en pruebas lo resuelve de nuevo cada vez.
        // Es más lento y da igual: aquí lo que importa es que no mienta.
        $this->app->bind(\App\Authorization\CurrentActor::class);
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
