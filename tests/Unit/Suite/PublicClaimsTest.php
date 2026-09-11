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
        .'|automatic|is checked|are checked|cannot|blocks?\b|watermark|encrypt|is kept|are kept|never|always|before (any|it|we|you)|is verified|are verified|watches|runs? automatically/iu',
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
    $sinDeclarar = array_diff(array_keys(compromisosPublicos()), array_keys(PublicClaims::RESPALDOS));

    sort($sinDeclarar);

    expect($sinDeclarar)->toBe([], implode("\n", [
        'Estas frases de la página pública prometen algo y no dicen qué lo sostiene:',
        ...$sinDeclarar,
        '',
        'Cada una va a PublicClaims::RESPALDOS con la clase que la cumple, o con',
        'PublicClaims::LO_HACE_UNA_PERSONA si describe trabajo humano y no una función.',
    ]));
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
    $guardias = Source::compacta(raizPaginaPublica().'/app/Support/Loads/Guards.php');

    if (str_contains($guardias, 'escort')) {
        // Alguien construyó la puerta: entonces la página puede prometerla otra
        // vez, y esta prueba tiene que cambiar a conciencia.
        expect(true)->toBeTrue();

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
