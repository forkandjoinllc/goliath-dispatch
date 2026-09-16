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
 * Cada portado, con lo que su repaso encontró — y con lo que se puede MEDIR.
 *
 * ## Por qué el repaso dejó de ser prosa
 *
 * Esta lista guardaba una frase por portado, y el guardián comprobaba que la
 * frase existiera y no dijera «pendiente». Lo que no podía comprobar era si
 * seguía siendo VERDAD, y dos de las nueve habían dejado de serlo:
 *
 *  - la de `notification` decía que quedaban DIEZ sucesos por construir y
 *    nombraba `document.rejected` como «el más caro». Hoy quedan siete:
 *    `document.rejected`, `expense.rejected` y `onboarding.corrections_required`
 *    entraron en `Events::CATALOGO` en lotes posteriores;
 *  - la de `document` decía que «el único tipo suyo que sigue sin construir es
 *    `invoice`». Hoy los veintisiete están en `Documents\DocumentTypes`.
 *
 * Las dos se quedaron obsoletas del modo peor: **por haber hecho el trabajo que
 * describían**. Quien las lea hoy sale creyendo que hay tarea donde no la hay,
 * y —más caro— deja de leer el portado porque el repaso ya está escrito.
 *
 * Y estaba diagnosticado. `Leads\Arrival` lo dejó escrito hace lotes, después
 * de que ese mismo portado pagara por segunda vez:
 *
 * > Un repaso que se queda a medias parece un repaso hecho.
 *
 * ## Qué declara ahora cada entrada
 *
 *  - `resumen`  — la prosa, que sigue siendo lo útil de leer.
 *  - `contra`   — los espacios VIVOS contra los que se repasó. Escribirlo es lo
 *                 que arregla el fallo que este fichero ya confesaba: la
 *                 comprobación emparejaba `X` con `Xs` y nada más, y por eso
 *                 `finance` —repartido en seis espacios que no se llaman
 *                 «finances»— pasó de largo diciendo que estaba repasado.
 *  - `solape`   — las claves que el portado y esos vivos comparten HOY, contadas
 *                 y recalculadas. Si alguien se lleva texto de un lado al otro,
 *                 el número cambia y el repaso hay que rehacerlo.
 *  - `medidas`  — opcional: las afirmaciones concretas, recalculadas contra el
 *                 símbolo que las decide. Es lo que impide que un repaso siga
 *                 diciendo que falta algo que ya se construyó.
 *
 * @var array<string, array{resumen: string, contra: list<string>, solape: int, medidas?: list<array{que: string, seccion: string, profundidad: int, contra: string, faltan: list<string>}>}>
 */
