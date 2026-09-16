<?php

declare(strict_types=1);

use Tests\Support\Source;

use function PHPUnit\Framework\assertArrayHasKey;
use function PHPUnit\Framework\assertSame;
use function PHPUnit\Framework\assertStringContainsString;

/**
 * Nadie vuelve a meter `Scope::Assigned` en el mismo cajón que `Scope::Tenant`.
 *
 * ## El defecto
 *
 * Dos pantallas se estrechaban a mano, y las dos escribían lo mismo:
 *
 * ```php
 * return match ($scope) {
 *     Scope::Platform, Scope::Tenant, Scope::Assigned => $consulta,
 *     …
 * };
 * ```
 *
 * `Assigned` es el ámbito del DESPACHADOR. Esa línea le devolvía la empresa
 * entera:
 *
 *  - En el tablero de altas veía el nombre legal, el número DOT, el estado del
 *    alta, qué papeles le faltan y cuándo se revisó su FMCSA de transportistas
 *    que no son suyos. Y el tablero le ofrecía un botón de movimiento sobre
 *    ellos que la ruta de transición —que sí estrecha— contestaba con 404.
 *  - En firmas veía todas las solicitudes de la empresa, con el correo del
 *    firmante, y podía ABRIRLAS. El mismo estrechamiento decide `show()`, el
 *    certificado y la anulación.
 *  - Y el desplegable de «mandar a firmar» le ofrecía esos transportistas, que
 *    ya no es ver de más: es poder mandarle un acuerdo a otro.
 *
 * ## Por qué no se aplicó la regla que existía
 *
 * `Authorization\ScopeFilter` lleva desde siempre traduciendo `Assigned` a
 * `assignments->carrierIds`, y catorce sitios la usan. Pero pedía un `Builder`
 * de Eloquent —saca el nombre de la tabla del modelo— y estas dos pantallas
 * usan `DB::table()` con alias y join. Ante una pieza que no encajaba se
 * escribió el `match` a mano, y se escribió mal.
 *
 * La lección, que se repite: cuando una pieza no encaja, lo que sale no es
 * «otra forma de hacerlo» — es una copia peor. Encajar la pieza es más barato.
 */
function raizAmbitos(): string
{
    return Source::root();
}

/**
 * Controladores que estrechan por ámbito SIN la pieza, y por qué.
 *
 * Mismo patrón que `Enforcement::SIN_APLICAR`: la excepción está contada y con
 * motivo, y el guardián falla si aparece una nueva sin declarar o si una
 * declarada ya no hace falta.
 *
 * @var array<string, string>
 */
const ESTRECHAN_A_MANO = [
    'PaymentController' => '`payments` no lleva `carrier_id`: al transportista se llega por la factura, con un EXISTS que ScopeFilter no sabe expresar. Y no es la fuga de este lote: comprueba `$scope->atLeast(Scope::Tenant)`, que para Assigned es FALSO —rango 3 contra 4—, así que un ámbito estrecho sin `carrierId` no devuelve nada en vez de devolverlo todo.',
];

/** Las piezas que sí saben contestar por los cinco ámbitos. */
const PIEZAS_DE_AMBITO = ['scopeFilter(', 'LoadScope::apply', 'DocumentScope::', 'MessageScope::'];

it('ningún `match` mete Assigned en el cajón de Tenant', function (): void {
    // ESTE ES EL FALLO, en su forma exacta y buscable.
    $culpables = [];

    $ficheros = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(raizAmbitos().'/app', FilesystemIterator::SKIP_DOTS),
    );

    foreach ($ficheros as $fichero) {
        if ($fichero->getExtension() !== 'php') {
            continue;
        }

        $fuente = Source::compacta($fichero->getPathname());

        // Las etiquetas de cada brazo de `match`: `Scope::A,Scope::B=>`.
        preg_match_all('/((?:Scope::\w+,)+Scope::\w+)=>/', $fuente, $brazos);

        foreach ($brazos[1] as $brazo) {
            $ambitos = explode(',', $brazo);

            if (in_array('Scope::Tenant', $ambitos, true) && in_array('Scope::Assigned', $ambitos, true)) {
                $culpables[] = basename($fichero->getPathname()).': '.$brazo;
            }
        }
    }

    assertSame([], $culpables, implode("\n", [
        'Hay brazos de `match` que tratan al despachador como si viera la empresa entera:',
        ...$culpables,
    ]));
});

