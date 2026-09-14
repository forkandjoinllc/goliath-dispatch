<?php

declare(strict_types=1);

use function PHPUnit\Framework\assertContains;

/**
 * Los diccionarios PORTADOS son documentación, no relleno.
 *
 * El puerto trajo un diccionario por dominio en singular —`document.json`,
 * `load.json`, `notification.json`, `tracking.json`, `oversize.json`,
 * `signature.json`…— con el vocabulario completo de la aplicación original en
 * los dos idiomas. Ningún controlador los declara: a medida que se construye
 * cada dominio se escribe uno nuevo en plural (`documents.json`, `loads.json`)
 * con lo que esa pantalla necesita.
 *
 * Esa convención está bien y no se cambia. Lo que sí cuesta caro es que nadie
 * mire el portado antes de escribir el nuevo: al construir los avisos escribí
 * `notifications.json` desde cero mientras `notification.json` ya traía el
 * catálogo entero de sucesos en los dos idiomas —incluido `document.expired`
 * como suceso APARTE de `document.expiring`, que es exactamente el matiz que se
 * me escapó y que dejó un aviso diciendo «renuévelo antes de que venza» sobre un
 * documento ya caducado.
 *
 * Los portados son, en la práctica, media especificación de los dominios que
 * faltan: `tracking` trae 191 claves, `oversize` 172 y `signature` 161. Quien
 * construya esos dominios debería leerlas primero.
 *
 * Esta prueba no impide duplicar —a veces es lo correcto— sino que lo hace
 * VISIBLE: si aparece un plural nuevo cuyo singular portado existe y no está
 * declarado en la lista de abajo, falla y obliga a mirar el portado y a dejar
 * dicho qué se tomó de él.
 */

/**
 * Qué espacios del diccionario puede cargar ALGUNA pantalla.
 *
 * Se deduce del código y no se escribe a mano. La lista escrita a mano es
 * exactamente el motivo por el que `finance.json` —el portado mayor, 382
 * claves— pasó desapercibido: esta prueba emparejaba `X` con `Xs`, su dominio
 * se construyó repartido en seis espacios que no se llaman «finances», y por
 * tanto decía que todo estaba repasado.
 *
 * Tres formas de llegar a un espacio, y las tres cuentan:
 *
 *  - que un controlador lo declare con `usesDictionary()` —o que lo declare
 *    `Dictionary::ALWAYS` / `AUTHENTICATED`, que viajan con todas las páginas—;
 *  - que el SERVIDOR lo lea con `__('espacio.…')`, que es como salen los
 *    correos y los mensajes de error;
 *  - que el cliente lo cite con `t('espacio.…')`, incluida la forma con
 *    plantilla —``t(`${root}.title`)``— por su raíz.
 *
 * @return list<string>
 */
function espaciosAlcanzables(): array
{
    $raiz = dirname(__DIR__, 3);

    $php = '';

    foreach ([$raiz.'/app', $raiz.'/routes', $raiz.'/database'] as $dir) {
        foreach (rglob($dir, 'php') as $f) {
            $php .= file_get_contents($f);
        }
    }

    $tsx = '';

    foreach ([...rglob($raiz.'/resources/js', 'tsx'), ...rglob($raiz.'/resources/js', 'ts')] as $f) {
        $tsx .= file_get_contents($f);
    }

    return espaciosEnFuente($php, $tsx);
}

/**
 * Las tres formas de llegar a un espacio, sobre el texto que se le dé.
 *
 * Separada de la de arriba —que lee el disco— para que cada una de las tres
 * PATAS se pueda comprobar con un texto de mentira. Sin eso, la pata del
 * servidor no la sujetaba nada: hoy todos los espacios llegan además por otra
 * vía, así que romperla no ponía nada en rojo y el guardián parecía completo.
 * Lo enseñó un sabotaje que la borró entera y salió verde.
 *
 * @return list<string>
 */
function espaciosEnFuente(string $php, string $tsx): array
{
    $vistos = [];

    // 1. Declarados por una pantalla, o presentes en todas.
    preg_match_all('/usesDictionary\(\s*\$request\s*,\s*\[(.*?)\]/s', $php, $m);
    preg_match_all("/set\('dictionaryNamespaces',\s*\[(.*?)\]/s", $php, $m2);
    preg_match_all('/const (?:ALWAYS|AUTHENTICATED) = \[(.*?)\];/s', $php, $m3);
    preg_match_all('/\$namespaces\s*=\s*\[(.*?)\]/s', $php, $m4);

    foreach ([...$m[1], ...$m2[1], ...$m3[1], ...$m4[1]] as $trozo) {
        preg_match_all("/'([\w-]+)'/", $trozo, $nombres);
        $vistos = [...$vistos, ...$nombres[1]];
    }

    // 2. Leídos por el servidor: los correos y los mensajes de error.
    preg_match_all('/(?:__|linea)\(\s*[\x27"]([\w-]+)\./', $php, $m5);
    $vistos = [...$vistos, ...$m5[1]];

    // 3. Citados por el cliente, enteros o por su raíz.
    preg_match_all('/t\(\s*[\x27"`]([\w-]+)\./', $tsx, $m6);
    preg_match_all('/root=["\x27{`]?([\w-]+)\./', $tsx, $m7);
    $vistos = [...$vistos, ...$m6[1], ...$m7[1]];

    sort($vistos);

    return array_values(array_unique($vistos));
}

