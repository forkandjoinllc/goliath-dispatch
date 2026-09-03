<?php

declare(strict_types=1);

use App\Enums\LoadStatus;
use App\Support\Finance\Billable;
use Tests\Support\Source;

/**
 * «Facturada» y «Pagada» tienen que querer decir eso.
 *
 * ## El defecto
 *
 * Los dos últimos estados del ciclo de vida de una carga eran afirmaciones que
 * no comprobaba nadie. `Guards::blocking()` no tenía caso para ninguno de los
 * dos, así que la ficha de carga enseñaba un botón «Marcar facturada» que
 * escribía el estado sin mirar si existía una factura, y otro «Marcar pagada»
 * que no miraba si existía un cobro.
 *
 * Y al revés: emitir una factura de verdad NO movía la carga, y cobrarla
 * tampoco. Las dos mitades del sistema no se hablaban justo en la costura donde
 * está el dinero. El resultado se veía sin buscarlo: la ficha decía «Facturada»
 * y el panel seguía contando esa misma carga entre las pendientes de facturar,
 * porque el panel pregunta por líneas de factura vivas y la ficha leía una
 * columna escrita a mano.
 *
 * Debajo había un tercer fallo, más callado: lo facturable se decidía con el
 * literal `'delivered'`, copiado en tres consultas. Una carga que avanzaba a
 * `pod_received` —el estado al que la propia aplicación empuja, y que exige el
 * comprobante firmado— desaparecía de la pantalla de facturar. Colgar el papel
 * te quitaba la carga de la vista; no colgarlo te dejaba facturarla.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código, como en los demás
 * guardianes de esta carpeta.
 */
function raizFacturacionDeCarga(): string
{
    return dirname(__DIR__, 3);
}

function codigoDeFacturacionSinComentarios(string $ruta): string
{
    // El cuerpo vivía copiado en quince ficheros. Ver Tests\Support\Source:
    // no quitaba los espacios, y por eso varias agujas de esta carpeta no
    // podían casar con nada.
    return Source::sinComentarios($ruta);
}

/* ── Nadie puede AFIRMAR a mano que una carga está facturada ─────────────── */

it('el grafo de transiciones no ofrece «facturada» ni «pagada»', function (): void {
    // COMPACTA: estas agujas van sin espacios. Escritas contra el código con
    // espacios no casaban nunca y esta prueba pasaba siempre, con el defecto
    // puesto y sin él. Lo destapó un sabotaje en el lote 69.
    $codigo = Source::compacta(raizFacturacionDeCarga().'/app/Support/Loads/Transitions.php');

    // La declaración completa, con permiso, tal y como estaba. Buscar solo la
    // palabra no vale: `invoiced` sigue apareciendo —en `SYSTEM`— y la prueba
    // pasaría por el motivo equivocado.
    expect(str_contains($codigo, "'invoiced'=>[[LoadStatus::PodReceived],'invoice:create']"))->toBeFalse(
        'Volvió el botón «Marcar facturada». La ficha de carga puede otra vez declarar facturada una carga '
        .'sin que exista ni una factura, y el panel la seguirá contando como pendiente.'
    );

    expect(str_contains($codigo, "'paid'=>[[LoadStatus::Invoiced],'payment:record']"))->toBeFalse(
        'Volvió el botón «Marcar pagada». Se puede dar por cobrado dinero que no ha entrado.'
    );
});

it('los dos estados de dinero los escribe un solo sitio', function (): void {
    $sospechosas = [];

    $iterador = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(raizFacturacionDeCarga().'/app', RecursiveDirectoryIterator::SKIP_DOTS)
    );

    foreach ($iterador as $fichero) {
        if ($fichero->getExtension() !== 'php') {
            continue;
        }

        $ruta = (string) $fichero->getPathname();

        // El escritor legítimo, y el enum donde viven los valores.
        if (str_ends_with($ruta, 'Loads/BillingState.php') || str_ends_with($ruta, 'Enums/LoadStatus.php')) {
            continue;
        }

        // Por SENTENCIA, no por fichero. Buscar `'status'=>'paid'` a secas
        // señalaba a `CommissionLedger` y a `SettlementController`, que
        // escriben el estado de una comisión y el de una liquidación: otras dos
        // tablas que también tienen una columna llamada `status`. Lo que se
        // vigila es quién escribe el de una CARGA, así que las dos mitades
        // —la tabla y el valor— tienen que estar en la misma sentencia.
        foreach (explode(';', Source::compacta($ruta)) as $sentencia) {
            if (! str_contains($sentencia, "DB::table('loads')")) {
                continue;
            }

            foreach (["'status'=>'invoiced'", "'status'=>'paid'"] as $aguja) {
                if (str_contains($sentencia, $aguja)) {
                    $sospechosas[] = basename($ruta).' → '.$aguja;
                }
            }
        }
    }

    expect($sospechosas)->toBe([],
        'Alguien más volvió a escribir el estado de dinero de una carga: '.implode(', ', $sospechosas).'. '
        .'Con dos escritores la columna y las facturas se separan, y la que se equivoque es la que se '
        .'está mirando.'
    );
});

