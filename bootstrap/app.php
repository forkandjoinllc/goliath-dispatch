<?php

use App\Exceptions\AuthorizationException;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\EnsureTenantActive;
use App\Http\Middleware\ResolveTenant;
use App\Http\Middleware\SetLocale;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;
use Illuminate\Http\Request;
use Inertia\Inertia;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // El orden importa. SetLocale primero: cualquier cosa que venga después
        // puede querer traducir. ResolveTenant después, porque lee
        // sessions.active_tenant_id y necesita la sesión ya arrancada. Inertia al
        // final, porque su share() manda al cliente el idioma y la empresa ya
        // resueltos por los dos anteriores.
        $middleware->web(append: [
            SetLocale::class,
            ResolveTenant::class,
            // DESPUÉS de Inertia, no antes. Necesita saber en qué empresa se
            // está —de ahí que vaya tras ResolveTenant— pero la página de
            // suspensión es una página de Inertia como cualquier otra y necesita
            // el armazón compartido. Puesto antes, se renderizaba sin `shell` y
            // el layout reventaba en el navegador con «cannot read properties
            // of undefined (reading 'nav')»: un 403 con la pantalla en blanco.
            HandleInertiaRequests::class,
            EnsureTenantActive::class,
            AddLinkHeadersForPreloadedAssets::class,
        ]);

        /*
         * El webhook del proveedor de cobro no lleva token CSRF, y no puede: lo
         * manda un servidor de fuera, no un navegador con sesión. Su defensa no
         * es el token sino la FIRMA del cuerpo, que se comprueba antes de mirar
         * nada más — ver BillingWebhookController.
         *
         * Es la única exclusión de la aplicación y conviene que siga siéndolo.
         */
        $middleware->validateCsrfTokens(except: [
            'billing/webhook',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        // Sin esto, una denegación de permiso salía como 500.
        //
        // Es una diferencia que importa: un 500 dice «el servidor está roto» y
        // hace que alguien vaya a mirar los registros; un 403 dice «funcionó y
        // te dijo que no». Y en producción el 500 habría enseñado una pantalla
        // de error genérica en vez del motivo, que está traducido.
        $exceptions->render(function (AuthorizationException $e, Request $request) {
            if ($request->expectsJson()) {
                return response()->json(['message' => __($e->reasonKey)], $e->status);
            }

            // Una acción denegada (POST, PATCH, DELETE) vuelve atrás con el
            // motivo: el usuario venía de una página a la que sí puede volver, y
            // perder el contexto por un botón que no debía estar ahí sería un
            // castigo desproporcionado.
            if (! $request->isMethod('GET')) {
                return back()->with('error', __($e->reasonKey));
            }

            // Una PÁGINA denegada sí necesita pantalla propia. Aquí `back()` no
            // sirve: quien llega por un enlace directo o un marcador no tiene
            // «atrás», y rebotaría a la raíz sin saber por qué.
            return Inertia::render('App/Denied', [
                'reason' => __($e->reasonKey),
                'permission' => $e->permission,
            ])->toResponse($request)->setStatusCode($e->status);
        });
    })->create();
