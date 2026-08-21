<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Enums\Scope;
use Tests\Support\Scenario;
use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Casos base
|--------------------------------------------------------------------------
|
| Los tests de Feature arrancan la aplicación; los de Unit no la necesitan.
| Las pruebas de autorización viven en Unit a propósito: `can()` es una función
| pura del Actor, y si alguna vez necesitase la base de datos para responder,
| eso sería el fallo que hay que detectar.
|
*/

pest()->extend(TestCase::class)->in('Feature');

/*
| Unit/I18n es la excepción: comprueba los diccionarios, y para eso necesita
| lang_path() y el traductor, es decir la aplicación arrancada. Sigue sin tocar
| la base de datos. El resto de Unit se mantiene sin framework a propósito —
| `can()` es una función pura del Actor, y si algún día necesitase arrancar la
| aplicación para responder, eso sería precisamente el fallo que hay que ver.
*/
pest()->extend(TestCase::class)->in('Unit/I18n');

/*
|--------------------------------------------------------------------------
| Entrar como un rol
|--------------------------------------------------------------------------
|
| Se hace un POST real a /login en lugar de `actingAs()`, y no por purismo: la
| empresa activa de la sesión la fija App\Http\Responses\LoginResponse al final
| del pipeline de acceso. Con `actingAs()` habría usuario pero `active_tenant_id`
| quedaría en NULL, ResolveTenant no encontraría empresa, y todas las pruebas
| fallarían por un motivo que no tiene nada que ver con lo que prueban.
|
| Cada llamada usa una IP distinta del rango TEST-NET-1 (RFC 5737, reservado para
| documentación y nunca enrutado). Es para esquivar el limitador de accesos, que
| permite 20 por minuto y por IP: un fichero con veinticinco pruebas empezaría a
| recibir 429 a partir de la vigésima, y el fallo parecería un problema de
| autorización cuando sería el limitador haciendo su trabajo.
|
*/

function signIn(Scenario $scenario, Role $role): void
{
    static $n = 0;
    $n++;

    // Cambiar de rol dentro de una prueba exige SALIR primero. /login está
    // detrás de RedirectIfAuthenticated: con sesión abierta la petición se
    // redirige a /home sin autenticar a nadie, y assertRedirect() lo daba por
    // bueno. El segundo signIn() no cambiaba de usuario.
    if (auth()->check()) {
        auth()->logout();
        test()->flushSession();
    }

    // withServerVariables y no el tercer argumento de post(): ese son
    // CABECERAS, y REMOTE_ADDR es una variable de servidor. Puesto como
    // cabecera, el limitador seguiría viendo 127.0.0.1 en todas las pruebas.
    test()
        ->withServerVariables(['REMOTE_ADDR' => '192.0.2.'.(($n % 250) + 1)])
        ->post('/login', [
            'email' => $scenario->user($role)->email,
            'password' => 'contraseña-de-prueba-1',
        ])
        ->assertRedirect();

    // El cliente de pruebas NO reenvía la cookie de sesión entre peticiones.
    // El guard sí recuerda al usuario —vive en un singleton—, así que la
    // siguiente parece autenticada, pero StartSession genera un id NUEVO.
    // Y la empresa activa vive en la COLUMNA sessions.active_tenant_id, que
    // ResolveTenant lee POR ID: con id nuevo no hay fila, el contexto queda
    // en nulo y el Actor llega sin rol. withCookie() la cifra igual que el
    // navegador.
    test()->withCookie(config('session.cookie'), session()->getId());
}

/*
|--------------------------------------------------------------------------
| Expectativas propias
|--------------------------------------------------------------------------
*/

expect()->extend('toBeAllowed', function () {
    expect($this->value->allowed)->toBeTrue(
        'Se esperaba permitido, denegado con: '.($this->value->reasonKey ?? 'sin motivo')
    );

    return $this;
});

expect()->extend('toBeDeniedWith', function (string $reasonKey) {
    expect($this->value->allowed)->toBeFalse('Se esperaba denegado, salió permitido');
    expect($this->value->reasonKey)->toBe($reasonKey);

    return $this;
});

expect()->extend('toHaveScope', function (Scope $scope) {
    expect($this->value->scope)->toBe($scope);

    return $this;
});
