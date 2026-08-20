<?php

declare(strict_types=1);

namespace App\Providers;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Support\TenantContext;
use App\Translation\JsonNamespaceLoader;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\ServiceProvider;
use Illuminate\Translation\FileLoader;

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
    }

    public function boot(): void
    {
        // Un acceso a una relación no cargada dispara N+1 en una lista de cargas
        // con veinte paradas. En local y en pruebas debe romper; en producción
        // no, porque una página rota es peor que una página lenta.
        Model::preventLazyLoading(! $this->app->isProduction());
        Model::preventSilentlyDiscardingAttributes(! $this->app->isProduction());

    }
}
