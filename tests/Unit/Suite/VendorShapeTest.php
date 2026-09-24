<?php

declare(strict_types=1);

use App\Enums\VendorType;
use App\Http\Controllers\App\VendorController;
use Tests\Support\Source;

/**
 * La forma de la ficha de proveedor.
 *
 * ## Lo que este lote vino a sujetar
 *
 * **Un nombre tecleado no es una ficha.** `trucks.lessor_name` y su gemela en
 * remolques llevan ahí desde el primer día, y son el único dato que existe
 * sobre el arrendador de cada unidad. La columna nueva APUNTA a la ficha y la
 * vieja se queda: borrarla habría tirado en silencio lo único que hay, a
 * cambio de nada.
 *
 * **Un identificador fiscal que se enseña es un identificador fiscal
 * filtrado.** Se guarda cifrado y solo vuelven los cuatro últimos, en las tres
 * puertas: la columna, el modelo y lo que viaja a la pantalla.
 *
 * **Un vocabulario escrito dos veces se separa.** El tipo de proveedor vive en
 * el enum, la restricción de la base se reconstruye desde él, y el desplegable
 * lo recibe del servidor.
 */
function fuenteDelProveedor(string $ruta): string
{
    return (string) file_get_contents(Source::root().'/'.$ruta);
}

/* ── El vocabulario, en un solo sitio ───────────────────────────────────── */

it('la restricción de la base se construye desde el enum', function (): void {
    $migracion = fuenteDelProveedor('database/migrations/2026_09_26_100000_create_vendors.php');

    // Escrita a mano, la lista de la base y la del enum se separan el día que
    // alguien añada un tipo — y la base rechazaría lo que el desplegable
    // ofrece. Es la misma lección del lote 38 con las acciones de auditoría.
    test()->assertStringContainsString('VendorType::values()', $migracion);
    test()->assertStringNotContainsString("'leasing', 'maintenance'", $migracion);
});

it('el factoraje no es un tipo de proveedor', function (): void {
    // Tiene su propio dominio, con sus contratos y sus avisos de cesión.
    // Meterlo aquí daría dos sitios donde dar de alta la misma empresa, y el
    // segundo sería el que se quedaría sin los avisos.
    expect(VendorType::values())->not->toContain('factoring');
    expect(VendorType::values())->toContain('leasing');
});

it('cada tipo y cada estado tienen nombre en los dos idiomas', function (): void {
    foreach (['en', 'es'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(Source::root().'/lang/'.$idioma.'/vendors.json'),
            true,
        );

        foreach (VendorType::values() as $tipo) {
            test()->assertArrayHasKey(
                $tipo,
                $d['type'] ?? [],
                "Falta el nombre del tipo «{$tipo}» en {$idioma}: el desplegable pintaría la clave cruda.",
            );
        }

        foreach (['active', 'inactive', 'archived'] as $estado) {
            test()->assertArrayHasKey($estado, $d['status'] ?? [], "Falta el estado «{$estado}» en {$idioma}.");
        }

        foreach (VendorController::FORMAS_DE_PAGO as $forma) {
            test()->assertArrayHasKey($forma, $d['paymentMethod'] ?? [], "Falta la forma de pago «{$forma}» en {$idioma}.");
        }
    }
});

/* ── El identificador fiscal no sale ────────────────────────────────────── */

it('el identificador fiscal está oculto en el modelo y cifrado', function (): void {
    $modelo = Source::codigo(Source::root().'/app/Models/Vendor.php');

    test()->assertStringContainsString("'tax_id_encrypted' => 'encrypted'", $modelo);
    test()->assertMatchesRegularExpression(
        '/\$hidden = \[\s*\'tax_id_encrypted\',/',
        $modelo,
        'Sin `hidden`, el identificador fiscal viaja entero en cuanto alguien serialice el modelo.',
    );
});

