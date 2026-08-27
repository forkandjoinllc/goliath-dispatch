<?php

declare(strict_types=1);

namespace App\Providers;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Services\Fmcsa\DirectoryFmcsaVerifier;
use App\Services\Fmcsa\FmcsaDirectory;
use App\Services\Fmcsa\FmcsaVerifier;
use App\Services\Fmcsa\MockFmcsaDirectory;
use App\Services\Fmcsa\MockFmcsaVerifier;
use App\Services\Fmcsa\QcMobileDirectory;
use App\Support\Database\MillisecondGrammar;
use App\Support\TenantContext;
use App\Translation\BraceTranslator;
use App\Support\Storage\DocumentStore;
use App\Support\Storage\LocalDocumentStore;
use App\Translation\JsonNamespaceLoader;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\ServiceProvider;
use Illuminate\Translation\FileLoader;
use Illuminate\Translation\Translator;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Se EXTIENDE el cargador de traducciones, no se re-liga.
        // TranslationServiceProvider es un proveedor diferido: se registra en el
        // momento en que alguien resuelve 'translation.loader', y al hacerlo
        // sobrescribiría cualquier singleton que hubiésemos atado antes. Con
        // extend() la sustitución ocurre después de que él construya el suyo.
        //
        // Se conservan sus rutas tal cual (paths() incluye la del propio
        // framework, con los mensajes de validación traducidos): reconstruirlas a
        // mano habría dejado fuera esa y roto validation.php sin previo aviso.
        $this->app->extend('translation.loader', fn (FileLoader $loader, $app) => new JsonNamespaceLoader(
            $app['files'],
            $loader->paths(),
        ));

        // Dónde viven los ficheros de los documentos. Hoy el disco del
        // servidor; el día que haya credenciales de S3, esta línea cambia de
        // clase y nada más se entera. Ver App\Support\Storage\DocumentStore.
        $this->app->singleton(DocumentStore::class, LocalDocumentStore::class);

        // Los diccionarios usan `{nombre}` porque los lee también el cliente.
        // Se sustituye el traductor para que `__()` los entienda igual — ver
        // BraceTranslator para por qué no basta con `:nombre`.
        //
        // extend() otra vez y por la misma razón que arriba: el proveedor de
        // traducción es diferido y sobrescribiría cualquier atadura previa.
        $this->app->extend('translator', function (Translator $original, $app): BraceTranslator {
            $translator = new BraceTranslator($original->getLoader(), $original->getLocale());
            $translator->setFallback($original->getFallback());

            return $translator;
        });

        // Uno por petición y por trabajo en cola. Que sea singleton es la razón
        // de que el scope global pueda leerlo sin pasárselo a cada consulta.
        $this->app->singleton(TenantContext::class);

        // Sin estado; se comparte por comodidad, no por necesidad.
        $this->app->singleton(PermissionChecker::class);

        // `scoped` y no `singleton`: cachea el Actor durante la petición, y el
        // contenedor lo tira al terminarla. Con singleton, bajo Octane la
        // siguiente petición heredaría el Actor de la anterior — el peor error
        // posible en un sistema multiempresa.
        $this->app->scoped(CurrentActor::class);

        // Sin credenciales de FMCSA se atan los adaptadores simulados, que se
        // identifican como tales en cada fila que escriben y en la pantalla. En
        // cuanto hay `FMCSA_WEBKEY` en el entorno se atan los reales, y no
        // cambia una línea de los controladores.
        //
        // La clave se lee de la configuración y no se pasa a ningún otro sitio:
        // ni al cliente, ni a un log, ni a la fila de verificación.
        $this->app->singleton(FmcsaDirectory::class, function ($app): FmcsaDirectory {
            $clave = (string) config('services.fmcsa.web_key', '');

            if (trim($clave) === '') {
                return new MockFmcsaDirectory;
            }

            return new QcMobileDirectory(
                $app->make(HttpFactory::class),
                $clave,
                (string) config('services.fmcsa.base_url', 'https://mobile.fmcsa.dot.gov/qc/services'),
            );
        });

        $this->app->bind(FmcsaVerifier::class, function ($app): FmcsaVerifier {
            $directory = $app->make(FmcsaDirectory::class);

            return $directory->isLive()
                ? new DirectoryFmcsaVerifier($directory)
                : new MockFmcsaVerifier;
        });
    }

    public function boot(): void
    {
        // Un acceso a una relación no cargada dispara N+1 en una lista de cargas
        // con veinte paradas. En local y en pruebas debe romper; en producción
        // no, porque una página rota es peor que una página lenta.
        Model::preventLazyLoading(! $this->app->isProduction());
        Model::preventSilentlyDiscardingAttributes(! $this->app->isProduction());

        $this->preserveMilliseconds();

    }

    /**
     * Que los INSERT en crudo escriban los milisegundos.
     *
     * Los modelos ya lo hacían por su `$dateFormat`; los `DB::table(...)` no,
     * porque ahí convierte la gramática de consultas y la de Laravel corta en
     * el segundo. Ver App\Support\Database\MillisecondGrammar.
     *
     * Aquí y no en cada sitio de escritura a propósito: hay treinta y nueve, y
     * el siguiente que alguien escriba también tiene que salir bien sin
     * acordarse de nada.
     */
    private function preserveMilliseconds(): void
    {
        $connection = $this->app['db']->connection();

        // Solo MySQL: la gramática hereda de la suya. Si algún día hay una
        // conexión de otro motor, esto la deja en paz en vez de romperla.
        if ($connection->getDriverName() !== 'mysql') {
            return;
        }

        $connection->setQueryGrammar(new MillisecondGrammar($connection));
    }
}
