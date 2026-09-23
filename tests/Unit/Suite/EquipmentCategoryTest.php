<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * Un tipo de equipo se ofrece diciendo de qué clase es.
 *
 * ## El defecto
 *
 * `equipment_types` tiene una columna `category` —`truck` o `trailer`— desde el
 * primer día, y nadie la miraba. El alta de un tractor ofrecía «Lowboy» y
 * «Plataforma escalonada», que son remolques; el alta de una carga ofrecía
 * «Tractocamión con dormitorio» como equipo REQUERIDO, que no es un requisito
 * que ningún remolque pueda cumplir.
 *
 * Elegirlo no daba ningún error: guardaba una ficha que después no cuadra con
 * nada. Y la pantalla de sobredimensión mira el tipo del REMOLQUE, así que un
 * tractor con tipo de remolque entra en un cálculo al que no pertenece.
 *
 * ## El registro
 *
 * Mismo patrón que el resto de los guardianes de esta carpeta: cada sitio que
 * lee `equipment_types` está declarado con la categoría que ofrece, y la
 * comprobación va en las DOS direcciones —una consulta nueva sin declarar
 * falla, y una declarada que ya no existe también—. Así, el día que alguien
 * añada una tercera pantalla que ofrezca tipos, el guardián le pregunta cuál.
 *
 * @var array<string, string>
 */
const OFRECEN_TIPOS_DE_EQUIPO = [
    // El alta de una unidad: los de SU clase, y la clase la dice la ruta.
    'app/Http/Controllers/App/EquipmentController.php' => "\$type === 'trucks' ? 'truck' : 'trailer'",

    // El alta de una carga: el equipo requerido es el REMOLQUE que hace falta.
    // Todas las cargas necesitan un tractor, así que pedir uno como requisito
    // no dice nada.
    'app/Http/Controllers/App/LoadController.php' => "'trailer'",
];

/** Los ficheros de `app/` que consultan la tabla. */
function consultanTiposDeEquipo(): array
{
    $raiz = Source::root().'/app';
    $encontrados = [];

    $ficheros = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($raiz));

    foreach ($ficheros as $fichero) {
        if (! $fichero->isFile() || $fichero->getExtension() !== 'php') {
            continue;
        }

        $ruta = (string) $fichero->getPathname();
        $codigo = Source::sinComentarios($ruta);

        // El modelo declara la tabla; no ofrece nada que elegir.
        if (str_contains($codigo, "DB::table('equipment_types')")) {
            $encontrados[substr($ruta, strlen(Source::root()) + 1)] = $codigo;
        }
    }

    return $encontrados;
}

it('toda consulta de tipos de equipo dice de qué clase los quiere', function (): void {
    foreach (consultanTiposDeEquipo() as $ruta => $codigo) {
        // `expect()->toHaveKey()` toma el segundo argumento como el VALOR
        // esperado, no como el mensaje. Ver `docs/testing.md`.
        test()->assertArrayHasKey(
            $ruta,
            OFRECEN_TIPOS_DE_EQUIPO,
            "`{$ruta}` consulta `equipment_types` y no está declarado: di qué categoría ofrece.",
        );

        test()->assertStringContainsString(
            "->where('category', ".OFRECEN_TIPOS_DE_EQUIPO[$ruta],
            $codigo,
            "`{$ruta}` dejó de filtrar los tipos de equipo por categoría.",
        );
    }
});

it('no queda declarado un sitio que ya no consulta', function (): void {
    $reales = array_keys(consultanTiposDeEquipo());

    foreach (array_keys(OFRECEN_TIPOS_DE_EQUIPO) as $declarado) {
        test()->assertContains(
            $declarado,
            $reales,
            "`{$declarado}` sigue declarado y ya no consulta `equipment_types`: quítalo del registro.",
        );
    }
});

it('la clase de unidad no puede quedar sin decir', function (): void {
    // Mientras fue un argumento opcional, olvidarse de pasarlo devolvía los
    // nueve tipos sin que nada fallara. Ahora no se puede llamar sin decirlo.
    $codigo = Source::sinComentarios(
        Source::root().'/app/Http/Controllers/App/EquipmentController.php',
    );

    test()->assertStringContainsString('private function choices(Actor $actor, string $type): array', $codigo);
    test()->assertStringNotContainsString('private function choices(Actor $actor, ?string $type', $codigo);
});
