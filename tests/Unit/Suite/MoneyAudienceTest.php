<?php

declare(strict_types=1);

use App\Authorization\RoleMatrix;
use App\Support\Finance\MoneyAudience;
use App\Support\Privacy\Internal;
use Tests\Support\Source;

use function PHPUnit\Framework\assertArrayNotHasKey;
use function PHPUnit\Framework\assertSame;
use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertTrue;

/**
 * El margen de la casa no sale de la casa.
 *
 * ## El defecto
 *
 * `load:financials:read` era una puerta de sí o no: quien la pasaba recibía las
 * diecinueve cifras del reparto. El rol TRANSPORTISTA tiene ese permiso —con
 * alcance propio, porque necesita ver su liquidación— así que abría su carga en
 * el portal y leía, en la misma tarjeta, lo que la casa le cobra al cliente, el
 * margen bruto, la comisión del despachador y el margen neto.
 *
 * Lo mismo en el listado de cargas (la columna del cobro al cliente) y en el
 * informe del periodo, que estrechaba las FILAS por transportista desde siempre
 * y no las COLUMNAS: margen por transportista, cobro y margen por cliente, el
 * total de arriba y lo que la casa absorbe en gastos.
 *
 * ## Por qué es un defecto y no una decisión
 *
 * Porque la regla estaba escrita, con nombre y con su motivo, en
 * `App\Support\Privacy\Internal`:
 *
 * > No es un permiso: es de qué lado de la mesa está quien mira. Un permiso se
 * > puede conceder; el lado de la mesa no.
 *
 * Aplicada a dos campos de TEXTO —las notas del transportista y las notas
 * internas de la carga— y nunca al dinero, que es el secreto más grande de los
 * tres. Y escrita una segunda vez en `PeriodReport::commissionsByDispatcher()`,
 * que devuelve lista vacía fuera de la casa, en el mismo fichero cuyo
 * `byCarrier()` mandaba el margen sin mirar a quién.
 *
 * ## Lo que vigila este fichero
 *
 * Que cada cifra del reparto esté clasificada —ninguna se cuela por omisión—,
 * que la frontera se le siga preguntando a `Internal` y no se reimplemente, que
 * las superficies pasen por el registro, y que la deuda declarada de la
 * exportación siga siendo cierta.
 *
 * Lo que MIDE es `tests/Feature/Finance/MoneyAudienceTest.php`.
 */
function raizDinero(): string
{
    return Source::root();
}

/** Las claves que `LoadController::financials()` construye, leídas del fichero. */
function cifrasDelReparto(): array
{
    $fuente = Source::sinComentarios(raizDinero().'/app/Http/Controllers/App/LoadController.php');

    $ini = strpos($fuente, 'MoneyAudience::filtra([');
    $fin = strpos($fuente, '], $actor);', (int) $ini);

    expect($ini)->not->toBeFalse('`financials()` ya no arma el reparto con MoneyAudience::filtra');

    preg_match_all(
        "/'([a-zA-Z]+)' =>/",
        substr($fuente, (int) $ini, (int) $fin - (int) $ini),
        $coincidencias,
    );

    return $coincidencias[1];
}

it('cada cifra del reparto está clasificada, y en un solo lado', function (): void {
    $cifras = cifrasDelReparto();
    $declaradas = [...array_keys(MoneyAudience::DEL_TRANSPORTISTA), ...array_keys(MoneyAudience::SOLO_LA_CASA)];

    sort($cifras);
    sort($declaradas);

    // La comprobación que da sentido a todo lo demás. Una cifra nueva que nadie
    // clasifique se iría con el reparto entero —que es EXACTAMENTE cómo llegó
    // aquí el margen— y ahora pone la suite en rojo el día que se escribe.
    assertSame($declaradas, $cifras, 'hay una cifra del reparto sin clasificar, o clasificada y ya no existe');

    // Y en un solo lado: una cifra en las dos listas se leería como que es de
    // los dos, y `filtra()` la dejaría pasar.
    assertSame([], array_intersect_key(MoneyAudience::DEL_TRANSPORTISTA, MoneyAudience::SOLO_LA_CASA));
});

it('cada cifra dice por qué está donde está', function (): void {
    foreach ([...MoneyAudience::DEL_TRANSPORTISTA, ...MoneyAudience::SOLO_LA_CASA] as $cifra => $motivo) {
        // Una lista de nombres sin motivos se convierte en una lista que nadie
        // se atreve a tocar porque nadie sabe por qué está así.
        expect(strlen($motivo))->toBeGreaterThan(30, "la cifra «{$cifra}» no dice por qué");
    }

    foreach (MoneyAudience::INFORME_SOLO_LA_CASA as $columna => $motivo) {
        expect(strlen($motivo))->toBeGreaterThan(20, "la columna «{$columna}» no dice por qué");
    }
});

