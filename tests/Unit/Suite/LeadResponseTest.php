<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * La promesa que la pantalla pública le hace a un desconocido.
 *
 * ## El defecto
 *
 * `marketing.carrierSignup.success.body` dice, palabra por palabra: «Nuestro
 * equipo de incorporación suele responder en un día hábil. Esté pendiente del
 * correo que nos dio». Y `marketing.forms.success.leadBody` dice «nos
 * pondremos en contacto en breve».
 *
 * Los dos controladores que reciben esos formularios —`CarrierSignupController`
 * y `LeadController`— escribían la fila y no avisaban a nadie. Cero llamadas al
 * notificador, cero correos, cero pasos en el barrido. La única superficie era
 * una tarjeta del panel, que solo existe si alguien lo abre. El plazo lo
 * prometía la página y no lo perseguía nada.
 *
 * ## Lo que estas comprobaciones sujetan
 *
 * Cuatro cosas, y cada una se cayó sola alguna vez en algún lote:
 *
 *  1. Que los dos controladores avisan de verdad.
 *  2. Que el aviso va DESPUÉS del commit y no dentro de la transacción: un
 *     fallo del notificador no se puede llevar por delante el contacto.
 *  3. Que lo no atendido se persigue en el barrido, y que el barrido lo DICE
 *     en su salida — un total que se suma y no se imprime deja de existir sin
 *     que la salida cambie.
 *  4. Que un día hábil no son veinticuatro horas.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código. Y se lee sin
 * comentarios, porque este fichero está lleno de comentarios que MENCIONAN
 * exactamente lo que se vigila.
 */
function raizProspectos(): string
{
    return Source::root();
}

/** Los dos controladores públicos que reciben un formulario de un desconocido. */
function controladoresPublicosDeProspectos(): array
{
    return [
        'CarrierSignupController' => raizProspectos().'/app/Http/Controllers/Marketing/CarrierSignupController.php',
        'LeadController' => raizProspectos().'/app/Http/Controllers/Marketing/LeadController.php',
    ];
}

/**
 * Las TRES puertas de entrada, no los dos ficheros.
 *
 * La diferencia la destapó un sabotaje: se le quitó el aviso a `storeLead` y la
 * comprobación siguió en verde, porque `storeQuote` —en el mismo fichero— sí lo
 * tenía. Una comprobación por fichero da por bueno el fichero entero mientras
 * quede UNA llamada dentro. Aquí hay que mirar método por método: cada
 * formulario público es una promesa distinta hecha a un desconocido distinto.
 *
 * @return array<string, string> «Controlador::método» => cuerpo del método
 */
function metodosPublicosDeProspectos(): array
{
    $puertas = [
        'CarrierSignupController::__invoke' => ['CarrierSignupController', 'public function __invoke('],
        'LeadController::storeLead' => ['LeadController', 'public function storeLead('],
        'LeadController::storeQuote' => ['LeadController', 'public function storeQuote('],
    ];

    $ficheros = controladoresPublicosDeProspectos();
    $cuerpos = [];

    foreach ($puertas as $nombre => [$controlador, $firma]) {
        $codigo = Source::sinComentarios($ficheros[$controlador]);

        $inicio = strpos($codigo, $firma);
        expect($inicio)->toBeInt("no se encontró {$nombre}: la firma cambió y la comprobación dejó de mirar nada");

        // Hasta la firma del método SIGUIENTE, o hasta el final del fichero.
        // Una ventana de tamaño fijo acaba leyendo el método de al lado, y
        // entonces no mide lo que dice medir.
        $siguiente = strpos($codigo, "\n    public function ", $inicio + 1);
        $privada = strpos($codigo, "\n    private function ", $inicio + 1);

        $fin = min(array_filter([$siguiente, $privada, strlen($codigo)], fn ($v) => $v !== false));

        $cuerpos[$nombre] = substr($codigo, $inicio, $fin - $inicio);
    }

    return $cuerpos;
}

