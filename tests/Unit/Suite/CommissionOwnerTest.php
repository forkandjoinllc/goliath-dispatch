<?php

declare(strict_types=1);

use App\Support\Finance\CommissionOwner;
use Tests\Support\Source;

use function PHPUnit\Framework\assertArrayHasKey;

/**
 * La comisión que se resta del margen tiene dueño, o se dice que no lo tiene.
 *
 * ## El defecto
 *
 * `loads.dispatcher_user_id` se escribía en UN sitio y una sola vez:
 *
 * ```php
 * $load->dispatcher_user_id = $actor->role === Role::Dispatcher ? $actor->userId : null;
 * ```
 *
 * Ninguna otra escritura en toda la aplicación. Y la matriz de roles remata la
 * trampa: el ADMINISTRADOR crea cargas y no es despachador —así que lo suyo
 * nacía sin dueño—, el despachador sí lo sería pero no puede tocar el dinero, y
 * contabilidad puede tocar el dinero pero no crear cargas.
 *
 * Con la columna vacía: `Calculator` calculaba la comisión igual y la congelaba
 * en la instantánea, `netAfterCommission` la restaba del margen, y
 * `CommissionLedger::accrue()` devolvía sin escribir nada. Dinero descontado que
 * no se le debía a nadie, ninguna fila que pagar, la pantalla de Comisiones
 * vacía y ni un mensaje.
 *
 * ## Lo que vigila este fichero
 *
 * Que la pregunta «quién la gana» se conteste en un sitio, que el motivo de no
 * tener dueño esté declarado, que el silencio se haya acabado —el hecho se
 * anota— y que la lista que se OFRECE al elegir dueño sea la misma que se
 * VALIDA al guardar.
 *
 * Lo que MIDE el dinero es `tests/Feature/Finance/CommissionOwnerTest.php`.
 */
function raizComision(): string
{
    return Source::root();
}

it('el motivo de no tener dueño está declarado con su texto', function (): void {
    // Un hueco sin nombre se lee como descuido, y entonces nadie lo mira. Este
    // llevaba desde el principio siendo un `return null` sin frase.
    assertArrayHasKey('notSetAtCreation', CommissionOwner::SIN_DUENO);

    foreach (CommissionOwner::SIN_DUENO as $motivo => $texto) {
        expect(strlen($texto))->toBeGreaterThan(80, "el motivo «{$motivo}» no explica nada");
    }
});

it('distingue no tener dueño de no haber comisión', function (): void {
    $sinDueno = (object) ['dispatcher_user_id' => null];
    $conDueno = (object) ['dispatcher_user_id' => str_repeat('a', 36)];

    expect(CommissionOwner::deCarga($sinDueno))->toBeNull();
    expect(CommissionOwner::deCarga($conDueno))->toBe(str_repeat('a', 36));

    // Las dos cosas que se confundían en un solo `if`: sin dueño Y con dinero
    // es el problema; sin dueño y sin dinero no hay nada que repartir, y con
    // dueño y sin dinero tampoco.
    expect(CommissionOwner::comisionHuerfana($sinDueno, 12500))->toBeTrue();
    expect(CommissionOwner::comisionHuerfana($sinDueno, 0))->toBeFalse();
    expect(CommissionOwner::comisionHuerfana($conDueno, 12500))->toBeFalse();

    // La cadena vacía no es un dueño. `dispatcher_user_id` es char(36) y un
    // formulario que manda '' escribiría eso en vez de NULL.
    expect(CommissionOwner::deCarga((object) ['dispatcher_user_id' => '']))->toBeNull();
});