it('todo `scoped()` que recibe un ámbito usa una pieza, o está declarado', function (): void {
    // La comprobación de la pantalla número diecisiete. Que la fuga de hoy esté
    // tapada no impide que mañana alguien escriba otro `scoped()` a mano; esto
    // le pide que use la pieza o explique por qué no puede.
    $sinPieza = [];

    foreach (glob(raizAmbitos().'/app/Http/Controllers/App/*Controller.php') ?: [] as $fichero) {
        $fuente = Source::compacta($fichero);
        $nombre = basename($fichero, '.php');

        // Solo los que reciben el ámbito: un `scoped(Actor $actor)` a secas no
        // estrecha por ámbito y no le toca esta regla.
        if (! str_contains($fuente, 'privatefunctionscoped(') || ! preg_match('/privatefunctionscoped\([^)]*Scope\$scope/', $fuente)) {
            continue;
        }

        $usaPieza = false;

        foreach (PIEZAS_DE_AMBITO as $pieza) {
            if (str_contains($fuente, str_replace(' ', '', $pieza))) {
                $usaPieza = true;
            }
        }

        if (! $usaPieza && ! array_key_exists($nombre, ESTRECHAN_A_MANO)) {
            $sinPieza[] = $nombre;
        }
    }

    assertSame([], $sinPieza, implode("\n", [
        'Estos controladores estrechan por ámbito sin la pieza y sin declararlo:',
        ...$sinPieza,
    ]));
});

it('lo declarado a mano sigue haciendo falta', function (): void {
    // La otra dirección: una excepción que ya no lo es deja de explicar nada y
    // se convierte en permiso para copiarla.
    foreach (ESTRECHAN_A_MANO as $nombre => $motivo) {
        $fuente = Source::compacta(raizAmbitos()."/app/Http/Controllers/App/{$nombre}.php");

        $usaPieza = false;

        foreach (PIEZAS_DE_AMBITO as $pieza) {
            if (str_contains($fuente, str_replace(' ', '', $pieza))) {
                $usaPieza = true;
            }
        }

        expect($usaPieza)->toBeFalse("«{$nombre}» ya usa la pieza: sobra de la lista.");
        expect(strlen($motivo))->toBeGreaterThan(80, "«{$nombre}» no explica por qué no puede usarla.");
    }
});

it('las dos pantallas de la fuga usan la pieza con su columna', function (): void {
    $altas = Source::compacta(raizAmbitos().'/app/Http/Controllers/App/OnboardingController.php');
    $firmas = Source::compacta(raizAmbitos().'/app/Http/Controllers/App/SignatureController.php');

    // En `carriers` el transportista del ámbito es la fila misma; en
    // `signature_requests` es su columna. Equivocarse de columna no da error:
    // da una consulta que no casa con nada, o que casa con todo.
    assertStringContainsString("applyToQuery(\$consulta,'c',['carrier'=>'id'])", $altas);
    assertStringContainsString("applyToQuery(\$consulta,'r',['carrier'=>'carrier_id'])", $firmas);

    // Y el desplegable de «mandar a firmar» con la MISMA pieza que las filas.
    assertStringContainsString("applyToQuery(\$consulta,'carriers',['carrier'=>'id'])", $firmas);
});

it('quien usa la consulta sin modelo pone el `tenant_id` a mano', function (): void {
    // `applyToQuery()` NO filtra por empresa: sin modelo no puede comprobar que
    // la columna exista, y adivinarlo sería peor. Lo pone quien llama, y esto
    // lo exige — porque olvidarlo sería una fuga entre empresas, que es varios
    // órdenes peor que la que este lote arregla.
    $pieza = Source::compacta(raizAmbitos().'/app/Authorization/ScopeFilter.php');

    assertStringContainsString('publicfunctionapplyToQuery(', $pieza);

    foreach (['OnboardingController', 'SignatureController'] as $nombre) {
        $fuente = Source::compacta(raizAmbitos()."/app/Http/Controllers/App/{$nombre}.php");

        preg_match_all('/\$consulta=DB::table\(\'([a-z_ ]+(?:as[a-z]+)?)\'\)->where\(\'([a-z.]*tenant_id)\'/', $fuente, $m);

        expect($m[2])->not->toBe([], "«{$nombre}» construye la consulta sin filtrar por empresa.");
    }
});

it('las dos formas de estrechar comparten el cuerpo', function (): void {
    // Dos piezas que contestan la misma pregunta acaban contestando distinto.
    // `apply()` y `applyToQuery()` delegan las dos en `narrow()`, y el `match`
    // vive UNA vez.
    $pieza = Source::compacta(raizAmbitos().'/app/Authorization/ScopeFilter.php');

    assertSame(1, substr_count($pieza, 'match($this->scope){'), 'el `match` de ámbitos está escrito dos veces');
    assertSame(2, substr_count($pieza, '$this->narrow('), 'alguna de las dos entradas dejó de delegar');
    assertStringContainsString('privatefunctionnarrow(', $pieza);
});

it('la matriz sigue dando Assigned al despachador', function (): void {
    // Si mañana el despachador pasara a Tenant en estos permisos, esta prueba
    // deja de describir nada y conviene enterarse en vez de que se quede en
    // verde sin medir.
    $matriz = Source::compacta(raizAmbitos().'/app/Authorization/RoleMatrix.php');

    foreach (['carrier:onboarding:read', 'signature:request:read', 'signature:request:create'] as $permiso) {
        assertStringContainsString("'{$permiso}'=>Scope::Assigned", $matriz);
    }

    assertArrayHasKey('PaymentController', ESTRECHAN_A_MANO);
});
