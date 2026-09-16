<?php

declare(strict_types=1);

use App\Enums\Scope;
use App\Support\Documents\DocumentOwners;
use App\Support\Documents\DocumentScope;
use Tests\Support\Source;

use function PHPUnit\Framework\assertSame;
use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertStringNotContainsString;

/**
 * Un filtro no puede ofrecer lo que no puede encontrar.
 *
 * ## El defecto
 *
 * El desplegable de dueño de la pantalla de documentos ofrecía los NUEVE tipos
 * del catálogo, a todo el mundo. Y `DocumentScope::apply()` recorta antes:
 *
 *  - alcance PROPIO fuerza `owner_type = 'driver'` → **ocho de nueve** opciones
 *    devuelven cero filas siempre, para cualquier conductor;
 *  - alcance de transportista o asignado → `forCarriers()` emite cuatro ramas,
 *    así que **cinco de nueve** son estructuralmente vacías, incluidas «carga» y
 *    «gasto», que son las de más volumen.
 *
 * La lista se vaciaba en silencio.
 *
 * ## Y la regla ya estaba escrita para los atajos de la misma pantalla
 *
 * `App\Support\Lists\FacetCounts`: «el número de un atajo tiene que ser el
 * número que sale al pulsarlo». Un desplegable no lleva número, así que la
 * promesa se hacía sin decir nada — y por eso se escapó de aquel lote.
 *
 * ## Las dos direcciones
 *
 * `ownerTypesFor()` es `apply()` leído al revés, igual que `carrierOf()` es
 * `forCarriers()` leído al revés. Este guardián compara las dos, que es lo que
 * faltaba la última vez que este fichero se leyó en dos sentidos.
 */
function raizFiltroDueno(): string
{
    return Source::root();
}

it('cada alcance ofrece exactamente lo que puede encontrar', function (): void {
    // Los dos que lo ven todo.
    assertSame(DocumentOwners::all(), DocumentScope::ownerTypesFor(Scope::Tenant));
    assertSame(DocumentOwners::all(), DocumentScope::ownerTypesFor(Scope::Platform));

    // Las cuatro ramas de `forCarriers()`.
    assertSame(['carrier', 'driver', 'truck', 'trailer'], DocumentScope::ownerTypesFor(Scope::Carrier));
    assertSame(['carrier', 'driver', 'truck', 'trailer'], DocumentScope::ownerTypesFor(Scope::Assigned));

    // La única rama del alcance propio.
    assertSame(['driver'], DocumentScope::ownerTypesFor(Scope::Own));
});

it('lo que se ofrece está en el catálogo', function (): void {
    foreach (Scope::cases() as $alcance) {
        foreach (DocumentScope::ownerTypesFor($alcance) as $tipo) {
            expect(DocumentOwners::isKnown($tipo))->toBeTrue(
                "«{$tipo}» se ofrece con alcance {$alcance->value} y no está en el catálogo",
            );
        }
    }
});

it('las dos direcciones del alcance dicen lo mismo', function (): void {
    $fuente = Source::sinComentarios(raizFiltroDueno().'/app/Support/Documents/DocumentScope.php');

    $corte = strpos($fuente, 'public static function ownerTypesFor');
    $recorta = substr($fuente, 0, (int) $corte);
    $ofrece = substr($fuente, (int) $corte);

    // Los cuatro que `forCarriers()` emite tienen que ser los cuatro que se
    // ofrecen con ese alcance. Si alguien añade una quinta rama allí y no la
    // añade aquí, el filtro esconde documentos que sí se pueden ver.
    foreach (['carrier', 'driver', 'truck', 'trailer'] as $tipo) {
        assertStringContainsString("'{$tipo}'", $recorta, "la consulta dejó de cubrir «{$tipo}»");
        assertStringContainsString("'{$tipo}'", $ofrece, "el filtro dejó de ofrecer «{$tipo}»");
    }

    // Y el alcance propio sigue forzando el conductor en la consulta: si eso
    // cambiara, la lista de arriba sobraría.
    assertStringContainsString("->where('owner_type', 'driver')->where('owner_id', \$actor->driverId)", $recorta);
});

it('la pantalla recibe la lista recortada, no el catálogo', function (): void {
    $fuente = Source::compacta(raizFiltroDueno().'/app/Http/Controllers/App/DocumentController.php');

    assertStringContainsString("'ownerTypes'=>DocumentScope::ownerTypesFor(\$scope)", $fuente);
    assertStringNotContainsString("'ownerTypes'=>DocumentOwners::all()", $fuente);

    // Y el guardado del filtro sigue validando contra el CATÁLOGO, no contra lo
    // que se ofreció: son dos preguntas distintas. Recortar la lista es cosa de
    // la pantalla; aceptar un valor conocido, del servidor.
    assertStringContainsString("DocumentOwners::isKnown(\$filters['owner'])", $fuente);
});