const PORTADOS_REPASADOS = [
    'assignment' => [
        'resumen' => 'Repasado: sin solape material. Sus 60 claves describen la misma pantalla que `assignments` ya construyó —bolsas, grupos y la exclusividad de Administrador—, con otra redacción.',
        'contra' => ['assignments'],
        'solape' => 4,
    ],

    'carrier' => [
        'resumen' => 'Repasado: sin una sola clave en común con lo construido. Lo único suyo que no está es `compliance.ocrFailed` («no se pudo escanear el certificado de seguro para confirmar este VIN»), que describe un OCR que no existe — ver `Equipment\Verification`, que lo dice con todas las letras.',
        'contra' => ['carriers', 'onboarding'],
        'solape' => 0,
    ],

    'customer' => [
        'resumen' => 'Repasado: sin solape material. `customers` cubre su vocabulario; lo suyo aparte son estados de carga de pantalla (cargando, error, sin permiso) que este cliente resuelve de otra manera.',
        'contra' => ['customers'],
        'solape' => 4,
    ],

    'document' => [
        'resumen' => 'Repasado: no queda NINGÚN tipo suyo por construir — los veintisiete están en `Documents\DocumentTypes`. El repaso anterior decía que faltaba `invoice` como documento de la carga, y para cuando alguien volvió a leerlo ya se había construido: es el caso que hizo que estas entradas dejaran de ser prosa.',
        'contra' => ['documents'],
        'solape' => 29,
        'medidas' => [
            [
                'que' => 'tipos de documento que el portado nombra y la aplicación no admite',
                'seccion' => 'types',
                'profundidad' => 1,
                'contra' => 'App\Support\Documents\DocumentTypes',
                'faltan' => [],
            ],
        ],
    ],

    'driver' => [
        'resumen' => 'Repasado: de `driver.json` se adoptaron las TRES tablas de la licencia —clase, endosos y restricciones— con su nombre en los dos idiomas. La pantalla enseñaba letras sueltas («H, N, T») y las restricciones no salían en ningún sitio. Lo demás describe dominios sin construir: portal del conductor, relación con varios transportistas, revisión de licencia.',
        'contra' => ['drivers'],
        'solape' => 22,
    ],

    'finance' => [
        'resumen' => 'Repasado (era el mayor y el que nadie había mirado). Lo suyo que NO está construido, por orden de peso: (1) el ESTADO DE CUENTA del transportista —un registro continuo de liquidaciones emitidas contra facturas cobradas, con saldo acumulado—, que es lo que daría sentido al método de pago «compensación contra liquidación», hoy anotable pero sin nada al otro lado; (2) las clases de línea de factura `expense`, `adjustment` y `credit` —`InvoiceBuilder` solo escribe `dispatch_fee` y `adjustments_cents` se escribe siempre en cero, así que no hay forma de emitir una nota de crédito salvo anular y rehacer—; (3) el PDF: la factura sale por correo como enlace, sin adjunto, y de la liquidación no se genera ninguno. Ver `docs/ported-dictionaries.md`.',
        // Seis espacios, y NINGUNO se llama «finances»: es exactamente por esto
        // que la comparación dejó de deducirse del nombre.
        'contra' => ['invoices', 'payments', 'expenses', 'settlements', 'commissions', 'factoring'],
        'solape' => 2,
    ],

    'load' => [
        'resumen' => 'Repasado: sin solape material. Sus tipos de documento ya están en `DocumentTypes`. Lo suyo sin construir son cuatro VISTAS de la lista de cargas —tablero, calendario, mapa y línea de tiempo—, cada una con su estado vacío.',
        'contra' => ['loads'],
        'solape' => 10,
    ],

    'notification' => [
        'resumen' => 'Repasado: se adoptó `document.expired` como suceso aparte de `document.expiring`, y después `document.rejected`, `expense.rejected` y `onboarding.corrections_required`. Quedan SIETE sucesos que el original mandaba y este no. La lista vive abajo, medida contra `Events::CATALOGO`, para que construir uno obligue a encogerla en vez de dejar el repaso mintiendo — que es lo que pasó con los tres anteriores.',
        'contra' => ['notifications'],
        'solape' => 19,
        'medidas' => [
            [
                'que' => 'sucesos que el original mandaba y este no',
                'seccion' => 'events',
                'profundidad' => 2,
                'contra' => 'App\Support\Notifications\Events',
                'faltan' => [
                    'export.ready',
                    'invoice.sent',
                    'load.assigned',
                    'load.rate_confirmation_requested',
                    'onboarding.approved',
                    'onboarding.rejected',
                    'signature.requested',
                ],
            ],
        ],
    ],

    'report' => [
        'resumen' => 'Repasado: sin una sola clave en común. Describe un selector con cinco informes con nombre que no existen; `reports.json` es otro producto —el informe por periodo— y no toma nada de él.',
        'contra' => ['reports'],
        'solape' => 0,
    ],
];

/**
 * Las claves hoja de un espacio del diccionario, en rutas con punto.
 *
 * @return list<string>
 */
function clavesDe(string $espacio): array
{
    return clavesDeFichero(dirname(__DIR__, 3)."/lang/es/{$espacio}.json");
}

/**
 * Las claves hoja de un fichero de diccionario, en rutas con punto.
 *
 * Vive aquí y no se toma prestada de `PluralTest`: un ayudante global de Pest
 * solo existe si el fichero que lo declara se ha cargado, así que este
 * guardián no podía ejecutarse solo. Un guardián que depende del orden es un
 * guardián que un día no corre y nadie lo nota.
 *
 * @return list<string>
 */
function clavesDeFichero(string $ruta): array
{
    if (! is_file($ruta)) {
        return [];
    }

    $aplanar = static function (array $nodo, string $prefijo) use (&$aplanar): array {
        $salida = [];

        foreach ($nodo as $clave => $valor) {
            $camino = $prefijo === '' ? (string) $clave : $prefijo.'.'.$clave;

            if (is_array($valor)) {
                $salida = [...$salida, ...$aplanar($valor, $camino)];

                continue;
            }

            $salida[] = $camino;
        }

        return $salida;
    };

    return $aplanar((array) json_decode((string) file_get_contents($ruta), true), '');
}

/**
 * Los nombres que una sección del portado enumera.
 *
 * `profundidad` dice cuántos segmentos forman el nombre: los tipos de documento
 * son `types.pod` —uno— y los sucesos son `events.document.expired.title` —dos,
 * porque el último segmento es `title` o `body`.
 *
 * @return list<string>
 */
