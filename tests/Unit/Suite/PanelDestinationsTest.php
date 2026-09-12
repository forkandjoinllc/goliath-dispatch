<?php

declare(strict_types=1);

use App\Support\Dashboard\Panel;
use Tests\Support\Source;

/**
 * Un número del panel y la lista a la que lleva cuentan lo mismo.
 *
 * ## El defecto
 *
 * El subtítulo de la pantalla de inicio se lo promete al usuario:
 *
 * > Todo lo de abajo es un recuento real. Púlselo y va a la lista de donde
 * > salió.
 *
 * Y la cabecera de `Panel` lo pone como primera de sus tres reglas, con el
 * énfasis suyo: «ese `href` apunta a la pantalla YA FILTRADA».
 *
 * Tres de las once no lo cumplían, cada una a su manera:
 *
 *  1. `leadsUnassigned` contaba «sin dueño Y todavía vivo» y enlazaba a
 *     `?assigned=unassigned`, un filtro que solo miraba el dueño.
 *  2. `carriersFmcsaStale` enlazaba a `/carriers` a secas porque la lista no
 *     sabía expresar la pregunta: su filtro de FMCSA mira el ESTADO de la
 *     última comprobación y la tarjeta mira su ANTIGÜEDAD.
 *  3. `loadsUninvoiced` contaba CARGAS y llevaba a la pantalla de alta de
 *     factura, que enseña TRANSPORTISTAS.
 *
 * ## Lo que vigila este fichero
 *
 * Que los destinos vivan juntos —repartidos por once métodos, nadie los
 * comprobó en once lotes—, que cada tarjeta tenga el suyo, y que las consultas
 * que una tarjeta y su lista comparten sigan siendo UNA.
 *
 * Quien mide de verdad que los números coinciden es
 * `tests/Feature/Dashboard/CardDestinationTest.php`: pide cada destino y
 * compara. Esto de aquí sujeta la estructura que hace posible aquello.
 */
function raizPanel(): string
{
    return Source::root();
}

it('los destinos viven en un solo sitio y ninguno queda suelto', function (): void {
    $panel = Source::compacta(raizPanel().'/app/Support/Dashboard/Panel.php');

    // Ningún constructor pone su propio destino: con once literales repartidos,
    // comprobar la regla obligaba a leer once métodos.
    expect(substr_count($panel, "'href'=>"))->toBe(1);
    expect($panel)->toContain("'href'=>self::DESTINOS[\$clave]");
});

it('cada tarjeta que se construye tiene destino declarado, y al revés', function (): void {
    // Una tarjeta nueva sin entrada en DESTINOS reventaría al pintarse; una
    // entrada sin tarjeta es un destino que ya no lleva a nada.
    $panel = Source::sinComentarios(raizPanel().'/app/Support/Dashboard/Panel.php');

    preg_match('/private static function builders\(\): array(.*?)\n    }/s', $panel, $m);
    expect($m)->not->toBe([]);

    preg_match_all("/'([a-zA-Z]+)' => self::/", $m[1], $claves);

    $construidas = $claves[1];
    sort($construidas);

    $declaradas = array_keys(Panel::DESTINOS);
    sort($declaradas);

    expect($construidas)->toBe($declaradas);
});

it('todos los destinos llevan filtro, porque un número sin él no se puede seguir', function (): void {
    // `/carriers` a secas era el caso: la tarjeta contaba una pregunta y el
    // destino enseñaba la lista entera.
    foreach (Panel::DESTINOS as $clave => $destino) {
        expect($destino)->toStartWith('/');

        // `toContain` con un segundo argumento busca OTRA aguja, no imprime un
        // mensaje. Para que el fallo diga de qué tarjeta habla, la comprobación
        // se hace a mano.
        test()->assertStringContainsString(
            '?',
            $destino,
            "El destino de «{$clave}» no lleva filtro: enseñaría más filas que su número.",
        );
    }
});

