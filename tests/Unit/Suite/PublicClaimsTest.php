<?php

declare(strict_types=1);

use App\Support\Marketing\PublicClaims;
use Tests\Support\Source;

/**
 * Lo que la página pública promete tiene que existir.
 *
 * ## Por qué esta prueba
 *
 * Las pantallas de dentro las usa quien ya compró y puede comprobarlas. La
 * página pública la lee quien todavía no tiene el producto y no tiene cómo
 * verificar nada.
 *
 * Nunca se habían comprobado. De las 31 afirmaciones con forma de promesa
 * funcional, auditadas una a una contra el código: **cinco ciertas, dos falsas,
 * catorce a medias**.
 */
/**
 * La raíz del repositorio.
 *
 * Con nombre propio y no `raizPromesas()`: ese ya existe en
 * `CarrierPromisesTest`, y dos ficheros de prueba con la misma función global
 * revientan la suite entera con «Cannot redeclare function» — un fallo que NO
 * aparece al ejecutar este fichero solo.
 */
function raizPaginaPublica(): string
{
    return Source::root();
}

/** Lo que hace que una frase de la página suene a promesa de funcionamiento. */
function pareceCompromiso(string $texto): bool
{
    // Las dos lenguas. Con solo las palabras del castellano, un cambio hecho
    // únicamente en la página inglesa se colaba entero — y la página inglesa
    // es la que lee un comprador en Estados Unidos. Un sabotaje que devolvía
    // «escort gate» solo en inglés salió verde por esto.
    return mb_strlen($texto) >= 40 && preg_match(
        '/autom[áa]tic|se verifica|se comprueba|no puede|bloquea|se avisa|marca de agua|cifrad|se guarda|se registra|nunca|siempre|antes de|se ejecuta|se calcul|se evalú|vigila'
        .'|automatic|is checked|are checked|cannot|blocks?\b|watermark|encrypt|is kept|are kept|never|always|before (any|it|we|you)|is verified|are verified|watches|runs? automatically'
        // Verbos de ENTREGA y de BAJA. Sin ellos, la política de privacidad
        // pudo prometer durante meses que responder STOP «suprime de inmediato»
        // el envío de más SMS —sin que exista un solo envío, ni ruta que
        // escuche un STOP— y este guardián la dejó pasar sin pedirle respaldo.
        // El detector es una lista de palabras: lo que no está en la lista no
        // es una promesa PARA ÉL, por mucho que lo sea para quien la lee.
        .'|suprime|de inmediato|al instante|responda [A-Z]{2,}|puede retirar|deja de recibir|se env[íi]a|recibir[áa]|le llega|se manda'
        .'|suppress|immediately|reply [A-Z]{2,}|opt out|opts out|withdraw consent|stops? receiving|is sent|are sent|will receive|we send|we text/iu',
        $texto,
    ) === 1;
}

/**
 * Las afirmaciones funcionales de las páginas vivas.
 *
 * @return array<string, string>
 */
function compromisosPublicos(string $idioma = 'es'): array
{
    $d = json_decode((string) file_get_contents(raizPaginaPublica()."/lang/{$idioma}/marketing.json"), true);

    // Qué secciones pinta de verdad alguna página: una clave que nadie enseña
    // no puede engañar a nadie, y meterla aquí convertiría el registro en un
    // inventario del diccionario en vez de una lista de promesas vivas.
    $paginas = '';

    foreach (glob(raizPaginaPublica().'/resources/js/pages/Marketing/*.tsx') ?: [] as $f) {
        $paginas .= file_get_contents($f);
    }

    foreach (glob(raizPaginaPublica().'/resources/js/components/Marketing/*.tsx') ?: [] as $f) {
        $paginas .= file_get_contents($f);
    }

    $vivas = [];

    $recorrer = function (mixed $nodo, string $ruta) use (&$recorrer, &$vivas, $paginas): void {
        if (is_array($nodo)) {
            foreach ($nodo as $k => $v) {
                $recorrer($v, $ruta === '' ? (string) $k : $ruta.'.'.$k);
            }

            return;
        }

        if (! is_string($nodo) || ! pareceCompromiso($nodo)) {
            return;
        }

        $partes = explode('.', $ruta);

        // Se pinta si la página nombra la clave entera, su sección o su grupo:
        // muchas se arman por bucle sobre una lista de secciones.
        foreach ([$ruta, implode('.', array_slice($partes, 0, 2)), $partes[0]] as $candidata) {
            if ($candidata !== '' && str_contains($paginas, $candidata)) {
                $vivas[$ruta] = $nodo;

                return;
            }
        }
    };

    $recorrer($d, '');

    return $vivas;
}

