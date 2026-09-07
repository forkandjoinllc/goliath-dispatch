<?php

declare(strict_types=1);

use App\Http\Controllers\App\NotificationController;
use App\Support\Loads\RateConfirmation;
use App\Support\Loads\RateResponse;
use Tests\Support\Source;

/**
 * Lo que el transportista contesta a la tarifa tiene que llegarle a despacho.
 *
 * ## El defecto
 *
 * La pantalla le pide el motivo al transportista con esta frase, en los dos
 * idiomas:
 *
 * > Rejecting or requesting changes needs a reason. **Without one, dispatch has
 * > to call to find out what happened.**
 *
 * Es un trato: escribe el motivo y te ahorras la llamada. Y escribirlo no
 * ahorraba ninguna llamada — `decide()` guardaba la decisión y el motivo y no
 * avisaba a nadie. Ni una llamada al notificador, ni un `rateconf.*` en el
 * catálogo de sucesos.
 *
 * La confirmación de tarifa es el papel por el que se compromete el dinero de
 * una carga. Un «rechazado» o un «pido cambios» es exactamente lo que la deja
 * parada, y despacho se enteraba solo si abría esa carga por su cuenta.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código.
 */
function raizTarifas(): string
{
    return Source::root();
}

function controladorDeTarifas(): string
{
    return Source::sinComentarios(raizTarifas().'/app/Http/Controllers/App/RateConfirmationController.php');
}

/** El cuerpo de un método suelto, hasta la firma del siguiente. */
function cuerpoDeTarifas(string $codigo, string $firma): string
{
    $inicio = strpos($codigo, $firma);
    expect($inicio)->toBeInt("no se encontró «{$firma}»: cambió la firma y esto dejó de mirar nada");

    $siguiente = strpos($codigo, "\n    public function ", $inicio + 1);
    $privada = strpos($codigo, "\n    private function ", $inicio + 1);
    $fin = min(array_filter([$siguiente, $privada, strlen($codigo)], fn ($v) => $v !== false));

    return substr($codigo, $inicio, $fin - $inicio);
}

/* ── La frase y el aviso van juntos ──────────────────────────────────────── */

it('si la pantalla promete ahorrarle la llamada a despacho, alguien tiene que avisar a despacho', function (): void {
    // Esta es LA comprobación del lote. No vigila que exista una llamada:
    // vigila que el trato que ofrece la pantalla y lo que hace el código no se
    // separen. Si mañana alguien quita el aviso, esto obliga a quitar también
    // la frase — que es la otra forma correcta de arreglarlo.
    $promete = false;

    foreach (['en', 'es'] as $idioma) {
        $dic = json_decode((string) file_get_contents(raizTarifas()."/lang/{$idioma}/loads.json"), true);
        $frase = (string) ($dic['rateConfirmation']['reasonRequired'] ?? '');

        if (preg_match('/(dispatch has to call|despacho tiene que llamar|hay que llamar)/iu', $frase) === 1) {
            $promete = true;
        }
    }

    if (! $promete) {
        expect(true)->toBeTrue(); // La frase ya no lo promete: nada que sujetar.

        return;
    }

    test()->assertStringContainsString(
        'RateResponse::announce(',
        cuerpoDeTarifas(controladorDeTarifas(), 'public function decide('),
        'La pantalla le pide el motivo al transportista a cambio de ahorrarle una llamada a despacho, y decide() no avisa a despacho.'
    );
});

it('el aviso sale del sitio que decide a quién avisar', function (): void {
    expect(controladorDeTarifas())->not->toContain('Notifier::');
});

it('el aviso va después de anotar la decisión', function (): void {
    // Lo que no se puede perder es la decisión: la tomó una persona y
    // compromete dinero. El aviso sí se puede volver a mandar.
    $cuerpo = cuerpoDeTarifas(controladorDeTarifas(), 'public function decide(');

    $anota = strpos($cuerpo, 'RateConfirmation::decide(');
    $avisa = strpos($cuerpo, 'RateResponse::announce(');

    expect($anota)->toBeInt()->and($avisa)->toBeInt();
    test()->assertGreaterThan($anota, $avisa, 'El aviso va ANTES de anotar la decisión.');
});

