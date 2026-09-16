<?php

declare(strict_types=1);

use Tests\Support\Source;

use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertStringNotContainsString;

/**
 * Mandado y escondido no es escondido.
 *
 * ## La regla, escrita tres veces en este proyecto
 *
 * `LoadController`, sobre el bloque de dinero: «Si el bloque de dinero se
 * enviara y se ocultara en React, ese conductor podría leerlo abriendo las
 * herramientas del navegador. Por eso el bloque no se calcula siquiera cuando el
 * permiso falta».
 *
 * `Privacy\Internal`: «`soloEquipo()` devuelve `null`, no una cadena que React
 * esconde».
 *
 * `Public\TrackingController`: «NO viajan al cliente… ni un solo identificador
 * con el que probar otra dirección», y su `stops()` quita el `id` y el
 * `customer_location_id` a mano.
 *
 * ## Los dos sitios donde no se aplicaba
 *
 *  1. La pantalla de firmas mandaba **la empresa entera** —hasta quinientas
 *     razones sociales— a cualquiera que la abriera, y el desplegable que las
 *     pinta está detrás de `can.create`. Un transportista tiene
 *     `signature:request:read` con alcance propio: abría las firmas de sus
 *     documentos y se llevaba la lista de sus competidores.
 *  2. La cronología pública reenviaba tal cual la que arma el despacho, con el
 *     `stopId` y el `provider` dentro. La pantalla no los pinta; están en el
 *     JSON.
 */
function raizPayload(): string
{
    return Source::root();
}

it('la lista de transportistas no viaja a quien no puede pedir una firma', function (): void {
    $fuente = Source::compacta(raizPayload().'/app/Http/Controllers/App/SignatureController.php');

    // La consulta suelta en el payload ya no está.
    assertStringNotContainsString("'carriers'=>DB::table('carriers')", $fuente);
    assertStringContainsString("'carriers'=>\$this->transportistasElegibles(\$actor,\$scope,\$checker,\$policy)", $fuente);

    // Sin el permiso de crear, lista vacía: un dato que no alimenta nada no
    // viaja.
    assertStringContainsString("\$checker->can(\$actor,'signature:request:create',null,\$policy)->allowed", $fuente);

    // Y estrechada por ámbito, con la MISMA pieza que las filas de la pantalla,
    // para que la lista y lo que se ve no puedan decir cosas distintas.
    //
    // Esto exigía `if($scope===Scope::Carrier){`, que era lo que había cuando
    // se escribió y era medio `match` copiado: cubría al transportista y dejaba
    // pasar a `Scope::Assigned`. El despachador tenía en el desplegable de
    // «mandar a firmar» transportistas que no son suyos — y eso ya no es ver de
    // más, es poder mandarle un acuerdo a otro. La prueba no se relaja: se
    // corrige a exigir la pieza, que es lo que contesta bien para los cinco
    // ámbitos.
    assertStringContainsString(
        "\$checker->scopeFilter(\$actor,\$scope)->applyToQuery(\$consulta,'carriers',['carrier'=>'id'])",
        $fuente,
    );
    assertStringNotContainsString('if($scope===Scope::Carrier){', $fuente);
});

it('la cronología pública no lleva identificadores', function (): void {
    $fuente = Source::compacta(raizPayload().'/app/Support/Tracking/Timeline.php');

    // Se quitan por NOMBRE y sobre la lista ya filtrada: añadir un campo nuevo
    // al despacho no lo mete solo en la página pública, pero tampoco lo saca —
    // eso lo sujeta la prueba de característica, que compara las claves.
    assertStringContainsString("array_diff_key(\$e,['stopId'=>null,'provider'=>null])", $fuente);

    // Y el despacho los sigue teniendo: la pantalla interna los usa.
    assertStringContainsString("'stopId'=>\$e->stop_id===null?null:(string)\$e->stop_id", $fuente);
    assertStringContainsString("'provider'=>(string)\$e->provider", $fuente);

    // La invariante sigue declarada donde se lee.
    $publico = Source::sinComentarios(raizPayload().'/app/Http/Controllers/Public/TrackingController.php');

    assertStringNotContainsString("'id' => (string) \$s->id", $publico);
});