it('cada promesa de la página pública declara qué la sostiene', function (): void {
    // El hueco por el que entró la primera afirmación falsa: escribir en la
    // página de ventas sin tener que enseñar dónde está cumplida.
    // LAS DOS LENGUAS. Se llamaba sin argumento, así que solo miraba el
    // castellano: una promesa escrita únicamente en la página inglesa —la que
    // lee un comprador en Estados Unidos— no tenía que declarar nada. Las
    // comprobaciones concretas de más abajo ya recorrían los dos idiomas; la
    // del registro, que es la que cierra el hueco general, no.
    $sinDeclarar = array_diff(
        array_merge(array_keys(compromisosPublicos('es')), array_keys(compromisosPublicos('en'))),
        array_keys(PublicClaims::RESPALDOS),
    );

    $sinDeclarar = array_values(array_unique($sinDeclarar));

    sort($sinDeclarar);

    expect($sinDeclarar)->toBe([], implode("\n", [
        'Estas frases de la página pública prometen algo y no dicen qué lo sostiene:',
        ...$sinDeclarar,
        '',
        'Cada una va a PublicClaims::RESPALDOS con la clase que la cumple, o con',
        'PublicClaims::LO_HACE_UNA_PERSONA si describe trabajo humano y no una función.',
    ]));
});

/**
 * Frases que el detector TIENE que reconocer, y frases que no.
 *
 * El detector es una lista de palabras, y una lista de palabras no sabe lo que
 * no está en ella: la política de privacidad prometió durante meses que
 * responder STOP «suprime de inmediato» el envío de más SMS, y este fichero la
 * dejó pasar porque «suprime» no estaba escrito aquí. Ampliar el vocabulario
 * sin dejar constancia de QUÉ tiene que ver deja el mismo agujero abierto para
 * el siguiente que lo recorte.
 *
 * @return array<string, array{0: string, 1: bool}>
 */
function corpusDelDetector(): array
{
    return [
        // Las dos que entraron por el hueco, tal como estaban escritas.
        'STOP en castellano' => ['Puede retirar su consentimiento en cualquier momento respondiendo STOP a cualquier mensaje, lo que suprime de inmediato el envío de más SMS a ese número.', true],
        'STOP en inglés' => ['You may withdraw consent at any time by replying STOP to any message, which immediately suppresses further SMS to that number.', true],
        'entrega del enlace' => ['Una vez despachada su carga, recibirá un enlace seguro por correo electrónico — no un usuario y contraseña.', true],
        'entrega en inglés' => ['Once your load is dispatched, a secure link is sent to you by email instead of a username and password.', true],

        // Las de siempre, para que ampliar no rompa lo que ya veía.
        'bloqueo' => ['El despacho se bloquea automáticamente cuando un documento obligatorio ha caducado, sin excepción para ningún rol.', true],
        'cifrado' => ['Every document is encrypted at rest and access is checked against the role of whoever asks for it.', true],

        // Y lo que NO es una promesa de funcionamiento: si el detector empieza
        // a marcarlo, el registro se llena de ruido y deja de decir nada.
        'descripción de oficio' => ['El transporte sobredimensionado exige planificación, y cada estado publica sus propias reglas de circulación.', false],
        'saludo' => ['Somos una empresa de despacho con base en Texas que trabaja en inglés y en español todos los días del año.', false],
    ];
}

it('el detector reconoce las promesas que una vez se le escaparon', function (): void {
    foreach (corpusDelDetector() as $nombre => [$texto, $esPromesa]) {
        expect(pareceCompromiso($texto))->toBe(
            $esPromesa,
            $esPromesa
                ? "«{$nombre}» es una promesa y el detector no la ve"
                : "«{$nombre}» no promete nada y el detector la marca",
        );
    }
});