it('la frontera se le pregunta a Internal, no se vuelve a escribir', function (): void {
    $fuente = Source::compacta(raizDinero().'/app/Support/Finance/MoneyAudience.php');

    // Dos sitios contestando «¿es de la casa?» acaban contestando distinto, y el
    // día que pase lo que se descuadra es quién ve un margen.
    expect($fuente)->toContain('Internal::esEquipo($actor)');

    // Ni por rol a mano ni por alcance: las dos son la misma copia con otra
    // ropa. `Internal` ya razona por qué se decide por rol.
    expect($fuente)->not->toContain('Role::Carrier');
    expect($fuente)->not->toContain('Scope::');
});

it('las cuatro superficies pasan por el registro', function (): void {
    $carga = Source::compacta(raizDinero().'/app/Http/Controllers/App/LoadController.php');
    $informe = Source::compacta(raizDinero().'/app/Support/Reports/PeriodReport.php');
    $informes = Source::compacta(raizDinero().'/app/Http/Controllers/App/ReportController.php');

    // 1. La tarjeta de dinero de la ficha.
    expect($carga)->toContain('returnMoneyAudience::filtra([');

    // 2. La columna del listado. Con la cifra nombrada: `$showMoney` a secas era
    //    exactamente lo que dejaba pasar el cobro al cliente.
    expect($carga)->toContain("MoneyAudience::ve(\$actor,'customerCharge')");

    // 3. Las dos tablas del informe y el desglose de gastos.
    expect(substr_count($informe, 'MoneyAudience::filtraInforme('))->toBe(2);
    expect($informe)->toContain('MoneyAudience::filtraTratamientos($totales,$this->actor)');

    // 4. El total de arriba, que se suma de las filas ya filtradas y saldría
    //    CERO —peor que ausente— si no se quitara también aquí.
    expect($informes)->toContain('returnMoneyAudience::filtraInforme([');
});

it('la deuda declarada de la exportación sigue siendo cierta', function (): void {
    // El CSV del informe NO pasa por el registro, a propósito y por escrito: hoy
    // `report:export` no se concede fuera de la casa, y una rama que no se
    // ejecuta nunca se pudre sin avisar. Esto es lo que hace que esa deuda no
    // sea una excusa.
    foreach (Internal::CONTRAPARTES as $rol) {
        $permisos = RoleMatrix::for($rol);

        // `toHaveKey` con un segundo argumento busca una SEGUNDA clave, no
        // escribe un mensaje. Es el error que más veces me ha costado una
        // vuelta; por eso aquí va la aserción de PHPUnit, que sí lo acepta.
        assertArrayNotHasKey(
            'report:export',
            $permisos,
            "el rol {$rol->value} puede exportar: el CSV de informes tiene que pasar por MoneyAudience",
        );
    }

    // Y el comentario que lo declara sigue en su sitio, mandando aquí.
    $fuente = Source::sinComentarios(raizDinero().'/app/Http/Controllers/App/ReportController.php');

    expect($fuente)->not->toContain('MoneyAudience::filtraInforme($informe->byCarrier');
});

it('la pantalla del dinero corta por cifra ausente, no por cero', function (): void {
    $pantalla = (string) file_get_contents(raizDinero().'/resources/js/pages/App/Loads/Show.tsx');

    // `undefined` no es cero: un «$0,00» donde va el margen se lee como un dato,
    // y encima uno falso.
    expect($pantalla)->toContain('valor === undefined ? null :');

    // Las dos cifras finales se pintan por la vía que puede no pintar. Se fija
    // la LLAMADA entera: `grossMargin` a secas seguiría estando en el fichero
    // con la fila incondicional puesta.
    foreach (['grossMargin', 'netMargin'] as $cifra) {
        assertTrue(
            str_contains($pantalla, "{fila('loads.money.{$cifra}', f.{$cifra}"),
            "la fila de {$cifra} volvió a pintarse siempre",
        );
    }

    // Y el tipo declara opcional lo que el servidor puede no mandar. Volverlo
    // obligatorio es la forma cómoda de «arreglar» un error de tsc, y deja la
    // pantalla contando con un número que no llega.
    foreach (array_keys(MoneyAudience::SOLO_LA_CASA) as $cifra) {
        if (! str_contains($pantalla, "  {$cifra}")) {
            continue;
        }

        assertStringContainsString(
            "  {$cifra}?",
            $pantalla,
            "la cifra {$cifra} volvió a ser obligatoria en el tipo",
        );
    }
});