/* ── Se avisa a quien manda el papel, no a cualquiera ────────────────────── */

it('se avisa a quien puede emitir la confirmación', function (): void {
    // Simetría: quien manda el papel es quien tiene que enterarse de la
    // respuesta. `load:rateconf:respond` es Scope::Carrier y por tanto no lo
    // tiene nunca nadie de la casa — avisar a sus titulares sería avisar al
    // propio transportista de lo que acaba de contestar.
    $codigo = Source::compacta(raizTarifas().'/app/Support/Loads/RateResponse.php');
    $controlador = Source::compacta(raizTarifas().'/app/Http/Controllers/App/RateConfirmationController.php');

    expect($codigo)->toContain("PERMISO='load:financials:update'")
        // Y ese es exactamente el permiso que exige emitir.
        ->and($controlador)->toContain("authorize(\$actor,'load:financials:update'");
});

/* ── Los sucesos salen del enum ──────────────────────────────────────────── */

it('cada decisión posible tiene su suceso, su rótulo y su casilla', function (): void {
    // Derivado de RateConfirmation::DECISIONES a propósito: si mañana aparece
    // una cuarta decisión, esto la caza antes de que se mande un aviso sin
    // nombre — o de que no se mande ninguno.
    // `NotificationController::events()` y no el fuente: la lista es pública y
    // no hace falta arrancar la aplicación para leerla. Y así la comprobación
    // sigue el símbolo aunque la constante cambie de forma.
    $catalogo = NotificationController::events();

    $diccionarios = [];
    foreach (['en', 'es'] as $idioma) {
        $diccionarios[$idioma] = json_decode(
            (string) file_get_contents(raizTarifas()."/lang/{$idioma}/notifications.json"), true
        );
    }

    foreach (RateConfirmation::DECISIONES as $decision) {
        $suceso = RateResponse::sucesoDe($decision);

        // assertContains y no expect()->toContain(): toContain toma TODOS sus
        // argumentos como agujas, y el mensaje se convertía en una segunda que
        // no casaba nunca. Ya mordió en el lote de prospectos.
        test()->assertContains(
            $suceso,
            $catalogo,
            "el suceso {$suceso} no está en EVENTS: se manda y no se puede apagar"
        );

        foreach ($diccionarios as $idioma => $dic) {
            expect($dic['events']['load']['rateconf'][$decision]['title'] ?? null)->toBeString("falta el título de {$suceso} en {$idioma}");
            expect($dic['events']['load']['rateconf'][$decision]['body'] ?? null)->toBeString("falta el cuerpo de {$suceso} en {$idioma}");
            expect($dic['eventNames']['load']['rateconf'][$decision] ?? null)->toBeString("falta el nombre de {$suceso} en {$idioma}");
        }
    }
});

it('el aviso de «sin contestar» también tiene rótulo y casilla', function (): void {
    expect(NotificationController::events())
        ->toContain(RateResponse::SIN_CONTESTAR);

    foreach (['en', 'es'] as $idioma) {
        $dic = json_decode((string) file_get_contents(raizTarifas()."/lang/{$idioma}/notifications.json"), true);

        expect($dic['events']['load']['rateconf']['unanswered']['title'] ?? null)->toBeString("falta el título en {$idioma}");
        expect($dic['eventNames']['load']['rateconf']['unanswered'] ?? null)->toBeString("falta el nombre en {$idioma}");
    }
});

it('la lista de sucesos que la clase puede escribir no se lleva a mano', function (): void {
    // Si `sucesos()` fuera una lista literal, añadir una decisión al enum la
    // dejaría fuera en silencio.
    $codigo = Source::compacta(raizTarifas().'/app/Support/Loads/RateResponse.php');

    expect($codigo)->toContain('array_map(self::sucesoDe(...),RateConfirmation::DECISIONES)');
});

/* ── Lo que nadie contesta se persigue ───────────────────────────────────── */

it('el barrido persigue las confirmaciones sin contestar', function (): void {
    $codigo = Source::sinComentarios(raizTarifas().'/app/Console/Commands/SweepNotifications.php');

    expect($codigo)->toContain("\$totales['rates'] += \$this->tarifasSinContestar(\$tenantId, \$dry);");
});