it('a la pantalla solo viajan los cuatro últimos', function (): void {
    $controlador = Source::codigo(Source::root().'/app/Http/Controllers/App/VendorController.php');

    test()->assertStringContainsString("'taxIdLast4' => \$v->tax_id_last4", $controlador);

    // Dentro de lo que SALE, no en el fichero entero: el controlador tiene que
    // escribir `tax_id_encrypted` —para eso está el campo— y prohibir la
    // cadena a secas medía el guardado en vez de la salida. El guardián se
    // cayó midiendo lo de al lado.
    preg_match('/private function detail\(.*?\n    \}/s', $controlador, $m);
    expect($m)->not->toBeEmpty();

    test()->assertStringNotContainsString('tax_id_encrypted', $m[0]);
    test()->assertStringNotContainsString("'taxId' =>", $m[0]);

    preg_match('/private function row\(.*?\n    \}/s', $controlador, $r);
    expect($r)->not->toBeEmpty();

    test()->assertStringNotContainsString('tax_id', $r[0]);
});

it('la ausencia del identificador fiscal significa «déjalo»', function (): void {
    // La pantalla no lo puede devolver —no se enseña nunca— así que tratar su
    // ausencia como «bórralo» haría que editar el teléfono borrara el EIN. Es
    // la misma forma que `array_key_exists` en las tarifas de una carga.
    $controlador = Source::codigo(Source::root().'/app/Http/Controllers/App/VendorController.php');

    test()->assertStringContainsString("array_key_exists('tax_id', \$data)", $controlador);
});

it('el formulario sale en blanco también al editar', function (): void {
    $form = Source::codigo(Source::root().'/resources/js/pages/App/Vendors/Form.tsx');

    test()->assertMatchesRegularExpression(
        "/tax_id: '',/",
        $form,
        'Si el formulario intentara devolver el identificador fiscal, tendría que recibirlo.',
    );
});

/* ── El arrendador tecleado no se tira ──────────────────────────────────── */

it('la columna vieja del arrendador sigue en pie', function (): void {
    $migracion = fuenteDelProveedor('database/migrations/2026_09_26_100000_create_vendors.php');

    // La unidad GANA una columna, no la cambia. `lessor_name` es lo único que
    // existe hoy sobre el arrendador de cada unidad.
    test()->assertStringContainsString("\$table->uuid('lessor_vendor_id')", $migracion);
    test()->assertStringNotContainsString("dropColumn('lessor_name')", $migracion);
});

it('la pantalla de la unidad dice cuándo el arrendador es solo un nombre', function (): void {
    $form = fuenteDelProveedor('resources/js/pages/App/Equipment/Form.tsx');
    $show = fuenteDelProveedor('resources/js/pages/App/Equipment/Show.tsx');

    // Sustituirlo por un desplegable vacío habría hecho desaparecer el dato de
    // la pantalla sin borrarlo de la base: peor que borrarlo, porque parece
    // que no había nada.
    test()->assertStringContainsString('lessorTypedOnly', $form);
    test()->assertStringContainsString('lessorNoRecord', $show);
});

it('la unidad propia suelta también la ficha del arrendador', function (): void {
    $equipo = Source::codigo(Source::root().'/app/Http/Controllers/App/EquipmentController.php');

    // La regla ya existía para el nombre. Dejar el enlace puesto en una unidad
    // propia dejaría un dato que contradice al de al lado.
    test()->assertMatchesRegularExpression(
        "/'lessor_vendor_id' => \\\$esPropia \\? null :/",
        $equipo,
    );
});

/* ── Nada se ata a otra empresa ─────────────────────────────────────────── */