/* ── Los dos controladores avisan ────────────────────────────────────────── */

it('los tres formularios públicos avisan de que llegó un prospecto', function (): void {
    foreach (metodosPublicosDeProspectos() as $nombre => $cuerpo) {
        // assertStringContainsString y no expect()->toContain(): toContain
        // toma TODOS sus argumentos como agujas. El mensaje se convertía en una
        // segunda aguja que no casaba nunca, así que la comprobación fallaba
        // por el motivo equivocado — y con el defecto puesto habría fallado
        // igual, diciendo otra cosa.
        test()->assertStringContainsString(
            'Arrival::announce(',
            $cuerpo,
            "{$nombre} recibe un formulario público y no avisa a nadie. La página le acaba de prometer respuesta en un día hábil."
        );
    }
});

it('el aviso sale del sitio que decide a quién avisar y no de cada controlador', function (): void {
    // Si cada controlador construyera su propio Notifier::toPermissionHolders,
    // el permiso, la clave de deduplicación y el enlace estarían copiados dos
    // veces, y dos copias de una regla se separan.
    foreach (controladoresPublicosDeProspectos() as $nombre => $ruta) {
        test()->assertStringNotContainsString(
            'Notifier::',
            Source::sinComentarios($ruta),
            "{$nombre} llama al notificador por su cuenta en vez de pasar por Arrival."
        );
    }
});

/* ── Y avisa DESPUÉS del commit ──────────────────────────────────────────── */

it('el aviso va fuera de la transacción que guarda el prospecto', function (): void {
    // La comprobación es posicional a propósito: lo que importa no es que las
    // dos líneas existan, sino cuál va antes. Dentro de la transacción, un
    // notificador que reviente deshace el prospecto.
    foreach (controladoresPublicosDeProspectos() as $nombre => $ruta) {
        $codigo = Source::sinComentarios($ruta);

        $cierre = strrpos($codigo, '});');
        $aviso = strrpos($codigo, 'Arrival::announce(');

        expect($aviso)->toBeInt();

        if ($cierre === false) {
            continue; // storeLead no abre transacción: no hay nada que ordenar.
        }

        test()->assertGreaterThan(
            $cierre,
            $aviso,
            "En {$nombre} el aviso está DENTRO de la transacción: si el notificador falla, se pierde el prospecto."
        );
    }
});

it('Arrival no se inventa una empresa cuando el alta viene del sitio de la plataforma', function (): void {
    // notifications.tenant_id es NOT NULL. Sin empresa no hay a quién avisar, y
    // la salida honesta es devolver cero y contarlo en la pantalla de la
    // plataforma — no crear un tenant huérfano para que la campana suene.
    $codigo = Source::compacta(raizProspectos().'/app/Support/Leads/Arrival.php');

    expect($codigo)->toContain('if($tenantId===null||$tenantId===\'\'){return0;}');
});

/* ── El barrido persigue lo no atendido, y lo dice ───────────────────────── */

it('el barrido diario mira los prospectos sin atender', function (): void {
    $codigo = Source::sinComentarios(raizProspectos().'/app/Console/Commands/SweepNotifications.php');

    expect($codigo)->toContain('$totales[\'leads\'] += $this->prospectosSinAtender($tenantId, $dry);');
});

it('el total de prospectos del barrido se imprime', function (): void {
    // Un total que se suma y no sale por pantalla es una pasada que puede dejar
    // de correr sin que nadie note el cambio en la salida.
    $codigo = Source::sinComentarios(raizProspectos().'/app/Console/Commands/SweepNotifications.php');

    $linea = strpos($codigo, '%d empresas ·');
    expect($linea)->toBeInt();

    $sprintf = substr($codigo, $linea, 900);

    expect($sprintf)->toContain('prospectos %d')
        ->and($sprintf)->toContain('$totales[\'leads\'],');
});