it('el registro se calcula con los dos idiomas', function (): void {
    // Se llamaba sin argumento —solo castellano— y una promesa escrita
    // únicamente en la página inglesa no tenía que declarar nada. La página
    // inglesa es la que lee un comprador en Estados Unidos.
    $fuente = Source::compacta(raizPaginaPublica().'/tests/Unit/Suite/PublicClaimsTest.php');

    // La EXPRESIÓN entera, no «que aparezca `compromisosPublicos('en')` en
    // alguna parte del fichero»: con esa aguja floja, esta misma prueba —que
    // lo llama tres líneas más abajo— se sostenía sola. Un sabotaje que
    // devolvía el cálculo al castellano salía verde por eso, y lo enseñó.
    // La aguja se ARMA en dos trozos a propósito. Escrita entera, aparecía
    // literalmente en este fichero —en esta misma línea— y `compacta()`, que
    // quita los espacios, la encontraba en su propio texto: la comprobación se
    // cumplía sola y el sabotaje que devolvía el cálculo al castellano salía
    // verde. Es la segunda vez en este lote que una aguja se autosatisface.
    $aguja = "array_merge(array_keys(compromisosPublicos('es')),"
        ."array_keys(compromisosPublicos('en')))";

    test()->assertStringContainsString(
        $aguja,
        $fuente,
        'el registro de promesas ha vuelto a calcularse con un solo idioma',
    );

    // Y que de verdad saquen listas distintas: si las dos lenguas dieran
    // siempre lo mismo, mirar una sola no habría sido un hueco y esta
    // comprobación no estaría midiendo nada.
    $es = array_keys(compromisosPublicos('es'));
    $en = array_keys(compromisosPublicos('en'));

    expect(array_diff($es, $en) + array_diff($en, $es))->not->toBe([]);
});

it('una promesa funcional no puede declararse texto legal', function (): void {
    // La salida fácil cuando el guardián se pone rojo es declarar la frase
    // nueva como legal o como trabajo humano y seguir. Estas son las que la
    // auditoría estableció que describen una FUNCIÓN: tienen que apuntar a
    // código o el registro deja de decir nada.
    $funcionales = [
        'about.values.auditableFinancials.body',
        'home.howItWorks.step2.body',
        'home.howItWorks.step3.body',
        'home.howItWorks.step5.body',
        'home.oversizeBand.body',
        'home.proofPoints.item2.body',
        'home.proofPoints.item2.title',
        'home.proofPoints.item3.body',
        'services.dispatch.body',
        'services.dispatch.bullet2',
        'services.documentManagement.body',
        'services.documentManagement.bullet3',
        'services.invoicingSettlements.body',
        'services.onboardingCompliance.body',
        'services.onboardingCompliance.bullet3',
        'services.permitsEscorts.bullet1',
        'services.permitsEscorts.bullet3',
        'forCarriers.verification.body',
        'forCarriers.onboarding.certificateOfAuthority.body',
        'privacy.sections.retention.body',
    ];

    $blandas = [PublicClaims::TEXTO_LEGAL, PublicClaims::CONSEJO_DE_OFICIO, PublicClaims::LO_HACE_UNA_PERSONA];

    foreach ($funcionales as $clave) {
        $respaldo = PublicClaims::RESPALDOS[$clave] ?? null;

        expect($respaldo)->toBeString("La promesa funcional {$clave} ha desaparecido del registro.");

        test()->assertNotContains(
            $respaldo,
            $blandas,
            "{$clave} describe una función del producto y se ha declarado como texto sin código detrás.",
        );
    }
});

it('lo que sostiene cada promesa existe', function (): void {
    foreach (PublicClaims::RESPALDOS as $clave => $respaldo) {
        if (in_array($respaldo, [
            PublicClaims::LO_HACE_UNA_PERSONA,
            PublicClaims::TEXTO_LEGAL,
            PublicClaims::CONSEJO_DE_OFICIO,
        ], true)) {
            continue;
        }

        expect(class_exists($respaldo))->toBeTrue(
            "La promesa {$clave} dice apoyarse en {$respaldo}, que ya no existe.",
        );
    }
});