it('el devengo pregunta al registro y ya no calla', function (): void {
    $fuente = Source::compacta(raizComision().'/app/Support/Finance/CommissionLedger.php');

    // La columna ya no se lee a pelo: si se leyera, la pantalla y el devengo
    // podrían contestar cosas distintas sobre la misma carga.
    expect($fuente)->toContain('CommissionOwner::deCarga($load)');
    expect($fuente)->not->toContain('$dispatcherId=$load->dispatcher_user_id');

    // Y el caso caro deja rastro. Sin esto, «el informe dice que ganamos menos
    // y no hay comisión que pagar» no tiene respuesta seis meses después.
    expect($fuente)->toContain('CommissionOwner::comisionHuerfana($load,$financials->dispatcherCommission)');
    expect($fuente)->toContain("'accrued'=>false");
});

it('el dueño se puede asignar, y solo con permiso de dinero', function (): void {
    $fuente = Source::compacta(raizComision().'/app/Http/Controllers/App/LoadController.php');

    // La columna dejó de tener un solo escritor. Es una ASIGNACIÓN, no una
    // pareja clave⇒valor: escribí la aguja con `=>` y la prueba me lo dijo
    // enseñándome el fichero entero.
    expect($fuente)->toContain("\$columns['dispatcher_user_id']=\$data['dispatcher_user_id'];");

    // Dentro del bloque del dinero: quien no puede fijar los porcentajes
    // tampoco decide a quién se le paga.
    expect(preg_match('/if\(\$canMoney\)\{.*?\$columns\[.dispatcher_user_id.\]/s', $fuente))
        ->toBe(1, 'el dueño de la comisión se escribe fuera del bloque de dinero');

    // Y el que crea siendo despachador sigue quedándose la suya sin decirlo.
    expect($fuente)->toContain('$actor->role===Role::Dispatcher?$actor->userId:null');
});

it('lo que se ofrece al elegir dueño es lo que se valida al guardar', function (): void {
    $fuente = Source::compacta(raizComision().'/app/Http/Controllers/App/LoadController.php');

    // Las dos, de la misma fuente. Dos consultas parecidas en dos sitios es
    // como se acaba ofreciendo a alguien que luego el guardado rechaza.
    expect(substr_count($fuente, 'CommissionOwner::candidatos('))->toBe(2);

    // Un despachador de otra empresa, o uno suspendido, no vale: `size:36` los
    // deja pasar y los dos crean una comisión que nadie reclama.
    expect($fuente)->toContain("'dispatcher_user_id'=>['nullable','string','size:36']");
    expect($fuente)->toContain("__('loads.errors.notADispatcher')");
});

it('los candidatos son despachadores activos de esta empresa', function (): void {
    $fuente = Source::compacta(raizComision().'/app/Support/Finance/CommissionOwner.php');

    expect($fuente)->toContain("->where('tenant_id',\$tenantId)");
    expect($fuente)->toContain("->where('role',Role::Dispatcher->value)");
    expect($fuente)->toContain("->where('status','active')");
});

it('la pantalla del dinero dice cuándo no hay a quién pagarle', function (): void {
    $controlador = Source::compacta(raizComision().'/app/Http/Controllers/App/LoadController.php');
    $pantalla = (string) file_get_contents(raizComision().'/resources/js/pages/App/Loads/Show.tsx');

    expect($controlador)->toContain("'commissionOrphaned'=>CommissionOwner::comisionHuerfana(");
    // La condición ENTERA, no la palabra suelta: con `toContain('f.commissionOrphaned')`
    // un sabotaje que lo dejaba en `{false && f.commissionOrphaned ? (` seguía
    // verde, porque la palabra seguía ahí.
    expect($pantalla)->toContain('{f.commissionOrphaned ? (');
    expect($pantalla)->toContain('loads.money.commissionNoOwner');

    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(raizComision()."/lang/{$idioma}/loads.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        expect($d['money']['commissionNoOwner'] ?? null)->toBeString("falta el aviso en {$idioma}");
        expect($d['form']['commissionOwner'] ?? null)->toBeString();
        expect($d['form']['commissionOwnerNone'] ?? null)->toBeString();
        expect($d['errors']['notADispatcher'] ?? null)->toBeString();
    }
});
