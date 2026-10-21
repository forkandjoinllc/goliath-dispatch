<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * El webhook del alta de transportista.
 *
 * ## Lo que este lote vino a sujetar
 *
 * **«Se disparó un webhook» sin forma de comprobarlo.** Un webhook sin registro
 * de entregas es una promesa que nadie puede auditar: falla en silencio durante
 * meses y se descubre cuando falta medio CRM, y para entonces ya no se puede
 * reconstruir qué se perdió.
 *
 * **Una cola que nadie consume.** Este proyecto no tiene `app/Jobs` ni un solo
 * `ShouldQueue`, y en Forge no corre ningún worker. Montar la entrega sobre una
 * cola habría producido exactamente el fallo que el lote existe para evitar: el
 * webhook «se dispara» y no llega nunca.
 *
 * **Una casilla encendida que no manda nada.** Con el cron del planificador sin
 * poner, «Activado» y «no se ha dado nadie de alta» se ven idénticos desde la
 * pantalla.
 *
 * **Nuestro servidor como cliente HTTP de quien escriba la URL.** Un
 * administrador pegando `http://169.254.169.254/...` lee la metadata de la nube
 * desde dentro. Y un nombre público puede resolver a `10.0.0.5`.
 *
 * **Un secreto que se puede volver a leer.** Es una credencial: cifrada, con
 * los últimos cuatro aparte para poder decir cuál hay puesto, y nunca más en
 * pantalla.
 */
function fuenteWebhook(string $ruta): string
{
    return Source::codigo(Source::root().'/'.$ruta);
}

/* ── El alta no depende del webhook ─────────────────────────────────────── */

it('el alta anota la entrega FUERA de la transacción', function (): void {
    /*
    | Entre perder el contacto de un transportista y perder una llamada a un
    | sistema de terceros no hay duda de cuál duele menos. Es lo mismo que ya
    | hacía `Arrival::announce`.
    */
    $alta = fuenteWebhook('app/Http/Controllers/Marketing/CarrierSignupController.php');

    $cierre = strpos($alta, '});');
    $llamada = strpos($alta, 'Deliveries::record(');

    test()->assertNotFalse($cierre);
    test()->assertNotFalse($llamada);
    test()->assertGreaterThan($cierre, $llamada, 'La entrega se anota DENTRO de la transacción.');
});

it('anotar la entrega no sale a la red', function (): void {
    /*
    | Si saliera, el tiempo de respuesta del formulario público pasaría a
    | depender del servidor de otro, y un receptor caído dejaría colgada a la
    | persona que acaba de pulsar enviar.
    */
    $fuente = fuenteWebhook('app/Support/Webhooks/Deliveries.php');

    $desde = strpos($fuente, 'public static function record');
    $hasta = strpos($fuente, 'public static function payload');

    $cuerpo = substr($fuente, (int) $desde, (int) ($hasta - $desde));

    test()->assertStringNotContainsString('Http::', $cuerpo);
});

it('en el sitio de la plataforma no hay webhook que mandar', function (): void {
    // No hay empresa, así que no hay ajustes. Misma decisión que `Arrival`.
    $alta = fuenteWebhook('app/Http/Controllers/Marketing/CarrierSignupController.php');

    test()->assertStringContainsString(
        "if (\$this->context->hasTenant()) {\n            Deliveries::record(",
        $alta,
    );
});

/* ── La carga lleva lo del alta y nada más ──────────────────────────────── */

it('la carga no lleva el identificador interno de la empresa', function (): void {
    $fuente = fuenteWebhook('app/Support/Webhooks/Deliveries.php');

    $desde = strpos($fuente, 'public static function payload');
    $hasta = strpos($fuente, 'public static function attempt');
    $cuerpo = substr($fuente, (int) $desde, (int) ($hasta - $desde));

    test()->assertStringNotContainsString('tenant', $cuerpo);
    test()->assertStringNotContainsString('tenant_id', $cuerpo);
});

/* ── SSRF ───────────────────────────────────────────────────────────────── */

it('solo https, y sin credenciales en la URL', function (): void {
    $fuente = fuenteWebhook('app/Support/Webhooks/SafeUrl.php');

    test()->assertStringContainsString("!== 'https'", $fuente);
    test()->assertStringContainsString("return \$no('credentials');", $fuente);
});

