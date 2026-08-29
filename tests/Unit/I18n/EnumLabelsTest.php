<?php

declare(strict_types=1);

use App\Enums\AuditAction;
use App\Enums\Role;

/**
 * Los valores de enum que la interfaz traduce por concatenación.
 *
 * La pantalla no escribe la clave entera: la compone, `t("audit.action.{$e})`.
 * Eso rompe la única salvaguarda que tenía el diccionario —buscar la cadena
 * literal en el TSX— porque la clave no existe en ninguna parte del código
 * hasta que se ejecuta. Un caso de enum sin traducir no da error: pinta la
 * clave en crudo en medio de la tabla.
 *
 * Ya pasó, y por partida doble. `AuditAction` lleva el punto DENTRO del valor
 * (`financial.changed`), y el buscador del diccionario parte las claves por
 * puntos para bajar por el árbol: con `{"financial.changed": "..."}` en plano,
 * buscaba una rama `financial` que no existía y devolvía la clave. Se ve en
 * cuanto se abre la pantalla y no lo veía ninguna de las 714 pruebas.
 */

/** @return array<string, mixed> */
function dictionaryFile(string $locale, string $namespace): array
{
    $ruta = dirname(__DIR__, 3)."/lang/{$locale}/{$namespace}.json";

    expect(is_file($ruta))->toBeTrue("Falta el diccionario {$locale}/{$namespace}.json");

    return json_decode((string) file_get_contents($ruta), true, flags: JSON_THROW_ON_ERROR);
}

/**
 * Baja por el árbol partiendo la clave por puntos, igual que `lookup()` en
 * resources/js/lib/i18n.tsx. Se replica aquí a propósito: si la prueba buscara
 * la clave de otra manera, pasaría en verde con diccionarios que el cliente no
 * sabe leer, que es exactamente el fallo que existe para atrapar.
 */
function lookupLikeClient(array $diccionario, string $clave): mixed
{
    $nodo = $diccionario;

    foreach (explode('.', $clave) as $parte) {
        if (! is_array($nodo) || ! array_key_exists($parte, $nodo)) {
            return null;
        }

        $nodo = $nodo[$parte];
    }

    return $nodo;
}

it('traduce las 57 acciones de auditoría en los dos idiomas', function () {
    foreach (['en', 'es'] as $locale) {
        $diccionario = dictionaryFile($locale, 'audit');
        $faltan = [];

        foreach (AuditAction::cases() as $accion) {
            $etiqueta = lookupLikeClient($diccionario, 'action.'.$accion->value);

            if (! is_string($etiqueta) || trim($etiqueta) === '') {
                $faltan[] = $accion->value;
            }
        }

        expect($faltan)->toBe([], "Acciones sin etiqueta en {$locale}: ".implode(', ', $faltan));
    }
});

it('traduce los roles en los dos idiomas', function () {
    // La pista de auditoría pinta el rol con `users.roles.{rol}`, compuesto
    // igual que la acción y con el mismo riesgo.
    foreach (['en', 'es'] as $locale) {
        $diccionario = dictionaryFile($locale, 'users');
        $faltan = [];

        foreach (Role::cases() as $rol) {
            $etiqueta = lookupLikeClient($diccionario, 'roles.'.$rol->value);

            if (! is_string($etiqueta) || trim($etiqueta) === '') {
                $faltan[] = $rol->value;
            }
        }

        expect($faltan)->toBe([], "Roles sin etiqueta en {$locale}: ".implode(', ', $faltan));
    }
});

it('traduce todos los tipos de registro que la aplicación llega a escribir', function () {
    $raiz = dirname(__DIR__, 3);
    $tipos = [];

    foreach (glob($raiz.'/app/**/*.php') ?: [] as $_) {
        // El glob de dos niveles no basta; se recorre entero más abajo.
    }

    $iterador = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($raiz.'/app'));

    foreach ($iterador as $fichero) {
        if ($fichero->getExtension() !== 'php') {
            continue;
        }

        preg_match_all("/entityType:\s*'([a-z_]+)'/", (string) file_get_contents($fichero->getPathname()), $m);
        $tipos = [...$tipos, ...$m[1]];
    }

    $tipos = array_values(array_unique($tipos));

    expect(count($tipos))->toBeGreaterThan(10);

    foreach (['en', 'es'] as $locale) {
        $diccionario = dictionaryFile($locale, 'audit');
        $faltan = [];

        foreach ($tipos as $tipo) {
            $etiqueta = lookupLikeClient($diccionario, 'entity.'.$tipo);

            if (! is_string($etiqueta) || trim($etiqueta) === '') {
                $faltan[] = $tipo;
            }
        }

        expect($faltan)->toBe([], "Tipos de registro sin etiqueta en {$locale}: ".implode(', ', $faltan));
    }
});