/* ── El dominio de finanzas SÍ la mueve ──────────────────────────────────── */

it('emitir una factura mueve las cargas', function (): void {
    $codigo = codigoDeFacturacionSinComentarios(raizFacturacionDeCarga().'/app/Support/Finance/InvoiceBuilder.php');

    expect(str_contains($codigo, 'BillingState::alFacturar('))->toBeTrue(
        'Emitir una factura dejó de mover la carga. Vuelve la contradicción: el panel deja de contarla y '
        .'su ficha sigue diciendo «Entregada».'
    );
});

it('cobrar y reembolsar mueven las cargas, en los dos sentidos', function (): void {
    foreach (['PaymentLedger.php', 'InvoicePayments.php'] as $fichero) {
        $codigo = codigoDeFacturacionSinComentarios(raizFacturacionDeCarga().'/app/Support/Finance/'.$fichero);

        expect(str_contains($codigo, 'BillingState::sincronizarCobro('))->toBeTrue(
            "{$fichero} dejó de poner sus cargas al día. Hay DOS sitios que mueven el saldo de una factura y "
            .'esto tiene que colgar de los dos: si falta uno, según por dónde entre el cobro la carga dirá '
            .'una cosa u otra.'
        );
    }
});

it('anular una factura devuelve las cargas', function (): void {
    $codigo = codigoDeFacturacionSinComentarios(raizFacturacionDeCarga().'/app/Http/Controllers/App/InvoiceController.php');

    expect(str_contains($codigo, 'BillingState::alAnular('))->toBeTrue(
        'Anular dejó de devolver la carga. Se queda diciendo «Facturada» para siempre mientras el panel la '
        .'vuelve a ofrecer como pendiente — que es exactamente la desincronización por la que durante mucho '
        .'tiempo esto no se escribió en absoluto.'
    );
});

it('la vuelta al anular se lee del historial y no está escrita', function (): void {
    $codigo = codigoDeFacturacionSinComentarios(raizFacturacionDeCarga().'/app/Support/Loads/BillingState.php');

    expect(str_contains($codigo, 'deDondeVino('))->toBeTrue(
        'El destino al anular volvió a ser fijo. Una carga que se facturó SIN comprobante volvería con uno, '
        .'o al revés — inventado en la única tabla a la que se acude cuando ya no se fía uno de las demás.'
    );
});

/* ── Lo facturable no es un literal suelto ───────────────────────────────── */

it('una carga con el comprobante colgado sigue siendo facturable', function (): void {
    // `toContain` es variádico: el mensaje se convertiría en una segunda aguja
    // y la comprobación pasaría siempre. Ya pasó una vez, en el lote 64.
    expect(in_array('pod_received', Billable::ESTADOS, true))->toBeTrue(
        'Volvió a quedarse fuera. Colgar el comprobante firmado —lo que la aplicación te pide hacer— saca la '
        .'carga de la pantalla de facturar, y no colgarlo te deja facturarla. El incentivo queda del revés.'
    );

    expect(in_array('delivered', Billable::ESTADOS, true))->toBeTrue();
});