it('los rangos internos están todos', function (): void {
    /*
    | Falta uno y el agujero es el agujero entero: `169.254.169.254` es la
    | metadata de la nube, `127.0.0.0/8` es la propia máquina, y `100.64.0.0/10`
    | es el rango que usan muchos proveedores entre sus máquinas.
    */
    $fuente = fuenteWebhook('app/Support/Webhooks/SafeUrl.php');

    foreach ([
        "'0.0.0.0', 8", "'10.0.0.0', 8", "'100.64.0.0', 10", "'127.0.0.0', 8",
        "'169.254.0.0', 16", "'172.16.0.0', 12", "'192.168.0.0', 16",
    ] as $rango) {
        test()->assertStringContainsString($rango, $fuente, "Falta el rango {$rango}.");
    }
});

it('no basta con mirar si el host parece una IP privada', function (): void {
    // `interno.ejemplo.com` puede resolver a `10.0.0.5`, y un atacante controla
    // su propio DNS.
    $fuente = fuenteWebhook('app/Support/Webhooks/SafeUrl.php');

    test()->assertStringContainsString('dns_get_record', $fuente);
    test()->assertStringContainsString('DNS_AAAA', $fuente);
});

it('UNA dirección interna basta para rechazar el nombre', function (): void {
    /*
    | Si se dejara pasar «la primera que valga», un atacante solo tendría que
    | publicar dos direcciones: una pública y la interna a la que quiere llegar.
    */
    $fuente = fuenteWebhook('app/Support/Webhooks/SafeUrl.php');

    test()->assertStringContainsString(
        "foreach (\$direcciones as \$ip) {\n            if (! self::publica(\$ip)) {\n                return \$no('private_address');",
        $fuente,
    );
});

it('la dirección comprobada se congela al conectar', function (): void {
    /*
    | Entre resolver para validar y resolver para conectar hay una ventana en la
    | que el mismo nombre puede pasar a contestar otra dirección. Se le dice a
    | cURL que use la que ya se comprobó.
    */
    $fuente = fuenteWebhook('app/Support/Webhooks/Deliveries.php');

    test()->assertStringContainsString('CURLOPT_RESOLVE', $fuente);
    test()->assertStringContainsString("\$destino['host'].':'.\$destino['port'].':'.\$destino['ip']", $fuente);
});

it('no se siguen redirecciones', function (): void {
    // Un 302 a 169.254.169.254 se saltaría entera la validación de destino.
    $fuente = fuenteWebhook('app/Support/Webhooks/Deliveries.php');

    test()->assertStringContainsString("'allow_redirects' => false", $fuente);
});

it('la URL se valida al guardarla y también al entregarla', function (): void {
    /*
    | Al guardarla, para poder decir el motivo con el campo delante. Y otra vez
    | al entregar, porque un nombre que hoy es público puede apuntar mañana a
    | otro sitio.
    */
    test()->assertStringContainsString(
        'SafeUrl::check($url)',
        fuenteWebhook('app/Http/Controllers/App/TenantSettingController.php'),
    );
    test()->assertStringContainsString(
        'SafeUrl::check((string) $fila->url)',
        fuenteWebhook('app/Support/Webhooks/Deliveries.php'),
    );
});

/* ── El secreto ─────────────────────────────────────────────────────────── */

it('el secreto se guarda cifrado y nunca vuelve a pantalla', function (): void {
    $ajustes = fuenteWebhook('app/Http/Controllers/App/TenantSettingController.php');
    $estado = fuenteWebhook('app/Support/Webhooks/WebhookState.php');

    test()->assertStringContainsString('Crypt::encryptString($nuevo)', $ajustes);

    // Lo único que viaja a la pantalla son los últimos cuatro.
    test()->assertStringContainsString("'secretLast4' => \$ajustes['last4']", $estado);
    test()->assertStringNotContainsString("'secret' => \$ajustes['secret']", $estado);
});

