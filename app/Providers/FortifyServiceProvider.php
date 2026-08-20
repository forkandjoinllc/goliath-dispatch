<?php

declare(strict_types=1);

namespace App\Providers;

use App\Actions\Auth\AttemptLogin;
use App\Http\Responses\LoginResponse;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Laravel\Fortify\Contracts\LoginResponse as LoginResponseContract;
use Inertia\Inertia;
use Laravel\Fortify\Fortify;

class FortifyServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $this->registerViews();

        Fortify::authenticateUsing(fn (Request $request) => app(AttemptLogin::class)($request));

        // El límite es por correo+IP, no solo por IP: si fuese solo por IP, una
        // oficina entera detrás de un NAT se bloquearía entre sí, y un atacante
        // con muchas IPs no se bloquearía nunca.
        RateLimiter::for('login', function (Request $request) {
            $key = Str::transliterate(
                mb_strtolower((string) $request->input('email')).'|'.$request->ip()
            );

            return [
                Limit::perMinute(5)->by($key),
                Limit::perMinute(20)->by($request->ip()),
            ];
        });

        RateLimiter::for('two-factor', fn (Request $request) => Limit::perMinute(5)
            ->by($request->session()->get('login.id')));

    }

    /**
     * Las pantallas de acceso, servidas por Inertia.
     *
     * Sin esto, `views => true` en config/fortify.php hace que Fortify intente
     * resolver LoginViewResponse por el contenedor y falle con
     * BindingResolutionException — un 500 en /login y en /forgot-password. Que
     * es exactamente lo que pasó en producción: la ruta existía y la página no.
     *
     * Los espacios del diccionario se declaran aquí y no en un controlador
     * porque estas rutas las registra Fortify y no pasan por uno nuestro.
     */
    private function registerViews(): void
    {
        $withDictionary = static function (array $namespaces): void {
            request()->attributes->set('dictionaryNamespaces', $namespaces);
        };

        Fortify::loginView(function () use ($withDictionary) {
            $withDictionary(['auth', 'validation']);

            return Inertia::render('Auth/Login', [
                'status' => session('status'),
            ]);
        });

        Fortify::requestPasswordResetLinkView(function () use ($withDictionary) {
            $withDictionary(['auth', 'validation']);

            return Inertia::render('Auth/ForgotPassword', [
                'status' => session('status'),
            ]);
        });

        Fortify::resetPasswordView(function (Request $request) use ($withDictionary) {
            $withDictionary(['auth', 'validation']);

            return Inertia::render('Auth/ResetPassword', [
                'token' => $request->route('token'),
                'email' => $request->string('email')->toString(),
            ]);
        });

        Fortify::verifyEmailView(function (Request $request) use ($withDictionary) {
            $withDictionary(['auth', 'validation']);

            return Inertia::render('Auth/VerifyEmail', [
                'status' => session('status'),
                'email' => $request->user()?->email,
            ]);
        });
    }

    public function register(): void
    {
        // Ver la clase para el porqué de fijar aquí la empresa activa y no
        // en un listener del evento Login.
        $this->app->singleton(LoginResponseContract::class, LoginResponse::class);
    }
}
