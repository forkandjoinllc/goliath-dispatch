<?php

declare(strict_types=1);

use App\Authorization\Enforcement;
use App\Authorization\Permissions;
use Tests\Support\Source;

/**
 * Un permiso que nadie comprueba es una frontera que no existe.
 *
 * ## El defecto
 *
 * Doce claves de `Permissions::ALL` estaban repartidas en `RoleMatrix` y ningún
 * código las consultaba. `RoleMatrix` es lo que lee un administrador para
 * decidir a quién le da qué rol: si dice que solo el admin borra documentos y
 * el código pregunta otra cosa, la matriz miente sobre lo único que sirve para.
 *
 * El peor caso: `document:delete` es del admin en la matriz, y la acción que
 * quita un documento del expediente autorizaba contra `load:document:upload` —
 * admin, despachador, transportista **y conductor**. Cuatro roles de más.
 *
 * ## Qué sujeta este fichero
 *
 * Que ninguna clave NUEVA pueda aparecer sin gobernar nada y sin que nadie lo
 * note. O se consulta en el código, o está en `Enforcement::SIN_APLICAR` con su
 * motivo escrito — que es una decisión que alguien toma, no un descuido que se
 * hereda.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código.
 */
function raizPermisos(): string
{
    return Source::root();
}

/**
 * Las claves de permiso que el código consulta de verdad.
 *
 * Se leen del fuente SIN COMENTARIOS: este proyecto está lleno de comentarios
 * que nombran permisos para explicar por qué NO se usan, y contarlos como uso
 * dejaría pasar exactamente el defecto que esto vigila.
 *
 * Se excluyen los tres ficheros que DECLARAN el vocabulario —el catálogo, la
 * matriz y las descripciones en español— porque ahí aparecer no es usarse.
 *
 * @return list<string>
 */
function permisosConsultados(): array
{
    $raiz = raizPermisos();

    $declaran = [
        $raiz.'/app/Authorization/Permissions.php',
        $raiz.'/app/Authorization/RoleMatrix.php',
        $raiz.'/app/Authorization/PermissionDescriptionsEs.php',
        $raiz.'/app/Authorization/Enforcement.php',
    ];

    $usados = [];

    $iterador = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($raiz.'/app', FilesystemIterator::SKIP_DOTS)
    );

    foreach ($iterador as $fichero) {
        if ($fichero->getExtension() !== 'php' || in_array($fichero->getPathname(), $declaran, true)) {
            continue;
        }

        $codigo = Source::sinComentarios($fichero->getPathname());

        foreach (Permissions::keys() as $clave) {
            if (str_contains($codigo, "'".$clave."'")) {
                $usados[$clave] = true;
            }
        }
    }

    // `routes/` también autoriza en algunos sitios.
    foreach (glob($raiz.'/routes/*.php') ?: [] as $ruta) {
        $codigo = Source::sinComentarios($ruta);

        foreach (Permissions::keys() as $clave) {
            if (str_contains($codigo, "'".$clave."'")) {
                $usados[$clave] = true;
            }
        }
    }

    return array_keys($usados);
}

/* ── Todo permiso gobierna algo, o consta que no ─────────────────────────── */

it('ningún permiso queda sin comprobar y sin explicación', function (): void {
    $huerfanos = array_values(array_diff(
        Permissions::keys(),
        permisosConsultados(),
        Enforcement::sinAplicar(),
    ));

    expect($huerfanos)->toBe([], 'Estos permisos están en la matriz y no los comprueba nadie. '
        .'O se conectan a la acción que nombran, o se anotan en Enforcement::SIN_APLICAR con el motivo: '
        .implode(', ', $huerfanos));
});

it('la lista de excusas no guarda permisos que sí se comprueban', function (): void {
    // Una excusa que dejó de ser cierta es peor que no tenerla: dice que algo
    // no se vigila cuando sí, y la próxima persona la creerá.
    $sobran = array_values(array_intersect(Enforcement::sinAplicar(), permisosConsultados()));

    expect($sobran)->toBe([], 'Estos ya se comprueban y siguen en SIN_APLICAR: '.implode(', ', $sobran));
});

it('la lista de excusas no nombra permisos que no existen', function (): void {
    $inventados = array_values(array_diff(Enforcement::sinAplicar(), Permissions::keys()));

    expect($inventados)->toBe([], 'SIN_APLICAR nombra claves que no están en el catálogo: '.implode(', ', $inventados));
});

it('cada excusa lleva un motivo escrito, no un hueco', function (): void {
    foreach (Enforcement::SIN_APLICAR as $clave => $motivo) {
        // Diez caracteres no es una vara alta: es la que distingue un motivo de
        // un «TODO» o una cadena vacía puesta para que la prueba pase.
        expect(mb_strlen(trim($motivo)))->toBeGreaterThan(20, "el motivo de {$clave} no dice nada");
    }
});

/* ── Los dos que sí gobernaban algo ──────────────────────────────────────── */

it('quitar un documento del expediente pide document:delete', function (): void {
    // Y no `load:document:upload`, que es lo que pedía: cuatro roles más ancho
    // que lo que dibuja la matriz.
    $codigo = Source::sinComentarios(raizPermisos().'/app/Http/Controllers/App/LoadDocumentController.php');

    $inicio = strpos($codigo, 'public function destroy(');
    expect($inicio)->toBeInt();

    $siguiente = strpos($codigo, "\n    private function ", $inicio);
    $cuerpo = substr($codigo, $inicio, ($siguiente === false ? strlen($codigo) : $siguiente) - $inicio);

    expect($cuerpo)->toContain("authorize(\$actor, 'document:delete'")
        ->and($cuerpo)->not->toContain("authorize(\$actor, 'load:document:upload'");
});

it('el botón de quitar no se le ofrece a quien no puede', function (): void {
    // No sustituye a la comprobación del servidor, que es la que manda. Deja de
    // ofrecer algo que va a ser rechazado.
    $controlador = Source::sinComentarios(raizPermisos().'/app/Http/Controllers/App/LoadDocumentController.php');
    $pantalla = file_get_contents(raizPermisos().'/resources/js/pages/App/Loads/Documents.tsx');

    expect($controlador)->toContain("'detach' => \$checker->can(\$actor, 'document:delete', null, \$policy)->allowed,")
        ->and($pantalla)->toContain('can.detach ? (');
});

it('guardar preferencias de aviso pide su permiso', function (): void {
    $codigo = Source::sinComentarios(raizPermisos().'/app/Http/Controllers/App/NotificationController.php');

    expect($codigo)->toContain("authorize(\$actor, 'notification:preference:update'");
});

/* ── Y la matriz sigue siendo la única declaración ───────────────────────── */

it('la matriz no reparte claves que el catálogo no tiene', function (): void {
    // Si la matriz nombrara una clave inexistente, PermissionChecker la
    // rechazaría en tiempo de ejecución — pero solo el día que alguien con ese
    // rol tocara esa acción.
    $matriz = Source::sinComentarios(raizPermisos().'/app/Authorization/RoleMatrix.php');

    preg_match_all("/'([a-z]+:[a-z:_]+)' => Scope::/", $matriz, $coincidencias);

    $desconocidas = array_values(array_unique(array_diff($coincidencias[1], Permissions::keys())));

    expect($desconocidas)->toBe([], 'la matriz reparte claves que no están en el catálogo: '.implode(', ', $desconocidas));
});
