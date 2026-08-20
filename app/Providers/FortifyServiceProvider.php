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
use Laravel\Fortify\Fortify;

class FortifyServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
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

    public function register(): void
    {
        // Ver la clase para el porqué de fijar aquí la empresa activa y no
        // en un listener del evento Login.
        $this->app->singleton(LoginResponseContract::class, LoginResponse::class);
    }
}