/** @return list<string> */
function rglob(string $dir, string $ext): array
{
    if (! is_dir($dir)) {
        return [];
    }

    $salida = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));

    foreach ($it as $f) {
        if ($f->isFile() && $f->getExtension() === $ext) {
            $salida[] = $f->getPathname();
        }
    }

    return $salida;
}

/**
 * Los portados: los que existen y NINGUNA pantalla puede cargar.
 *
 * @return list<string>
 */
function diccionariosPortados(): array
{
    $raiz = dirname(__DIR__, 3);
    $alcanzables = espaciosAlcanzables();
    $portados = [];

    foreach (glob($raiz.'/lang/es/*.json') ?: [] as $ruta) {
        $n = basename($ruta, '.json');

        if (! in_array($n, $alcanzables, true)) {
            $portados[] = $n;
        }
    }

    sort($portados);

    return $portados;
}

/**
 * Cada portado, con lo que su repaso encontró.
 *
 * No es «pendiente» ni «sin solape»: es qué trae ese portado que aquí no está,
 * porque de eso se trata. Un portado repasado bien paga —de `notification.json`
 * salió que `document.expired` es un suceso APARTE de `document.expiring`, y
 * eso arregló un aviso que decía «renuévelo antes de que venza» sobre un
 * documento ya caducado—.
 *
 * @var array<string, string>
 */
const PORTADOS_REPASADOS = [
    'assignment' => 'Repasado: sin solape. Sus 60 claves describen la misma pantalla que `assignments` ya construyó —bolsas, grupos y la exclusividad de Administrador—, con otra redacción.',

    'carrier' => 'Repasado: sin solape material. Lo único suyo que no está construido es `compliance.ocrFailed` («no se pudo escanear el certificado de seguro para confirmar este VIN»), que describe un OCR que no existe — ver `Equipment\Verification`, que lo dice con todas las letras.',

    'customer' => 'Repasado: sin solape. `customers` cubre su vocabulario; lo suyo aparte son estados de carga de pantalla (cargando, error, sin permiso) que este cliente resuelve de otra manera.',

    'document' => 'Repasado: no queda nada suyo por adoptar. Sus tipos de documento ya se adoptaron en su día —`escort_document` y `route_survey` entraron en `Documents\DocumentTypes` desde `Oversize\Papers`, y la propia clase lo dice—. El único tipo suyo que sigue sin construir es `invoice` como documento de la carga.',

    'driver' => 'Repasado: de `driver.json` se adoptaron las TRES tablas de la licencia —clase, endosos y restricciones— con su nombre en los dos idiomas. La pantalla enseñaba letras sueltas («H, N, T») y las restricciones no salían en ningún sitio. Lo demás describe dominios sin construir: portal del conductor, relación con varios transportistas, revisión de licencia.',

    'finance' => 'Repasado (era el mayor y el que nadie había mirado). Lo suyo que NO está construido, por orden de peso: (1) el ESTADO DE CUENTA del transportista —un registro continuo de liquidaciones emitidas contra facturas cobradas, con saldo acumulado—, que es lo que daría sentido al método de pago «compensación contra liquidación», hoy anotable pero sin nada al otro lado; (2) las clases de línea de factura `expense`, `adjustment` y `credit` —`InvoiceBuilder` solo escribe `dispatch_fee` y `adjustments_cents` se escribe siempre en cero, así que no hay forma de emitir una nota de crédito salvo anular y rehacer—; (3) el PDF: la factura sale por correo como enlace, sin adjunto, y de la liquidación no se genera ninguno. Ver `docs/ported-dictionaries.md`.',

    'load' => 'Repasado: sin solape material. Sus tipos de documento ya están en `DocumentTypes`. Lo suyo sin construir son cuatro VISTAS de la lista de cargas —tablero, calendario, mapa y línea de tiempo—, cada una con su estado vacío.',

    'notification' => 'Repasado: se adoptó `document.expired` como suceso aparte de `document.expiring`. Lo que queda son DIEZ sucesos que el original mandaba y este no: document.rejected, expense.rejected, export.ready, invoice.sent, load.assigned, load.rate_confirmation_requested, onboarding.approved, onboarding.corrections_required, onboarding.rejected y signature.requested. El más caro es `document.rejected` — ver `docs/ported-dictionaries.md`.',

    'report' => 'Repasado: describe un selector con cinco informes con nombre que no existen. `reports.json` es otro producto —el informe por periodo— y no toma nada de él.',
];