it('nadie decide lo facturable ni lo liquidable con el literal suelto', function (): void {
    $ficheros = [
        '/app/Support/Finance/Billable.php',
        '/app/Http/Controllers/App/InvoiceController.php',
        '/app/Http/Controllers/App/SettlementController.php',
        '/database/seeders/DemoDataSeeder.php',
    ];

    foreach ($ficheros as $relativa) {
        $codigo = Source::compacta(raizFacturacionDeCarga().$relativa);

        expect(str_contains($codigo, "'l.status','delivered'"))->toBeFalse(
            basename($relativa).' volvió a filtrar por el literal. `delivered` es solo el PRIMERO de los '
            .'cuatro estados en los que una carga está entregada, y desde que facturar la mueve sola esa '
            .'consulta pierde cargas de vista.'
        );

        expect(str_contains($codigo, "'status','delivered'"))->toBeFalse(
            basename($relativa).' volvió a filtrar por el literal.'
        );
    }
});

it('liquidar al transportista no depende de lo que le hayamos facturado', function (): void {
    // Al transportista se le paga por haber llevado la carga. Los cuatro
    // estados posteriores a la entrega valen; si esta lista se estrecha, una
    // carga cobrada desaparece de la pantalla de liquidar y es dinero que se
    // le debe a alguien y ya no se ve.
    expect(LoadStatus::delivered())->toBe(['delivered', 'pod_received', 'invoiced', 'paid']);
});

/* ── Lo que la pantalla enseña ───────────────────────────────────────────── */

it('el origen del historial se traduce, no se pinta en crudo', function (): void {
    $pantalla = (string) file_get_contents(raizFacturacionDeCarga().'/resources/js/pages/App/Loads/Show.tsx');

    expect(str_contains($pantalla, '` · ${h.source}`'))->toBeFalse(
        'La ficha volvió a pintar el origen en crudo. La rama era inalcanzable mientras nada escribía un '
        .'origen distinto de «user»; ahora que facturar mueve la carga sola, en pantalla se lee «system_job».'
    );

    expect(str_contains($pantalla, 'loads.detail.source.'))->toBeTrue();
});

it('hay rótulo para cada origen que el esquema admite', function (): void {
    $esquema = (string) file_get_contents(
        raizFacturacionDeCarga().'/database/schema/04_loads_routes_permits_tables.sql'
    );

    preg_match(
        '/constraint chk_load_status_history_source check \(source in \(([^)]*)\)/',
        $esquema,
        $coincidencias
    );

    expect($coincidencias)->not->toBeEmpty('No se encontró el CHECK de `load_status_history.source`.');

    preg_match_all("/'([a-z_]+)'/", $coincidencias[1], $valores);

    foreach (['en', 'es'] as $idioma) {
        $diccionario = json_decode(
            (string) file_get_contents(raizFacturacionDeCarga()."/lang/{$idioma}/loads.json"),
            true
        );

        foreach ($valores[1] as $valor) {
            expect($diccionario['detail']['source'][$valor] ?? null)->not->toBeNull(
                "Falta el rótulo «{$valor}» en {$idioma}/loads.json. La pantalla pintaría la clave cruda el "
                .'día que alguien escriba ese origen — que es como se descubrió éste.'
            );
        }
    }
});

it('el nombre de cada estado de carga sale traducido desde el servidor', function (): void {
    // El servidor pedía `nav.status.load.en_route_to_pickup` y el diccionario
    // tiene las claves en camello, así que Laravel devolvía la clave: el
    // mensaje de éxito de cinco de los trece estados decía
    // «nav.status.load.at_pickup» en la pantalla más usada de la aplicación.
    foreach (['en', 'es'] as $idioma) {
        $nav = json_decode((string) file_get_contents(raizFacturacionDeCarga()."/lang/{$idioma}/nav.json"), true);

        foreach (LoadStatus::cases() as $caso) {
            $clave = lcfirst(str_replace(' ', '', ucwords(str_replace('_', ' ', $caso->value))));

            expect($nav['status']['load'][$clave] ?? null)->not->toBeNull(
                "Falta «{$clave}» en {$idioma}/nav.json."
            );
        }
    }

    $codigo = codigoDeFacturacionSinComentarios(
        raizFacturacionDeCarga().'/app/Http/Controllers/App/LoadController.php'
    );

    expect(str_contains($codigo, 'nav.status.load.{$'))->toBeFalse(
        'Volvió la interpolación directa del valor del enum contra un diccionario cuyas claves están en '
        .'camello. Cinco de los trece estados vuelven a enseñar la clave en crudo.'
    );
});