it('el aviso de la comisión huérfana no manda a arreglar a quien no puede', function (): void {
    $pantalla = (string) file_get_contents(raizDinero().'/resources/js/pages/App/Loads/Show.tsx');

    // El lote anterior escribió «Asigne un despachador en el dinero de la
    // carga» y lo pintó sin mirar el permiso. El despachador ve el dinero y no
    // puede tocarlo; al transportista, además, se le pedía que arreglara la
    // nómina de otra empresa.
    expect($pantalla)->toContain("t(canAssignOwner ? 'loads.money.commissionNoOwner' : 'loads.money.commissionNoOwnerReadOnly')");

    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(raizDinero()."/lang/{$idioma}/loads.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        expect($d['money']['commissionNoOwnerReadOnly'] ?? null)->toBeString("falta el aviso de solo lectura en {$idioma}");

        // El de solo lectura NO manda a hacer nada: ese es todo el punto.
        expect(strtolower((string) $d['money']['commissionNoOwnerReadOnly']))
            ->not->toContain($idioma === 'es' ? 'asigne un despachador en' : 'assign a dispatcher in');
    }
});

it('el informe le dice al de fuera de qué informe se trata', function (): void {
    $pantalla = (string) file_get_contents(raizDinero().'/resources/js/pages/App/Reports/Index.tsx');

    // Una tabla a la que le falta una columna, sin una frase, se lee como una
    // pantalla rota.
    expect($pantalla)->toContain("{t('reports.index.basisCarrier')}");
    expect($pantalla)->toContain('const verMargen = summary.marginCents !== undefined');

    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(raizDinero()."/lang/{$idioma}/reports.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        expect($d['index']['basisCarrier'] ?? null)->toBeString("falta la nota en {$idioma}");
    }
});

/* ── Lo pendiente cambia de lado, y eso también estaba a medias ──────────── */

/**
 * Todas las claves que pasan por `filtraInforme()`, vengan de donde vengan.
 *
 * Son TRES sitios y no uno: el resumen de arriba, la tabla por transportista y
 * la tabla por cliente. Leer solo el resumen —que es lo primero que escribí—
 * daba por no clasificada una cifra que sí lo está y por declarada de más otra
 * que vive en otro fichero. Un registro que solo mira una de sus tres puertas
 * mide lo que le apetece.
 *
 * @return list<string>
 */
function cifrasDelInforme(): array
{
    $ficheros = [
        raizDinero().'/app/Http/Controllers/App/ReportController.php',
        raizDinero().'/app/Support/Reports/PeriodReport.php',
    ];

    $cifras = [];
    $puertas = 0;

    foreach ($ficheros as $fichero) {
        $fuente = Source::sinComentarios($fichero);
        $desde = 0;

        while (($ini = strpos($fuente, 'MoneyAudience::filtraInforme([', $desde)) !== false) {
            $fin = strpos($fuente, '], $', $ini);
            $puertas++;

            preg_match_all(
                "/'([a-zA-Z]+)' =>/",
                substr($fuente, $ini, (int) $fin - $ini),
                $coincidencias,
            );

            $cifras = [...$cifras, ...$coincidencias[1]];
            $desde = (int) $fin;
        }
    }

    // Si mañana hay una cuarta puerta, esta cuenta lo dice en vez de dejar sus
    // cifras sin clasificar en silencio.
    expect($puertas)->toBe(3, 'Cambió el número de sitios que filtran cifras del informe: revisa este ayudante.');

    return array_values(array_unique($cifras));
}

it('cada cifra del informe está clasificada, y en un solo sitio', function (): void {
    // ESTE ES EL FALLO. `outstandingCents` no estaba en ninguna lista: no se
    // escondía —y hace bien, el dato es suyo— pero tampoco se declaraba que
    // significa lo contrario para quien lo mira desde fuera. Sin una tercera
    // clase para «esta dice lo mismo para los dos», no había dónde notarlo.
    foreach (cifrasDelInforme() as $cifra) {
        expect(MoneyAudience::claseDeInforme($cifra))->not->toBeNull(
            "{$cifra} no está clasificada: decide si se esconde, si cambia de lado o si dice lo mismo para los dos.",
        );
    }
});