it('la tarjeta de revalidación y la lista comparten la consulta, no una copia', function (): void {
    // Estaba escrita tres veces: el barrido nocturno, la tarjeta, y en ninguna
    // parte de la lista — que era donde hacía falta.
    $revalidacion = Source::compacta(raizPanel().'/app/Support/Fmcsa/Revalidation.php');
    expect($revalidacion)->toContain('publicstaticfunctionapply(');

    // `sinComentarios` y no `compacta` para esta aguja: `compacta` quita los
    // espacios TAMBIÉN dentro de los literales, así que
    // `'fmcsa_verifications as v'` se buscaría como `'fmcsa_verificationsasv'`.
    // La aguja no casaba con nada y la comprobación pasaba siempre — ver la
    // cabecera de `Tests\Support\Source`, que existe por este mismo fallo.
    $conEspacios = Source::sinComentarios(raizPanel().'/app/Support/Fmcsa/Revalidation.php');

    // Una sola definición del `whereNotExists`: si vuelve a haber dos, vuelven
    // a poder discrepar.
    expect(substr_count($conEspacios, "from('fmcsa_verifications as v')"))->toBe(1);

    $panel = Source::compacta(raizPanel().'/app/Support/Dashboard/Panel.php');
    expect($panel)->toContain('Revalidation::apply(');
    expect(Source::sinComentarios(raizPanel().'/app/Support/Dashboard/Panel.php'))
        ->not->toContain("from('fmcsa_verifications as v')");

    $lista = Source::compacta(raizPanel().'/app/Http/Controllers/App/CarrierController.php');
    expect($lista)->toContain('Revalidation::apply($query->getQuery()');
});

it('la tarjeta de prospectos y la lista comparten el predicado', function (): void {
    $prospectos = Source::compacta(raizPanel().'/app/Http/Controllers/App/LeadController.php');

    expect($prospectos)->toContain('publicstaticfunctionapplyUnassigned(');
    expect($prospectos)->toContain("CERRADOS=['converted','lost']");
    // Las DOS mitades, en el sitio compartido.
    expect($prospectos)->toContain("whereNull('assigned_to_user_id')->whereNotIn('status',self::CERRADOS)");

    $panel = Source::compacta(raizPanel().'/app/Support/Dashboard/Panel.php');
    expect($panel)->toContain('LeadController::applyUnassigned(');
    expect($panel)->not->toContain("whereNotIn('status',['converted','lost'])");
});

it('la tarjeta de sin facturar y la lista comparten Billable', function (): void {
    $billable = Source::compacta(raizPanel().'/app/Support/Finance/Billable.php');

    expect($billable)->toContain('publicstaticfunctionapply(');
    // El `whereIn` de estados, una sola vez: `query()` pasa por `apply()`.
    expect(substr_count($billable, "whereIn(\$alias.'.status',self::ESTADOS)"))->toBe(1);
    expect($billable)->not->toContain("whereIn('l.status',self::ESTADOS)");

    $cargas = Source::compacta(raizPanel().'/app/Http/Controllers/App/LoadController.php');
    expect($cargas)->toContain('Billable::apply($query->getQuery()');
});

it('la lista de cargas no aplica el filtro sin que lo pidan', function (): void {
    // Un filtro que se aplica solo esconde filas en silencio, que es el mismo
    // defecto por el otro lado.
    $cargas = Source::compacta(raizPanel().'/app/Http/Controllers/App/LoadController.php');

    expect($cargas)->toContain("\$filters['uninvoiced']==='1'");
    expect($cargas)->toContain("\$request->query('uninvoiced')==='1'?'1':''");
});

it('los dos filtros nuevos se ven en su pantalla y se dicen en los dos idiomas', function (): void {
    // Un filtro que solo existe en la barra de direcciones es medio filtro:
    // quien aterriza en la lista recortada no sabe que lo está.
    $transportistas = (string) file_get_contents(raizPanel().'/resources/js/pages/App/Carriers/Index.tsx');
    expect($transportistas)->toContain('carriers.filters.revalidationDue');
    expect($transportistas)->toContain('navigate(filters, { revalidation: value })');

    $cargas = (string) file_get_contents(raizPanel().'/resources/js/pages/App/Loads/Index.tsx');
    expect($cargas)->toContain("filters.uninvoiced === '1'");
    expect($cargas)->toContain('loads.filters.uninvoiced');

    foreach (['es', 'en'] as $idioma) {
        $t = json_decode((string) file_get_contents(raizPanel()."/lang/{$idioma}/carriers.json"), true);
        expect($t['filters']['revalidation'] ?? null)->toBeString();
        expect($t['filters']['revalidationDue'] ?? null)->toBeString();

        $c = json_decode((string) file_get_contents(raizPanel()."/lang/{$idioma}/loads.json"), true);
        expect($c['filters']['uninvoiced'] ?? null)->toBeString();
    }
});
