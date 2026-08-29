<?php

declare(strict_types=1);

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

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
     * Comprueba que el esquema de pruebas está al día. NO lo migra.
     *
     * No se usa RefreshDatabase. Construir estas 99 tablas cuesta unos seis
     * segundos —246 claves foráneas, 47 triggers, 89 CHECK— y hacerlo por cada
     * clase de prueba convertiría la suite en algo que nadie ejecuta. En su lugar
     * se construye una vez y cada prueba que escribe se envuelve en una
     * transacción (ver RefreshesDatabase).
     *
     * La comprobación es por proceso, no por prueba: una consulta por suite.
     *
     * Aquí NO se migra, y la razón es cara de aprender: este método corre desde
     * `setUp`, o sea DENTRO de la transacción que abre `DatabaseTransactions`, y
     * MySQL hace COMMIT IMPLÍCITO en cuanto ve una sentencia de DDL. Migrar aquí
     * confirma la transacción de la primera prueba a mitad, y sus datos de
     * prueba —una empresa, un cliente, un usuario por rol— quedan grabados para
     * siempre en la base. Las pruebas siguientes empiezan a contar de más y
     * fallan por sitios que no tienen nada que ver.
     *
     * Antes de esto la comprobación era «si hay menos de 90 tablas, migra», que
     * construía el esquema la primera vez y no volvía a mirar nunca: una
     * migración nueva no llegaba a la base de pruebas y la suite seguía en verde
     * contra un esquema viejo. Los dos extremos son malos. Lo que se hace es
     * pararse y decir qué comando falta.
     */
    private function ensureSchema(): void
    {
        if (self::$schemaChecked) {
            return;
        }

        self::$schemaChecked = true;

        $pendientes = $this->pendingMigrations();

        if ($pendientes === []) {
            return;
        }

        // El comando lleva DB_DATABASE delante a propósito. `--env=testing` NO
        // vale: sin un fichero `.env.testing` —que no está en el repositorio—
        // Laravel se queda con `.env` y migra la base de DESARROLLO, dejando la
        // de pruebas igual de vacía y a quien lo ejecutó convencido de que ya
        // está. El nombre se saca de la conexión viva, así que el comando que
        // se imprime es siempre el correcto para esta configuración.
        $base = DB::connection()->getDatabaseName();

        $this->fail(
            'La base de pruebas no está al día: faltan '.count($pendientes)." migración(es).\n\n"
            ."    DB_DATABASE={$base} php artisan migrate --force\n\n"
            .'Pendientes: '.implode(', ', array_slice($pendientes, 0, 5))
            .(count($pendientes) > 5 ? ', …' : '')
        );
    }

    /**
     * Las migraciones que la base de pruebas todavía no tiene.
     *
     * Se compara el directorio contra la tabla `migrations` en vez de llamar a
     * `migrate:status`, que imprime en vez de devolver. Si la tabla ni existe,
     * están todas pendientes: es una base recién creada.
     *
     * @return list<string>
     */
    private function pendingMigrations(): array
    {
        $enDisco = array_map(
            static fn (string $ruta): string => basename($ruta, '.php'),
            glob(database_path('migrations/*.php')) ?: [],
        );

        if (! Schema::hasTable('migrations')) {
            return $enDisco;
        }

        $aplicadas = DB::table('migrations')->pluck('migration')->all();

        return array_values(array_diff($enDisco, $aplicadas));
    }
}