it('el prospecto sin atender solo suena una vez', function (): void {
    // Con la fecha de hoy en la clave, el mismo contacto volvería a sonar cada
    // mañana hasta que alguien lo tocara, y una campana que repite deja de
    // mirarse.
    $codigo = Source::compacta(raizProspectos().'/app/Console/Commands/SweepNotifications.php');

    expect($codigo)->toContain('dedupeKey:"lead.unattended:{$prospecto->id}"');
});

/* ── Un día hábil no son veinticuatro horas ──────────────────────────────── */

it('el corte del plazo salta el fin de semana', function (): void {
    $codigo = Source::compacta(raizProspectos().'/app/Console/Commands/SweepNotifications.php');

    expect($codigo)->toContain('while($anterior->isSaturday()||$anterior->isSunday())');
});

it('el barrido usa el día hábil y no un subDay pelado', function (): void {
    $codigo = Source::sinComentarios(raizProspectos().'/app/Console/Commands/SweepNotifications.php');

    $inicio = strpos($codigo, 'private function prospectosSinAtender(');
    expect($inicio)->toBeInt();

    // Hasta el `return` del propio método y ni un carácter más. Con una ventana
    // de tamaño fijo, la comprobación acababa leyendo el método SIGUIENTE, que
    // sí tiene un subDay legítimo — y entonces no mide lo que dice medir.
    $fin = strpos($codigo, 'return $escritos;', $inicio);
    expect($fin)->toBeInt();

    $cuerpo = substr($codigo, $inicio, $fin - $inicio);

    expect($cuerpo)->toContain('self::unDiaHabilAntes(CarbonImmutable::now())')
        ->and($cuerpo)->not->toContain('->subDay()');
});

/* ── Los dos sucesos tienen rótulo en los dos idiomas ────────────────────── */

it('los dos sucesos nuevos están en el catálogo de la pantalla de avisos', function (): void {
    // Un suceso que se escribe y no está en EVENTS no tiene casilla de
    // preferencia: se manda y no se puede apagar.
    $codigo = Source::sinComentarios(raizProspectos().'/app/Http/Controllers/App/NotificationController.php');

    expect($codigo)->toContain("'lead.received'")
        ->and($codigo)->toContain("'lead.unattended'");
});

it('los dos sucesos tienen título, cuerpo y nombre en inglés y en español', function (): void {
    foreach (['en', 'es'] as $idioma) {
        $dic = json_decode((string) file_get_contents(raizProspectos()."/lang/{$idioma}/notifications.json"), true);

        foreach (['received', 'unattended'] as $suceso) {
            expect($dic['events']['lead'][$suceso]['title'] ?? null)->toBeString("falta events.lead.{$suceso}.title en {$idioma}");
            expect($dic['events']['lead'][$suceso]['body'] ?? null)->toBeString("falta events.lead.{$suceso}.body en {$idioma}");

            // El nombre corto es el que sale en la casilla de preferencias. Sin
            // él la casilla existe y no dice de qué es.
            expect($dic['eventNames']['lead'][$suceso] ?? null)->toBeString("falta eventNames.lead.{$suceso} en {$idioma}");
        }
    }
});

it('la pantalla de la plataforma enseña los prospectos que la campana no alcanza', function (): void {
    $controlador = Source::sinComentarios(raizProspectos().'/app/Http/Controllers/Platform/HealthController.php');
    $pantalla = file_get_contents(raizProspectos().'/resources/js/pages/Platform/Health.tsx');

    expect($controlador)->toContain("'orphanLeads' => \$this->prospectosSinEmpresa(),")
        // Sin fecha, tres de esta mañana y tres de hace tres semanas son el
        // mismo número.
        ->and($controlador)->toContain("'oldestAt' =>")
        ->and($pantalla)->toContain('orphanLeads.count > 0')
        ->and($pantalla)->toContain('platform.health.orphanLeadsBody');
});