it('la pista de auditoría tampoco lleva el secreto', function (): void {
    // La lee gente. Lo que no puede volver a pantalla tampoco puede volver por
    // aquí; solo SI cambió.
    $ajustes = fuenteWebhook('app/Http/Controllers/App/TenantSettingController.php');

    $desde = strpos($ajustes, 'entityLabel: \'webhook\'');
    $cuerpo = substr($ajustes, (int) $desde, 600);

    test()->assertStringContainsString("'secretChanged' => \$nuevo !== null", $cuerpo);
    test()->assertStringNotContainsString('$secreto', $cuerpo);
    test()->assertStringNotContainsString('$nuevo,', $cuerpo);
});

it('dejar el campo vacío conserva el secreto, no lo borra', function (): void {
    /*
    | El secreto no viaja a la pantalla, así que un guardado normal lo mandaría
    | vacío. Si «vacío» significara «bórralo», guardar la URL dejaría la casa
    | sin firma sin que nadie lo pidiera.
    */
    $ajustes = fuenteWebhook('app/Http/Controllers/App/TenantSettingController.php');

    test()->assertStringContainsString("\$secreto = \$nuevo ?? \$actual['secret'];", $ajustes);
    test()->assertStringContainsString(
        '...($nuevo === null ? [] : [',
        $ajustes,
        'Las columnas del secreto solo se escriben si hay secreto nuevo.',
    );
});

it('el secreto nuevo no viaja por la bolsa flash compartida', function (): void {
    // Esa bolsa va en las props de TODAS las páginas. Una credencial no pasa
    // por ahí ni una vez de más, y `pull` la saca de la sesión al leerla.
    $ajustes = fuenteWebhook('app/Http/Controllers/App/TenantSettingController.php');
    $compartido = fuenteWebhook('app/Http/Middleware/HandleInertiaRequests.php');

    test()->assertStringContainsString("\$request->session()->pull('webhookSecretOnce')", $ajustes);
    test()->assertStringNotContainsString('webhookSecretOnce', $compartido);
});

it('el tiempo va dentro de lo firmado', function (): void {
    // Firmar solo el cuerpo deja la puerta abierta a la repetición.
    $firma = fuenteWebhook('app/Support/Webhooks/Signature.php');

    test()->assertStringContainsString("hash_hmac('sha256', \$timestampMs.'.'.\$body, \$secret)", $firma);
});

it('la firma se compara en tiempo constante', function (): void {
    $firma = fuenteWebhook('app/Support/Webhooks/Signature.php');

    test()->assertStringContainsString('hash_equals(', $firma);
});

/* ── El registro de entregas ────────────────────────────────────────────── */

it('cada intento queda anotado con su código y su hora', function (): void {
    /*
    | LOS DOS caminos, no «el fichero en algún sitio».
    |
    | Hay dos sitios que escriben el resultado de un intento —el que entregó y
    | el que falló— y la primera versión de esta guarda buscaba las columnas en
    | todo el fichero. El sabotaje quitó `response_status` del camino bueno y la
    | guarda siguió en verde, porque la cadena seguía apareciendo por el otro.
    |
    | Es la misma forma de fallo que apareció en el lote 46, cometida en el lote
    | siguiente. La regla, escrita donde se lea: una guarda solo puede buscar en
    | todo el fichero cuando el fichero tiene UN solo sitio capaz de romper la
    | regla. Con dos, se parte y se afirma sobre cada uno.
    */
    $fuente = fuenteWebhook('app/Support/Webhooks/Deliveries.php');

    $exito = strpos($fuente, 'if ($respuesta->successful())');
    $finExito = strpos($fuente, "return 'delivered';", (int) $exito);
    $caminoBueno = substr($fuente, (int) $exito, (int) ($finExito - $exito));

    $malo = strpos($fuente, 'private static function fallo');
    $finMalo = strpos($fuente, 'public static function claimDue', (int) $malo);
    $caminoMalo = substr($fuente, (int) $malo, (int) ($finMalo - $malo));

    foreach (['response_status', 'last_attempt_at', 'attempts'] as $columna) {
        test()->assertStringContainsString(
            "'{$columna}' =>",
            $caminoBueno,
            "El intento que ENTREGÓ no anota {$columna}.",
        );
        test()->assertStringContainsString(
            "'{$columna}' =>",
            $caminoMalo,
            "El intento que FALLÓ no anota {$columna}.",
        );
    }

    // Y el motivo, que solo tiene sentido en el que falló.
    test()->assertStringContainsString("'error' =>", $caminoMalo);
});

