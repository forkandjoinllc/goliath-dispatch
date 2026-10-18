<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * La búsqueda en el registro federal, desde el alta PÚBLICA.
 *
 * ## Lo que este lote vino a sujetar
 *
 * **Una capacidad construida y nunca usada.** `FmcsaDirectory` —con su
 * adaptador real, su simulado y `FmcsaLookup::live` para distinguirlos— lleva
 * lotes construida. La ficha interna la usa; el alta pública pedía el USDOT
 * como un campo más entre veinte y no preguntaba nada a nadie. El propio
 * comentario de `FmcsaLookup` decía que de `live` «depende que la pantalla
 * bloquee los campos o los deje escribir», y no había pantalla que lo leyera.
 *
 * **Un extremo público que mira la base de datos.** El método de dentro
 * contesta además «¿este transportista ya lo tienes?». Al otro lado de este
 * hay un desconocido sin sesión: esa respuesta le dejaría enumerar la cartera
 * entera a base de probar números.
 *
 * **Datos de fuera pintados como propios.** Un domicilio traído del registro y
 * puesto en la misma casilla, con la misma letra, que lo que escribió la
 * persona, se lee como suyo. Y el registro publica fichas que llevan años sin
 * tocarse.
 */
function fuenteDelAlta(string $ruta): string
{
    return Source::codigo(Source::root().'/'.$ruta);
}

/* ── Nada de la base de datos sale por un extremo público ───────────────── */

it('la búsqueda pública no consulta la base de datos', function (): void {
    /*
    | `CarrierController::lookup()` devuelve `existing`, que dice si ese USDOT
    | ya es un transportista de esa empresa. Es lo más útil que puede devolver
    | ahí dentro — y aquí fuera es una fuga: con él, cualquiera enumera la
    | cartera probando números.
    */
    $publico = fuenteDelAlta('app/Http/Controllers/Marketing/CarrierLookupController.php');

    test()->assertStringNotContainsString('DB::', $publico);
    test()->assertStringNotContainsString('existing', $publico);
    test()->assertStringNotContainsString('Carrier::', $publico);
});

it('solo viaja lo que contestó el registro', function (): void {
    // La proyección del directorio y nada más. Añadir un campo de cosecha
    // propia aquí es la forma de que se cuele un dato de dentro.
    $publico = fuenteDelAlta('app/Http/Controllers/Marketing/CarrierLookupController.php');

    test()->assertStringContainsString('$resultado->carrier?->toForm()', $publico);
});

/* ── Las tres defensas ──────────────────────────────────────────────────── */

it('la búsqueda tiene su propio tope por IP', function (): void {
    // El de los envíos no vale: buscar no es enviar, y las dos cuentas no se
    // deben gastar la una a la otra.
    $rutas = fuenteDelAlta('routes/web.php');

    test()->assertStringContainsString(
        "Route::middleware('throttle:12,60')\n    ->post('carrier-lookup', CarrierLookupController::class)",
        $rutas,
    );
});

it('el sello se exige, y el campo trampa también', function (): void {
    $publico = fuenteDelAlta('app/Http/Controllers/Marketing/CarrierLookupController.php');

    test()->assertStringContainsString('FormToken::verify(', $publico);
    test()->assertStringContainsString("'hp_field' => ['present', 'max:0']", $publico);
});

it('el sello de la búsqueda no exige la pausa, y el del envío sí', function (): void {
    /*
    | La pausa de tres segundos existe para los ENVÍOS: nadie rellena veinte
    | campos en tres segundos. Para una búsqueda dice lo contrario de lo que
    | quiere decir — a esa casilla llega alguien con el número ya en la mano,
    | lo pega y pulsa buscar.
    |
    | Lo que no puede pasar es que esto afloje los envíos, así que se mide que
    | la pausa sigue siendo lo que se exige por omisión.
    */
    $publico = fuenteDelAlta('app/Http/Controllers/Marketing/CarrierLookupController.php');
    $sello = fuenteDelAlta('app/Support/Forms/FormToken.php');

    test()->assertStringContainsString('exigirPausa: false', $publico);
    test()->assertStringContainsString('bool $exigirPausa = true', $sello);
    test()->assertStringContainsString('if ($exigirPausa && $elapsed < self::MIN_SECONDS * 1000)', $sello);

    // Y el formulario público común, que es quien manda los envíos, no la
    // desactiva.
    $base = fuenteDelAlta('app/Http/Requests/Marketing/PublicFormRequest.php');
    test()->assertStringNotContainsString('exigirPausa', $base);
});

it('el rechazo no dice cuál de las defensas paró la petición', function (): void {
    // Explicárselo a un bot es enseñarle a rodearla. Misma regla que el envío.
    $publico = fuenteDelAlta('app/Http/Controllers/Marketing/CarrierLookupController.php');

    test()->assertStringContainsString("['status' => 'rejected']", $publico);
    test()->assertStringNotContainsString("'reason'", $publico);
});