it('el registro no nombra promesas que ya no se dicen', function (): void {
    // Una entrada huérfana tapa a la siguiente clave que se llame igual, que es
    // la misma trampa de las listas de excepciones.
    // Huérfana es que la CLAVE ya no exista, no que su texto haya dejado de
    // sonar a promesa: corregir una frase para que prometa menos —que es
    // justo lo que hizo este lote— no debe vaciar el registro.
    $d = json_decode((string) file_get_contents(raizPaginaPublica().'/lang/es/marketing.json'), true);
    $huerfanas = [];

    foreach (array_keys(PublicClaims::RESPALDOS) as $clave) {
        $nodo = $d;

        foreach (explode('.', $clave) as $paso) {
            $nodo = is_array($nodo) ? ($nodo[$paso] ?? null) : null;
        }

        if (! is_string($nodo)) {
            $huerfanas[] = $clave;
        }
    }

    sort($huerfanas);

    expect($huerfanas)->toBe([], 'Estas entradas del registro ya no corresponden a ninguna frase viva: '.implode(', ', $huerfanas));
});

it('la promesa de la escolta ya no se hace', function (): void {
    // Era una de las dos falsas, y la más seria: `escorts.status` no lo lee
    // ningún guardián, así que una escolta en `pending` no impide despachar.
    // Mientras eso siga así, la página no puede decir lo contrario.
    // La puerta vive en `Papers::faltan()`, que es lo que `readiness` consulta
    // antes de sellar `permit_ready_approved_at` — la marca que `Guards` exige
    // para despachar una carga sobredimensionada. Cuando se escribió esta
    // prueba se miraba `Guards` directamente, y la puerta se construyó un nivel
    // más abajo: el sitio correcto es donde se decide, no donde se obedece.
    $puerta = Source::compacta(raizPaginaPublica().'/app/Support/Oversize/Papers.php');

    if (str_contains($puerta, "DB::table('escorts')")) {
        // La puerta existe: la página puede prometerla, y lo que hay que
        // sujetar ahora es que la puerta siga mirando las dos cosas.
        test()->assertStringContainsString("'reason'=>'escortPending'", $puerta);
        test()->assertStringContainsString("'reason'=>'escortWithoutDocument'", $puerta);

        return;
    }

    foreach (['es', 'en'] as $idioma) {
        foreach (compromisosPublicos($idioma) as $clave => $texto) {
            test()->assertDoesNotMatchRegularExpression(
                '/(escolta[s]? (sin confirmar|pendiente)|unconfirmed escort|escort gate|pending escort)/iu',
                $texto,
                "{$clave} ({$idioma}) promete que una escolta pendiente impide algo, y ningún guardián mira las escoltas.",
            );
        }
    }
});

it('la promesa de la marca de agua ya no se hace', function (): void {
    // La otra: `download` escribe `'watermarked' => false` a fuego y devuelve el
    // fichero crudo. No hay código de marca de agua en ninguna parte.
    $descarga = Source::compacta(raizPaginaPublica().'/app/Http/Controllers/App/DocumentController.php');

    if (! str_contains($descarga, "'watermarked'=>false")) {
        expect(true)->toBeTrue();

        return;
    }

    foreach (['es', 'en'] as $idioma) {
        $d = json_decode((string) file_get_contents(raizPaginaPublica()."/lang/{$idioma}/marketing.json"), true);

        test()->assertDoesNotMatchRegularExpression(
            '/(marca de agua|watermark)/iu',
            json_encode($d, JSON_UNESCAPED_UNICODE) ?: '',
            "La página pública en {$idioma} sigue prometiendo marca de agua.",
        );
    }
});

it('la promesa de FMCSA no dice que se compruebe antes de activar', function (): void {
    // Aprobar un transportista no comprueba FMCSA en absoluto: `Readiness` la
    // trata como AVISO, no como bloqueo, y la propia clase lo dice.
    foreach (['es', 'en'] as $idioma) {
        foreach (compromisosPublicos($idioma) as $clave => $texto) {
            test()->assertDoesNotMatchRegularExpression(
                '/(antes de activarlo|before you.{0,3}re activated)/iu',
                $texto,
                "{$clave} ({$idioma}) dice que FMCSA se comprueba antes de activar, y la aprobación no lo mira.",
            );
        }
    }
});