it('la URL y la carga viajan congeladas en la entrega', function (): void {
    /*
    | Si al reintentar se leyeran de los ajustes, cambiar el destino a mitad
    | reescribiría el pasado: el registro diría que fue a donde apunta hoy la
    | configuración y no a donde fue de verdad.
    */
    $fuente = fuenteWebhook('app/Support/Webhooks/Deliveries.php');

    test()->assertStringContainsString('->post((string) $fila->url)', $fuente);
    test()->assertStringContainsString('$cuerpo = (string) $fila->payload;', $fuente);
});

it('un 4xx no se reintenta eternamente', function (): void {
    // El receptor dice que la petición está mal, y mañana estará igual de mal.
    // 408 y 429 sí, que son «ahora no».
    $fuente = fuenteWebhook('app/Support/Webhooks/Deliveries.php');

    test()->assertStringContainsString('! in_array($respuesta->status(), [408, 429], true)', $fuente);
});

it('lo que se quedó «enviando» se rescata', function (): void {
    // Sin rescate, una entrega perdida se queda perdida y la pantalla enseña
    // que sigue trabajando. Un estado intermedio sin rescate es una fuga lenta.
    $fuente = fuenteWebhook('app/Support/Webhooks/Deliveries.php');

    test()->assertStringContainsString("->where('status', 'sending')", $fuente);
    test()->assertStringContainsString("'status' => 'pending', 'next_attempt_at' => now()", $fuente);
});

it('las entregas se reclaman antes de salir a la red', function (): void {
    // Dos barridos solapados mandarían la misma dos veces, y un transportista
    // duplicado en el CRM de alguien es un problema de verdad.
    $fuente = fuenteWebhook('app/Support/Webhooks/Deliveries.php');

    test()->assertStringContainsString(
        "->update(['status' => 'sending', 'last_attempt_at' => now()",
        $fuente,
    );
});

it('el cuerpo de la respuesta del tercero no se pinta en el panel', function (): void {
    // Lo escribe un tercero. Se guarda para auditar y no viaja a la pantalla.
    $estado = fuenteWebhook('app/Support/Webhooks/WebhookState.php');

    test()->assertStringNotContainsString('response_body', $estado);
});

/* ── No es una cola, y la pantalla lo sabe ──────────────────────────────── */

it('la entrega no se monta sobre una cola que nadie consume', function (): void {
    $barrido = fuenteWebhook('app/Console/Commands/DeliverWebhooks.php');
    $servicio = fuenteWebhook('app/Support/Webhooks/Deliveries.php');

    foreach ([$barrido, $servicio] as $fuente) {
        test()->assertStringNotContainsString('ShouldQueue', $fuente);
        test()->assertStringNotContainsString('dispatch(', $fuente);
    }

    test()->assertStringContainsString("Schedule::command('webhooks:deliver')", fuenteWebhook('routes/console.php'));
});

it('el barrido deja rastro aunque no haya trabajo', function (): void {
    /*
    | Sin esa fila, «ninguna entrega» y «el cron no está puesto» se ven
    | exactamente igual desde la pantalla de ajustes.
    */
    $barrido = fuenteWebhook('app/Console/Commands/DeliverWebhooks.php');

    test()->assertStringContainsString("ScheduledRuns::wrap('webhooks:deliver'", $barrido);
});

it('no se inventa una segunda tabla para decir que el barrido corrió', function (): void {
    // `ScheduledRuns` ya lo escribe en `job_queue`, de donde bebe la pantalla de
    // salud de la plataforma. Dos sitios contestando lo mismo acaban
    // contestando cosas distintas.
    $estado = fuenteWebhook('app/Support/Webhooks/WebhookState.php');
    $migracion = fuenteWebhook('database/migrations/2026_10_21_110000_carrier_signup_webhook.php');

    test()->assertStringContainsString("DB::table('job_queue')", $estado);
    test()->assertStringNotContainsString('scheduled_runs', $migracion);
});