it('todo diccionario portado tiene su repaso escrito', function () {
    // Antes esta comprobación emparejaba `X` con `Xs` y nada más. Un portado
    // cuyo dominio se construyó con otro nombre no se comparaba con nada, y así
    // es como el mayor de todos —`finance.json`— pasó de largo mientras la
    // prueba decía que estaba todo repasado.
    $sinRepasar = array_values(array_diff(diccionariosPortados(), array_keys(PORTADOS_REPASADOS)));

    sort($sinRepasar);

    expect($sinRepasar)->toBe([], implode("\n", [
        'Diccionarios que ninguna pantalla puede cargar y que nadie ha repasado:',
        ...$sinRepasar,
        '',
        'Un portado es media especificación del dominio que falta. Léalo, y luego',
        'añádalo a PORTADOS_REPASADOS diciendo QUÉ TRAE que aquí no está.',
    ]));
});

it('el repaso dice qué trae el portado, no que esté pendiente', function () {
    // La salida fácil es escribir «pendiente de repasar» y seguir. Cuatro
    // entradas lo dijeron durante meses, y una quinta lo decía en mayúsculas.
    $flojos = [];

    foreach (PORTADOS_REPASADOS as $portado => $repaso) {
        if (preg_match('/pendiente/iu', $repaso) === 1 || mb_strlen($repaso) < 90) {
            $flojos[] = $portado;
        }
    }

    expect($flojos)->toBe([], implode("\n", [
        'Estos repasos no dicen nada:',
        ...$flojos,
        '',
        'Un repaso escrito es lo que trae ese portado y aquí no está — o que no',
        'trae nada, dicho con lo que se comparó.',
    ]));
});

it('el registro no nombra portados que ya no existen', function () {
    $raiz = dirname(__DIR__, 3);

    $fantasmas = array_values(array_filter(
        array_keys(PORTADOS_REPASADOS),
        static fn (string $p): bool => ! is_file($raiz."/lang/es/{$p}.json"),
    ));

    expect($fantasmas)->toBe([], 'Repasados que ya no existen: '.implode(', ', $fantasmas));
});

it('el detector encuentra un espacio por cada una de sus tres vías', function (string $via, string $php, string $tsx, string $esperado) {
    // Con texto de mentira, para que cada pata se sostenga sola. La del
    // servidor no la sujetaba nada: todos los espacios reales llegan además
    // por otra vía, así que borrarla salía verde.
    // `assertContains($aguja, $pajar, $mensaje)` y NO
    // `toContain($aguja, $mensaje)`: el segundo argumento de `toContain` es
    // OTRA AGUJA que se busca también, no el mensaje de fallo. Cuarta vez que
    // caigo en esta familia, y la primera en la que las cuatro pruebas
    // fallaron a la vez buscando el texto del mensaje dentro del array.
    assertContains($esperado, espaciosEnFuente($php, $tsx), "la vía «{$via}» dejó de encontrarse");
})->with([
    ['pantalla', "\$this->usesDictionary(\$request, ['bascula', 'common']);", '', 'bascula'],
    ['servidor', "__('remesas.correo.asunto', [], \$locale)", '', 'remesas'],
    ['cliente', '', "t('aduana.detail.title')", 'aduana'],
    ['cliente por raíz', '', '<LegalDocument root="tarifas.privacy" />', 'tarifas'],
]);

it('un portado deja de serlo en cuanto una pantalla lo carga', function () {
    // La otra mitad del detector: que no marque como portado algo que sí se
    // usa. Si esto fallara, el registro se llenaría de espacios vivos y el
    // guardián dejaría de decir nada.
    $alcanzables = espaciosAlcanzables();

    foreach (['loads', 'invoices', 'expenses', 'marketing', 'common', 'platform'] as $vivo) {
        expect($alcanzables)->toContain($vivo);
        expect(diccionariosPortados())->not->toContain($vivo);
    }

    // Y que el detector no se quede corto: los nueve portados conocidos siguen
    // saliendo. Si alguien construye uno de esos dominios con ese nombre, esta
    // lista cambia y el registro lo acusa.
    expect(diccionariosPortados())->toBe([
        'assignment', 'carrier', 'customer', 'document', 'driver',
        'finance', 'load', 'notification', 'report',
    ]);
});

it('los diccionarios portados siguen completos en los dos idiomas', function () {
    // Son la referencia de los dominios que faltan. Si uno se queda a medias en
    // un idioma, el día que se construya ese dominio se descubre tarde.
    $raiz = dirname(__DIR__, 3);
    $rotos = [];

    foreach (diccionariosPortados() as $portado) {
        $en = $raiz."/lang/en/{$portado}.json";
        $es = $raiz."/lang/es/{$portado}.json";

        if (! is_file($en) || ! is_file($es)) {
            $rotos[] = "{$portado}: falta un idioma";

            continue;
        }

        $ke = aplanarClaves(json_decode((string) file_get_contents($en), true, flags: JSON_THROW_ON_ERROR));
        $ks = aplanarClaves(json_decode((string) file_get_contents($es), true, flags: JSON_THROW_ON_ERROR));

        $diferencia = array_merge(
            array_diff(array_keys($ke), array_keys($ks)),
            array_diff(array_keys($ks), array_keys($ke)),
        );

        if ($diferencia !== []) {
            $rotos[] = "{$portado}: ".implode(', ', array_slice($diferencia, 0, 5));
        }
    }

    expect($rotos)->toBe([]);
});