it('las tres puertas comprueban que la ficha es de esta empresa', function (): void {
    // `size:36` y `uuid` dejan pasar el identificador de otra empresa: el
    // ámbito global impide LEERLO, no impide escribirlo. Las tres puertas que
    // aceptan un id de fuera lo comprueban contra el modelo, que sí lleva el
    // ámbito puesto.
    $equipo = Source::codigo(Source::root().'/app/Http/Controllers/App/EquipmentController.php');
    $gastos = Source::codigo(Source::root().'/app/Http/Controllers/App/ExpenseController.php');
    $proveedores = Source::codigo(Source::root().'/app/Http/Controllers/App/VendorController.php');

    test()->assertStringContainsString('Vendor::query()->whereKey($value)->exists()', $equipo);
    test()->assertStringContainsString("Vendor::query()->whereKey(\$data['vendor_id'])->value('id')", $gastos);
    // Y el transportista al que se ata un proveedor, contra la lista que esa
    // persona puede elegir.
    test()->assertStringContainsString('$this->transportistasParaElegir($actor)', $proveedores);
});

/* ── Retirar no deja cabos sueltos ──────────────────────────────────────── */

it('retirar un proveedor mira lo que lo nombra', function (): void {
    $controlador = Source::codigo(Source::root().'/app/Http/Controllers/App/VendorController.php');

    preg_match('/private function loQueLoAta\(.*?\n    \}/s', $controlador, $m);
    expect($m)->not->toBeEmpty();

    // Las dos: una unidad se quedaría con un arrendador que no existe, y un
    // gasto cuyo proveedor desapareció ya no se puede explicar.
    test()->assertStringContainsString('lessor_vendor_id', $m[0]);
    test()->assertStringContainsString("DB::table('expenses')", $m[0]);
});

/* ── El alcance de un transportista es un EXISTS ────────────────────────── */

it('el alcance por transportista pasa por la tabla de relación', function (): void {
    $scope = Source::codigo(Source::root().'/app/Support/Vendors/VendorScope.php');

    // Un proveedor no tiene columna de transportista: a quién sirve vive en
    // `vendor_carriers`, así que es un EXISTS y no un WHERE. Es la misma forma
    // que `DriverScope`, y por lo mismo.
    test()->assertStringContainsString("from('vendor_carriers as vc')", $scope);
    test()->assertStringNotContainsString("where('vendors.carrier_id'", $scope);
});

it('el contexto del proveedor no finge un transportista', function (): void {
    $scope = Source::codigo(Source::root().'/app/Support/Vendors/VendorScope.php');

    // Pasar uno de sus transportistas como si fuera «su» transportista daría
    // permiso sobre la ficha entera a quien solo comparte una relación.
    test()->assertStringContainsString('carrierId: null', $scope);
    // Y con argumentos NOMBRADOS: `ResourceContext` toma cuatro cadenas y
    // ponerlas en otro orden no falla, deniega en silencio. Pasó en el lote 36.
    test()->assertStringContainsString('tenantId:', $scope);
});

/* ── Un solo sitio donde nace una ficha ─────────────────────────────────── */

it('la pantalla del equipo no crea proveedores', function (): void {
    // Dos sitios donde nace una ficha son dos sitios donde olvidarse del W-9 y
    // de los contactos, y el segundo siempre es el que se olvida.
    $form = fuenteDelProveedor('resources/js/pages/App/Equipment/Form.tsx');

    test()->assertStringNotContainsString("post('/vendors'", $form);
    test()->assertStringContainsString('lessorNoVendors', $form);
});

it('la unidad solo elige entre arrendadoras activas', function (): void {
    $equipo = Source::codigo(Source::root().'/app/Http/Controllers/App/EquipmentController.php');

    preg_match("/'lessors' => DB::table\('vendors'\).*?->all\(\),/s", $equipo, $m);
    expect($m)->not->toBeEmpty();

    // Ofrecer un taller como arrendador de un camión es ofrecer un dato que
    // después nadie sabe leer.
    test()->assertStringContainsString('VendorType::Leasing->value', $m[0]);
    test()->assertStringContainsString("where('status', 'active')", $m[0]);
});