it('la pantalla cuenta por separado lo que es distinto', function (): void {
    /*
    | Un verde único que junte «configurado», «el barrido corre» y «la última
    | entrega salió bien» es una garantía inventada. Es la misma decisión que
    | tomó `RevalidationState`.
    */
    $estado = fuenteWebhook('app/Support/Webhooks/WebhookState.php');

    foreach (['enabled', 'sweepLastRunAt', 'sweepStalled', 'pending', 'abandoned', 'last'] as $clave) {
        test()->assertStringContainsString("'{$clave}' =>", $estado);
    }
});

it('un envío de prueba no cuenta como entrega real', function (): void {
    /*
    | Una prueba correcta dice que la URL funciona, no que las altas estén
    | llegando. Si contara, un «todo bien» taparía justo lo que hay que ver.
    */
    $estado = fuenteWebhook('app/Support/Webhooks/WebhookState.php');

    test()->assertStringContainsString("->where('is_test', false)", $estado);
});

it('la pantalla avisa cuando el barrido no está corriendo', function (): void {
    $pantalla = fuenteWebhook('resources/js/pages/App/Settings/Index.tsx');

    test()->assertStringContainsString('sweepNeverRan', $pantalla);
    test()->assertStringContainsString('sweepStalled', $pantalla);
    test()->assertStringContainsString('noRealDelivery', $pantalla);
});

it('el botón de probar tiene su propio tope', function (): void {
    // Sale a la red EN DIRECTO con la URL que acabe de escribir quien lo pulsa.
    $rutas = fuenteWebhook('routes/auth.php');

    test()->assertStringContainsString("->middleware('throttle:6,10')", $rutas);
});

/* ── Rótulos ────────────────────────────────────────────────────────────── */

it('cada rótulo del webhook está en los dos idiomas', function (): void {
    $claves = [
        'title', 'note', 'url', 'urlHint', 'secret', 'secretNone', 'secretSet',
        'secretKeep', 'secretOnce', 'generate', 'enabled', 'enabledHint',
        'sendTest', 'saved', 'tested', 'sweepNeverRan', 'sweepStalled', 'sweepOk',
        'noRealDelivery', 'lastDelivery', 'pending', 'abandoned', 'log',
        'attempts', 'test',
        'status.pending', 'status.sending', 'status.delivered', 'status.failed', 'status.abandoned',
        'errors.scheme', 'errors.credentials', 'errors.malformed', 'errors.dns',
        'errors.private_address', 'errors.incomplete',
    ];

    foreach (['en', 'es'] as $idioma) {
        /** @var array<string, mixed> $dic */
        $dic = json_decode(
            (string) file_get_contents(Source::root()."/lang/{$idioma}/settings.json"),
            true,
        );

        foreach ($claves as $clave) {
            test()->assertNotNull(
                data_get($dic, "webhook.{$clave}"),
                "Falta settings.webhook.{$clave} en {$idioma}.",
            );
        }
    }
});

it('cada motivo de rechazo de SafeUrl tiene su rótulo', function (): void {
    /*
    | Un motivo sin rótulo sale en pantalla como la clave cruda, y quien lo lea
    | se queda sin saber qué arreglar.
    */
    $fuente = fuenteWebhook('app/Support/Webhooks/SafeUrl.php');

    preg_match_all("/\\\$no\('([a-z_]+)'\)/", $fuente, $m);

    $motivos = array_unique($m[1]);
    test()->assertNotEmpty($motivos);

    foreach (['en', 'es'] as $idioma) {
        /** @var array<string, mixed> $dic */
        $dic = json_decode(
            (string) file_get_contents(Source::root()."/lang/{$idioma}/settings.json"),
            true,
        );

        foreach ($motivos as $motivo) {
            test()->assertNotNull(
                data_get($dic, "webhook.errors.{$motivo}"),
                "SafeUrl rechaza por «{$motivo}» y no hay rótulo en {$idioma}.",
            );
        }
    }
});

it('la tarea programada dice qué se deja de hacer si no corre', function (): void {
    // El guardián de la pantalla de salud ya lo exige; esto lo deja escrito
    // junto al resto del lote.
    foreach (['en', 'es'] as $idioma) {
        /** @var array<string, mixed> $dic */
        $dic = json_decode(
            (string) file_get_contents(Source::root()."/lang/{$idioma}/platform.json"),
            true,
        );

        test()->assertNotNull(data_get($dic, 'health.consequence.webhooksDeliver'));
    }
});