it('ninguna cifra está clasificada dos veces', function (): void {
    $todas = [
        ...array_keys(MoneyAudience::INFORME_SOLO_LA_CASA),
        ...array_keys(MoneyAudience::INFORME_CAMBIA_DE_LADO),
        ...array_keys(MoneyAudience::INFORME_IGUAL_PARA_LOS_DOS),
    ];

    expect(array_unique($todas))->toHaveCount(
        count($todas),
        'Una cifra en dos listas: el orden de las comprobaciones decidiría qué pasa con ella.',
    );
});

it('la clasificación no cuenta cifras que el informe ya no manda', function (): void {
    // Al revés que la de arriba: una lista que reclama algo que no existe se
    // lee como que ese caso está cubierto.
    $mandadas = cifrasDelInforme();

    foreach (['INFORME_SOLO_LA_CASA', 'INFORME_CAMBIA_DE_LADO', 'INFORME_IGUAL_PARA_LOS_DOS'] as $lista) {
        /** @var array<string, string> $entradas */
        $entradas = constant(MoneyAudience::class.'::'.$lista);

        foreach (array_keys($entradas) as $cifra) {
            test()->assertContains(
                $cifra,
                $mandadas,
                "{$lista} declara {$cifra} y el resumen del informe ya no la manda.",
            );
        }
    }
});

it('cada cifra que cambia de lado dice por qué', function (): void {
    foreach (MoneyAudience::INFORME_CAMBIA_DE_LADO as $cifra => $motivo) {
        expect(strlen($motivo))->toBeGreaterThan(
            50,
            "{$cifra}: el motivo tiene que decir qué es para cada lado.",
        );
    }
});

it('el informe pregunta de qué lado se mira en vez de deducirlo', function (): void {
    // Se deducía de que faltara `marginCents`, y con eso solo se decidía
    // enseñar un descargo. Una ausencia no puede elegir un rótulo: si mañana
    // se esconde otra cifra más, la deducción sigue dando lo mismo y el rótulo
    // se queda como estaba.
    $controlador = Source::sinComentarios(raizDinero().'/app/Http/Controllers/App/ReportController.php');

    test()->assertStringContainsString(
        "'audience' => MoneyAudience::de(\$actor)",
        $controlador,
        'El informe no le dice a la pantalla de qué lado mira quien la abre.',
    );

    $pantalla = (string) file_get_contents(raizDinero().'/resources/js/pages/App/Reports/Index.tsx');

    test()->assertStringContainsString(
        "audience !== 'casa'",
        $pantalla,
        'La pantalla no usa la audiencia que el servidor le manda.',
    );
});

it('las cifras que cambian de lado tienen sus dos rótulos en los dos idiomas', function (): void {
    // Una clave que falta no revienta: el traductor devuelve la clave cruda y
    // la pantalla enseña «reports.summary.owed» donde iba una cantidad.
    $parejas = [
        ['summary', 'outstanding', 'owed'],
        ['index', 'subtitle', 'subtitleCarrier'],
        ['aging', 'title', 'titleOwed'],
        ['aging', 'note', 'noteOwed'],
    ];

    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(raizDinero()."/lang/{$idioma}/reports.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        foreach ($parejas as [$seccion, $casa, $transportista]) {
            expect($d[$seccion][$casa] ?? null)->toBeString("falta reports.{$seccion}.{$casa} en {$idioma}");
            expect($d[$seccion][$transportista] ?? null)->toBeString("falta reports.{$seccion}.{$transportista} en {$idioma}");

            // Y que no sean la misma frase: dos claves con el mismo texto es
            // el arreglo aparente — se ve hecho y sigue diciendo lo mismo.
            expect($d[$seccion][$transportista])->not->toBe(
                $d[$seccion][$casa],
                "reports.{$seccion}.{$transportista} dice lo mismo que la de la casa en {$idioma}.",
            );
        }
    }
});

it('la pantalla elige los cuatro rótulos, no solo el del total', function (): void {
    // El total era el más visible, pero debajo hay cinco tramos bajo un título
    // que también dice «cobro», y el subtítulo de la página lo repite.
    $pantalla = (string) file_get_contents(raizDinero().'/resources/js/pages/App/Reports/Index.tsx');

    foreach ([
        "clave('reports.summary.outstanding', 'reports.summary.owed')",
        "clave('reports.index.subtitle', 'reports.index.subtitleCarrier')",
        "clave('reports.aging.title', 'reports.aging.titleOwed')",
        "clave('reports.aging.note', 'reports.aging.noteOwed')",
    ] as $eleccion) {
        test()->assertStringContainsString(
            $eleccion,
            $pantalla,
            "Este rótulo no se elige por audiencia: {$eleccion}",
        );
    }
});
