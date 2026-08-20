<?php

declare(strict_types=1);

use App\Enums\Scope;
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
