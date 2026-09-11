<?php

declare(strict_types=1);

use App\Support\Deletion\OpenWork;
use App\Support\Loads\ScheduleConflict;
use Tests\Support\Source;

/**
 * Lo que la página de Servicios promete sobre la asignación.
 *
 * Decía, y lo lee quien todavía no ha comprado:
 *
 * > La asignación se verifica automáticamente contra el cumplimiento normativo
 * > — un camión, remolque o conductor con un documento vencido, **o un conflicto
 * > de horario**, no puede asignarse a una carga.
 *
 * Lo del documento vencido es verdad. Lo del horario no existía: ni una consulta
 * en todo el producto comparaba las asignaciones de un recurso contra las
 * ventanas de otra carga. Se podía poner al mismo conductor en dos cargas que se
 * solapan y nadie decía nada.
 */
function raizSolape(): string
{
    return Source::root();
}

it('los tres recursos que se pueden pisar están contemplados', function (): void {
    // Un remolque también es uno solo. Dejarlo fuera sería arreglar dos
    // tercios del defecto y dejar el otro tercio prometido.
    expect(ScheduleConflict::RECURSOS)->toBe(['driver', 'truck', 'trailer']);
});

it('la ficha de la carga mira los tres', function (): void {
    $fuente = Source::compacta(raizSolape().'/app/Http/Controllers/App/LoadController.php');

    // Camión y remolque comparten el mismo constructor, así que basta con que
    // pase el singular; el conductor va por su lado.
    test()->assertStringContainsString('ScheduleConflict::byResource($tenantId,(string)$load->id,$singular)', $fuente);
    test()->assertStringContainsString("ScheduleConflict::byResource(\$tenantId,(string)\$load->id,'driver')", $fuente);
});

it('avisa y no bloquea', function (): void {
    // La decisión del lote: un documento vencido es una puerta, una agenda
    // apretada es una decisión de quien despacha. El día que se endurezca, el
    // texto de la página de Servicios tiene que cambiar en el mismo movimiento.
    $asignacion = Source::compacta(raizSolape().'/app/Http/Controllers/App/LoadAssignmentController.php');

    test()->assertStringNotContainsString(
        'ScheduleConflict',
        $asignacion,
        'Si la asignación empieza a mirar los solapes, ya no es solo un aviso: revisa el texto público.',
    );

    // Y en la pantalla, el solape va aparte de lo que descarta.
    $panel = Source::sinComentarios(raizSolape().'/resources/js/components/App/AssignPanel.tsx');

    test()->assertStringContainsString("t('loads.assign.scheduleConflict'", $panel);

    // El botón de asignar se apaga por `ok` y por nada más. Un sabotaje que
    // añadiera los solapes a esa condición convertiría el aviso en bloqueo sin
    // tocar el servidor —donde `ok` sigue en true— y ninguna prueba lo veía.
    // Por eso la condición se fija entera.
    test()->assertStringContainsString(
        "disabled={choice === '' || (chosen !== undefined && !chosen.ok)}",
        $panel,
        'El botón de asignar tiene que apagarse solo por `ok`: un solape avisa, no impide.',
    );

});

it('una consulta por tipo de recurso, no una por opción', function (): void {
    // Veinte conductores en la lista serían veinte consultas, y esto se calcula
    // cada vez que alguien abre la ficha de una carga.
    $fuente = Source::compacta(raizSolape().'/app/Http/Controllers/App/LoadController.php');

    expect(substr_count($fuente, 'ScheduleConflict::byResource('))->toBe(2);
    test()->assertStringNotContainsString('ScheduleConflict::forResource(', $fuente);
});

it('las cargas cerradas salen de la misma lista que en el resto del producto', function (): void {
    // Y no de una lista nueva: «cerrada» tiene que significar lo mismo en todas
    // partes, o dos pantallas contarán cosas distintas.
    $fuente = Source::compacta(raizSolape().'/app/Support/Loads/ScheduleConflict.php');

    test()->assertStringContainsString('OpenWork::CARGAS_CERRADAS', $fuente);
    expect(OpenWork::CARGAS_CERRADAS)->toBe(['paid', 'cancelled']);
});

it('una parada sin cierre dura lo que su inicio', function (): void {
    // Una cita sin ventana de cierre no es una cita que dure para siempre: sin
    // el `coalesce` una sola parada abierta haría que esa carga se pisara con
    // todo lo que viniera después.
    $fuente = Source::compacta(raizSolape().'/app/Support/Loads/ScheduleConflict.php');

    expect(substr_count($fuente, 'coalesce(s.window_end,s.window_start)'))->toBeGreaterThanOrEqual(2);
    test()->assertStringContainsString('coalesce(window_end,window_start)', $fuente);
});

it('la página de Servicios dice lo que la asignación hace', function (): void {
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode((string) file_get_contents(raizSolape()."/lang/{$idioma}/marketing.json"), true);
        $texto = (string) ($d['services']['dispatch']['body'] ?? '');

        expect($texto)->not->toBe('', "Falta services.dispatch.body en {$idioma}.");

        // Ya no dice que un conflicto de horario IMPIDA asignar.
        test()->assertDoesNotMatchRegularExpression(
            '/(conflicto de horario|schedule conflict)[^.]*no puede asignarse|cannot be assigned[^.]*(schedule|overlap)/iu',
            $texto,
            "La página de Servicios en {$idioma} sigue diciendo que un solape impide asignar.",
        );

        // Y sí dice que se avisa.
        test()->assertMatchesRegularExpression(
            '/(se avisa|you are told)/iu',
            $texto,
            "La página de Servicios en {$idioma} ya no cuenta el aviso de solape.",
        );
    }
});

it('el aviso se dice en los dos idiomas', function (): void {
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode((string) file_get_contents(raizSolape()."/lang/{$idioma}/loads.json"), true);

        foreach (['scheduleConflict', 'scheduleConflictShort'] as $clave) {
            expect($d['assign'][$clave] ?? null)->toBeString("Falta loads.assign.{$clave} en {$idioma}.");
        }

        // El largo nombra las cargas: un «se pisa» a secas manda a adivinar
        // cuál de las treinta cargas de esta semana es.
        test()->assertStringContainsString('{loads}', (string) $d['assign']['scheduleConflict']);
    }
});