function nombresDe(string $portado, string $seccion, int $profundidad): array
{
    $salida = [];

    foreach (clavesDe($portado) as $clave) {
        if (! str_starts_with($clave, $seccion.'.')) {
            continue;
        }

        $resto = explode('.', substr($clave, strlen($seccion) + 1));

        if (count($resto) >= $profundidad) {
            $salida[implode('.', array_slice($resto, 0, $profundidad))] = true;
        }
    }

    $nombres = array_keys($salida);
    sort($nombres);

    return $nombres;
}

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

    foreach (PORTADOS_REPASADOS as $portado => $entrada) {
        $resumen = $entrada['resumen'];

        if (preg_match('/pendiente/iu', $resumen) === 1 || mb_strlen($resumen) < 90) {
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

it('cada repaso dice contra QUÉ se comparó, y esos espacios existen', function () {
    // El fallo que este fichero ya confesaba: la comparación se deducía del
    // nombre —`X` contra `Xs`— y `finance`, repartido en seis espacios que no se
    // llaman «finances», no se comparaba con nada. Ahora se escribe.
    foreach (PORTADOS_REPASADOS as $portado => $entrada) {
        expect($entrada['contra'])->not->toBe([], "«{$portado}» no dice contra qué se repasó");

        foreach ($entrada['contra'] as $vivo) {
            assertContains(
                $vivo,
                espaciosAlcanzables(),
                "«{$portado}» dice haberse comparado con «{$vivo}», que ninguna pantalla carga",
            );
        }
    }
});

it('el solape declarado es el que hay hoy', function () {
    // La medida uniforme, y la que caza que alguien se lleve texto del portado
    // al vivo sin volver a repasarlo: el número cambia y el repaso caduca.
    foreach (PORTADOS_REPASADOS as $portado => $entrada) {
        $suyas = clavesDe($portado);
        $vivas = [];

        foreach ($entrada['contra'] as $vivo) {
            $vivas = [...$vivas, ...clavesDe($vivo)];
        }

        $comun = array_values(array_intersect($suyas, array_unique($vivas)));

        expect(count($comun))->toBe(
            $entrada['solape'],
            "«{$portado}» declara {$entrada['solape']} claves en común y hoy hay ".count($comun).
            ".\nSi se adoptó texto del portado, el repaso hay que rehacerlo — y luego poner el número nuevo.",
        );
    }
});

it('lo que un repaso dice que falta, sigue faltando', function () {
    // ESTE ES EL FALLO. `notification` decía que quedaban DIEZ sucesos y hoy
    // quedan siete; `document` decía que faltaba el tipo `invoice` y hoy están
    // los veintisiete. Las dos se quedaron obsoletas por haber hecho el trabajo
    // que describían, y nadie se enteró porque el guardián solo miraba que la
    // frase existiera.
    $raiz = dirname(__DIR__, 3);

    foreach (PORTADOS_REPASADOS as $portado => $entrada) {
        foreach ($entrada['medidas'] ?? [] as $medida) {
            $fuente = (string) file_get_contents(
                $raiz.'/app/'.str_replace('\\', '/', substr($medida['contra'], strlen('App\\'))).'.php'
            );

            $nombres = nombresDe($portado, $medida['seccion'], $medida['profundidad']);

            expect($nombres)->not->toBe([], "«{$portado}.{$medida['seccion']}» no enumera nada: la medida no mide");

            $faltan = array_values(array_filter(
                $nombres,
                static fn (string $n): bool => ! str_contains($fuente, "'{$n}'"),
            ));

            expect($faltan)->toBe($medida['faltan'], implode("\n", [
                "«{$portado}»: {$medida['que']}.",
                'Declarado: '.(implode(', ', $medida['faltan']) ?: '(nada)'),
                'Hoy:       '.(implode(', ', $faltan) ?: '(nada)'),
                '',
                'Si se construyó alguno, encoja la lista. Un repaso que se queda a',
                'medias parece un repaso hecho.',
            ]));
        }
    }
});

it('al menos un repaso se mide, y no solo se cuenta', function () {
    // El solape es uniforme y barato, y por eso solo no basta: dos ficheros
    // pueden no compartir ninguna clave y aun así describir lo mismo. Las
    // medidas son las que comprueban una afirmación concreta, y tiene que
    // haberlas.
    $conMedida = array_values(array_filter(
        array_keys(PORTADOS_REPASADOS),
        static fn (string $p): bool => (PORTADOS_REPASADOS[$p]['medidas'] ?? []) !== [],
    ));

    expect(count($conMedida))->toBeGreaterThanOrEqual(2);
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

        $ke = clavesDeFichero($en);
        $ks = clavesDeFichero($es);

        $diferencia = array_merge(
            array_diff($ke, $ks),
            array_diff($ks, $ke),
        );

        if ($diferencia !== []) {
            $rotos[] = "{$portado}: ".implode(', ', array_slice($diferencia, 0, 5));
        }
    }

    expect($rotos)->toBe([]);
});
