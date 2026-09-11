<?php

declare(strict_types=1);

use App\Support\Oversize\Papers;
use Tests\Support\Source;

/**
 * La puerta de sobredimensión mira las escoltas, y se vuelve a cerrar.
 *
 * ## Los dos agujeros
 *
 * **Uno.** La página pública decía «una carga no puede despacharse con un
 * permiso o escolta pendiente». Lo del permiso era verdad. `Papers::faltan()`
 * solo consultaba `permits`; `escorts.status` no lo leía ningún guardián, así
 * que una escolta en `pending` no impedía nada. La frase hubo que quitarla de
 * la página de ventas en el lote anterior.
 *
 * **Dos.** `storePermit` reabría la compuerta al crear un permiso pendiente, y
 * su propio comentario decía por qué: «si no lo hiciera, una carga aprobada el
 * lunes seguiría aprobada el martes con un permiso nuevo sin tramitar dentro».
 * `updatePermit` no lo hacía. Devolver un permiso emitido a pendiente dejaba la
 * carga aprobada y despachable — el mismo argumento, sin aplicar, a dos
 * funciones de distancia.
 */
function raizPuerta(): string
{
    return Source::root();
}

it('la puerta consulta las escoltas', function (): void {
    $fuente = Source::compacta(raizPuerta().'/app/Support/Oversize/Papers.php');

    test()->assertStringContainsString("DB::table('escorts')", $fuente);
    test()->assertStringContainsString("'reason'=>'escortPending'", $fuente);
    test()->assertStringContainsString("'reason'=>'escortWithoutDocument'", $fuente);
});

it('lo resuelto y lo que está en pie son dos listas distintas', function (): void {
    // Una escolta cancelada no hace falta y no necesita papel; una confirmada
    // sí. Con una sola lista, o se pide papel a lo cancelado o se deja pasar lo
    // confirmado sin él.
    expect(Papers::ESCOLTA_RESUELTA)->toBe(['confirmed', 'completed', 'cancelled', 'not_required'])
        ->and(Papers::ESCOLTA_EN_PIE)->toBe(['confirmed', 'completed']);

    // Lo que está en pie tiene que ser un subconjunto de lo resuelto, o habría
    // una escolta que pide papel y además bloquea por pendiente.
    expect(array_diff(Papers::ESCOLTA_EN_PIE, Papers::ESCOLTA_RESUELTA))->toBe([]);
});

it('no se bloquea por no tener escolta', function (): void {
    // Bloquear por ausencia pararía toda carga sobredimensionada que solo
    // necesita permiso. La comprobación recorre las filas que hay.
    $fuente = Source::compacta(raizPuerta().'/app/Support/Oversize/Papers.php');

    test()->assertStringContainsString('foreach($escoltasas$escolta)', $fuente);
    test()->assertStringNotContainsString('count($escoltas)===0', $fuente);
});

it('los cuatro caminos que tocan la puerta la reabren por el mismo sitio', function (): void {
    // Cuatro copias del mismo `update` es cómo se llegó al segundo agujero:
    // una de ellas se quedó sin escribir.
    $fuente = Source::compacta(raizPuerta().'/app/Http/Controllers/App/PermitController.php');

    expect(substr_count($fuente, '$this->reabrirCompuerta('))->toBe(4);

    // Y solo el ayudante toca la columna.
    expect(substr_count($fuente, "'permit_ready_approved_at'=>null"))->toBe(1);
});

it('cambiar un permiso a pendiente reabre la puerta', function (): void {
    $fuente = Source::compacta(raizPuerta().'/app/Http/Controllers/App/PermitController.php');

    $actualizar = substr(
        $fuente,
        strpos($fuente, 'publicfunctionupdatePermit('),
        strpos($fuente, 'privatefunctionreabrirCompuerta(') - strpos($fuente, 'publicfunctionupdatePermit('),
    );

    test()->assertStringContainsString('$this->reabrirCompuerta(', $actualizar);
});

it('el texto de los dos motivos está en los dos idiomas', function (): void {
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode((string) file_get_contents(raizPuerta()."/lang/{$idioma}/oversize.json"), true);

        foreach (['escortPending', 'escortWithoutDocument'] as $clave) {
            expect($d['readiness'][$clave] ?? null)->toBeString("Falta oversize.readiness.{$clave} en {$idioma}.");

            // Nombrando el estado: «hay una escolta pendiente» sobre una carga
            // que cruza cuatro estados manda a buscar cuál.
            test()->assertStringContainsString('{state}', (string) $d['readiness'][$clave]);
        }
    }
});

it('la página pública vuelve a prometerlo, ahora que es verdad', function (): void {
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode((string) file_get_contents(raizPuerta()."/lang/{$idioma}/marketing.json"), true);

        test()->assertMatchesRegularExpression(
            '/(escolta sin confirmar|unconfirmed escort)/iu',
            (string) $d['services']['permitsEscorts']['bullet3'],
            "La página en {$idioma} no cuenta la puerta de la escolta, que ya existe.",
        );
    }
});