/* ── Lo que la pantalla no se puede callar ──────────────────────────────── */

it('ningún campo del alta se bloquea', function (): void {
    /*
    | «Todo lo de abajo se puede corregir» es una promesa declarada en
    | `PublicClaims`. Basta con un `readOnly` en un campo prerrellenado para
    | que pase a ser mentira, y es la clase de cambio que se hace sin pensar
    | —«si viene del registro, que no lo toquen»— precisamente porque suena
    | prudente.
    */
    foreach ([
        'resources/js/pages/Marketing/CarrierSignup.tsx',
        'resources/js/components/Marketing/FmcsaLookup.tsx',
    ] as $ruta) {
        $pantalla = fuenteDelAlta($ruta);

        test()->assertStringNotContainsString('readOnly', $pantalla, $ruta.' bloquea un campo.');
        test()->assertStringNotContainsString('disabled={true}', $pantalla, $ruta.' bloquea un campo.');
    }
});

it('prerrellenar deja siempre dicho de dónde vino', function (): void {
    $pagina = fuenteDelAlta('resources/js/pages/Marketing/CarrierSignup.tsx');

    // El aviso se pinta en cuanto hay procedencia, no detrás de ninguna otra
    // condición.
    test()->assertStringContainsString('procedencia === null ? null : (', $pagina);
    test()->assertStringContainsString('lookup.prefilled', $pagina);
    test()->assertStringContainsString('lookup.prefilledMock', $pagina);
});

it('el simulacro se presenta como simulacro', function (): void {
    /*
    | Sin credenciales se ata el adaptador simulado, que fabrica una ficha
    | coherente. Veinte casillas rellenas con datos inventados y presentadas
    | como venidas del registro federal es la mentira más cara que puede
    | contar este formulario.
    */
    $buscador = fuenteDelAlta('resources/js/components/Marketing/FmcsaLookup.tsx');
    $pagina = fuenteDelAlta('resources/js/pages/Marketing/CarrierSignup.tsx');

    test()->assertStringContainsString('respuesta.live ?', $buscador);
    test()->assertStringContainsString('procedencia.live', $pagina);
});

it('el prerrellenado no pisa lo que ya escribió la persona', function (): void {
    // Buscar por segunda vez vaciaría —o reescribiría— lo que alguien acabara
    // de corregir a mano. Un nulo del registro es «no lo sé», no «bórralo».
    $pagina = fuenteDelAlta('resources/js/pages/Marketing/CarrierSignup.tsx');

    test()->assertStringContainsString(
        "if (valor !== null && valor !== '' && form.data[clave] === '')",
        $pagina,
    );
});

it('«no encontrado» no se pinta como un error', function (): void {
    // Un USDOT recién sacado no está en el registro todavía, y esa persona se
    // da de alta igual. Tratarla como si se hubiera equivocado la echa.
    $buscador = fuenteDelAlta('resources/js/components/Marketing/FmcsaLookup.tsx');

    preg_match("/\\{estado === 'not_found' \\? <p className=\"([^\"]+)\"/", $buscador, $m);
    expect($m)->not->toBeEmpty('No se encontró cómo se pinta «no encontrado».');
    expect($m[1])->not->toContain('danger');

    // Y el camino a mano está siempre, no solo cuando algo falla.
    test()->assertStringContainsString("texto('skip')", $buscador);
});

it('cada rótulo del buscador existe en los dos idiomas', function (): void {
    // La lección del lote 43: ninguna prueba miraba qué rótulos PIDE un
    // componente, y la clave cruda se vio en pantalla con la suite en verde.
    $buscador = fuenteDelAlta('resources/js/components/Marketing/FmcsaLookup.tsx');

    preg_match_all("/texto\('([a-zA-Z]+)'\)/", $buscador, $m);
    expect($m[1])->not->toBeEmpty();

    foreach (['en', 'es'] as $idioma) {
        $dic = json_decode(
            (string) file_get_contents(Source::root()."/lang/{$idioma}/marketing.json"),
            true,
        );

        foreach (array_unique($m[1]) as $clave) {
            test()->assertArrayHasKey(
                $clave,
                $dic['carrierSignup']['lookup'] ?? [],
                "El buscador pide «{$clave}» y {$idioma} no lo tiene: se pintaría la clave cruda.",
            );
        }
    }
});

it('el sello sigue siendo el del mismo formulario', function (): void {
    // Un sello emitido para el formulario de contacto no puede valer para
    // buscar en el registro desde el alta de transportista.
    $publico = fuenteDelAlta('app/Http/Controllers/Marketing/CarrierLookupController.php');

    test()->assertStringContainsString("'carrier_signup'", $publico);
});