it('el total de tarifas del barrido se imprime', function (): void {
    // Un total que se suma y no sale por pantalla es una pasada que puede dejar
    // de correr sin que la salida cambie. Ya pasó dos lotes atrás.
    $codigo = Source::sinComentarios(raizTarifas().'/app/Console/Commands/SweepNotifications.php');

    $linea = strpos($codigo, '%d empresas ·');
    expect($linea)->toBeInt();

    $sprintf = substr($codigo, $linea, 1100);

    expect($sprintf)->toContain('tarifas %d')
        ->and($sprintf)->toContain("\$totales['rates'],");
});

it('no se persigue la tarifa de una carga ya cerrada', function (): void {
    // Una entregada o cancelada no necesita que nadie acepte su tarifa, y
    // avisar de ella es ruido sobre asuntos cerrados.
    $codigo = Source::sinComentarios(raizTarifas().'/app/Console/Commands/SweepNotifications.php');

    $cuerpo = cuerpoDeTarifas($codigo, 'private function tarifasSinContestar(');

    expect($cuerpo)->toContain('LoadStatus::delivered()')
        ->and($cuerpo)->toContain('LoadStatus::Cancelled->value');
});

it('una decisión sobre un papel anterior no cuenta como contestada', function (): void {
    // Si despacho reemite con otra tarifa, lo que hace falta es la respuesta al
    // papel NUEVO. Cruzar por load_id daría por contestada una reemisión que
    // nadie ha mirado.
    $codigo = Source::compacta(raizTarifas().'/app/Console/Commands/SweepNotifications.php');

    expect($codigo)->toContain("whereColumn('a.document_id','d.id')");
});

it('el aviso de sin contestar no repite cada mañana', function (): void {
    // CON LA COMA FINAL, y no es un detalle de estilo: sin ella la aguja es un
    // PREFIJO, y `...->id.':'.now()->toDateString(),` la seguía conteniendo. El
    // sabotaje que añadía la fecha pasaba en verde. La coma es lo que obliga a
    // que el argumento TERMINE ahí.
    //
    // Y esto no lo puede atrapar ninguna prueba de recorrido: dos pasadas del
    // barrido el mismo día generan la misma clave con fecha y con fecha, así
    // que se deduplicarían igual. El fallo solo aparecería al día siguiente, en
    // producción, con la campana repitiendo.
    $codigo = Source::compacta(raizTarifas().'/app/Console/Commands/SweepNotifications.php');

    expect($codigo)->toContain("dedupeKey:RateResponse::SIN_CONTESTAR.':'.\$documento->id,");
});

it('el aviso de sin contestar tiene plazo y corte hacia atrás', function (): void {
    $codigo = Source::sinComentarios(raizTarifas().'/app/Console/Commands/SweepNotifications.php');

    $cuerpo = cuerpoDeTarifas($codigo, 'private function tarifasSinContestar(');

    expect($cuerpo)->toContain('self::TARIFA_DIAS')
        ->and($cuerpo)->toContain('self::TARIFA_VENTANA');
});

/* ── La deduplicación deja pasar la segunda vuelta ───────────────────────── */

it('rechazar hoy y aceptar la reemisión de mañana suenan las dos veces', function (): void {
    // Con la carga sola en la clave, la segunda decisión no sonaría — y la
    // segunda es la que dice que la carga puede moverse.
    $codigo = Source::compacta(raizTarifas().'/app/Support/Loads/RateResponse.php');

    // Con la coma final, por lo mismo que en el aviso de «sin contestar»: sin
    // ella la aguja es un prefijo y no ve lo que se le añada detrás.
    expect($codigo)->toContain("\$carga->id.':'.(\$carga->carrier_gross_rate_cents??0),");
});

it('el motivo entra recortado en el aviso', function (): void {
    $codigo = Source::compacta(raizTarifas().'/app/Support/Loads/RateResponse.php');

    expect($codigo)->toContain("mb_strimwidth(trim(\$motivo),0,160,'…')");
});
