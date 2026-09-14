<?php

declare(strict_types=1);

use App\Enums\NotificationChannel;
use App\Support\Notifications\Channels;
use Tests\Support\Source;

use function PHPUnit\Framework\assertArrayHasKey;

/**
 * Nadie promete un SMS mientras no salga ninguno.
 *
 * ## El defecto
 *
 * La política de privacidad pública decía, en los dos idiomas:
 *
 * > Puede retirar su consentimiento en cualquier momento respondiendo STOP a
 * > cualquier mensaje, lo que **suprime de inmediato** el envío de más SMS a
 * > ese número; responder HELP devuelve la información de contacto de soporte.
 *
 * No hay envío. Ninguna clase manda un mensaje de texto, no hay proveedor
 * atado, y no existe ruta de entrada que escuche un STOP ni un HELP. Además:
 *
 *  - el alta ofrecía un «Acepto recibir mensajes SMS operativos… Responda STOP
 *    para cancelar» (copia que, encima, no pintaba nadie);
 *  - la ficha del conductor enseñaba «Mensajes de texto: No otorgado» para
 *    todos, siempre, porque `drivers.sms_consent_granted_at` no lo escribe
 *    nadie — y al lado del consentimiento de rastreo, que sí es real;
 *  - el panel de proveedores daba SMS por «Real» en cuanto hubiera un
 *    `TWILIO_SID` escrito, que es la mentira más cara porque se le cuenta a
 *    quien decide si algo está listo para producción.
 *
 * Y el diagnóstico YA ESTABA ESCRITO: `Notifier` decía en un comentario
 * «`sms` está declarado y suprimido». Se quedó ahí, en una clase interna,
 * mientras cuatro pantallas decían lo contrario.
 *
 * ## Lo que vigila este fichero
 *
 * Que el registro de canales no envejezca, que ninguna copia —viva o muerta,
 * en cualquiera de los dos idiomas— prometa envío, STOP o HELP mientras `sms`
 * siga suprimido, y que el panel no llame «real» a lo que no entrega.
 *
 * Todo lo de aquí está condicionado al registro: **el día que alguien
 * construya el envío, estas pruebas dejan de exigir el silencio y empiezan a
 * exigir lo contrario** —que la política vuelva a explicar STOP y HELP—.
 * Ver `docs/sms-promise.md`.
 */
function raizSms(): string
{
    return Source::root();
}

/** @return array<string, string> Cada hoja de los diccionarios, por su ruta. */
function hojasSms(string $idioma): array
{
    $hojas = [];

    foreach (glob(raizSms()."/lang/{$idioma}/*.json") ?: [] as $ruta) {
        $raiz = basename($ruta, '.json');
        $datos = json_decode((string) file_get_contents($ruta), true, 512, JSON_THROW_ON_ERROR);

        $aplanar = static function (mixed $nodo, string $prefijo) use (&$aplanar, &$hojas): void {
            if (is_array($nodo)) {
                foreach ($nodo as $clave => $hijo) {
                    $aplanar($hijo, "{$prefijo}.{$clave}");
                }

                return;
            }

            $hojas[$prefijo] = (string) $nodo;
        };

        $aplanar($datos, $raiz);
    }

    return $hojas;
}

it('cada canal del enum cae de un lado o del otro, y ninguno en los dos', function (): void {
    // Un canal nuevo sin declarar no es «pendiente»: es un canal del que nadie
    // sabe si entrega, y por el que alguien acabará escribiendo copia.
    $declarados = Channels::declarados();
    $clasificados = array_merge(Channels::ENTREGADOS, array_keys(Channels::SUPRIMIDOS));

    sort($declarados);
    sort($clasificados);

    expect($clasificados)->toBe($declarados);

    foreach (Channels::ENTREGADOS as $canal) {
        expect(Channels::SUPRIMIDOS)->not->toHaveKey($canal);
    }

    // Un motivo de una línea no es un motivo.
    foreach (Channels::SUPRIMIDOS as $canal => $motivo) {
        expect(NotificationChannel::tryFrom($canal))->not->toBeNull();
        expect(strlen($motivo))->toBeGreaterThan(80);
    }
});

it('el emisor entrega exactamente por los canales entregados', function (): void {
    $fuente = Source::compacta(raizSms().'/app/Support/Notifications/Notifier.php');

    // La lista dejó de estar escrita a mano dentro del emisor. Mientras lo
    // estuvo, decir la verdad en un sitio no obligaba a nada en los demás.
    expect($fuente)->toContain('constCANALES=Channels::ENTREGADOS');
    expect($fuente)->not->toContain("'sms'");
});

it('ninguna copia promete un SMS que no sale', function (): void {
    if (! array_key_exists('sms', Channels::SUPRIMIDOS)) {
        // Si alguien construyó el envío, esta prueba ya no manda: lo que hay
        // que exigir entonces es lo contrario, y lo hace la de más abajo.
        expect(true)->toBeTrue();

        return;
    }

    // Se buscan las TRES promesas por separado, porque son tres cosas
    // distintas y cada una se pudo escribir sin las otras: que se mandan
    // mensajes, que responder STOP los para, y que HELP contesta algo.
    $agujas = [
        'envío' => '/(mensajes? de texto|text messages?|SMS)[^.]{0,120}(recibir|enviar|mandar|receive|send|deliver)/iu',
        'STOP' => '/\b(STOP|ALTO)\b/u',
        'HELP' => '/\bHELP\b/u',
    ];

    foreach (['es', 'en'] as $idioma) {
        foreach (hojasSms($idioma) as $ruta => $texto) {
            foreach ($agujas as $que => $aguja) {
                expect(preg_match($aguja, $texto))->toBe(
                    0,
                    "{$ruta} ({$idioma}) promete {$que} por SMS, y no sale ninguno: «{$texto}»",
                );
            }
        }
    }
});

it('si algún día se manda un SMS, la política tiene que volver a explicarse', function (): void {
    if (array_key_exists('sms', Channels::SUPRIMIDOS)) {
        expect(true)->toBeTrue();

        return;
    }

    // El otro lado del mismo guardián. Construir el envío sin devolverle al
    // lector la explicación de STOP y HELP sería el mismo defecto al revés:
    // mandar mensajes sin decir cómo se paran.
    foreach (['es', 'en'] as $idioma) {
        $seccion = hojasSms($idioma)['marketing.privacy.sections.smsConsentAndStop.body'] ?? '';

        expect($seccion)->toMatch('/\bSTOP\b/');
        expect($seccion)->toMatch('/\bHELP\b/');
    }
});

it('la política dice hoy que no se mandan mensajes de texto', function (): void {
    if (! array_key_exists('sms', Channels::SUPRIMIDOS)) {
        expect(true)->toBeTrue();

        return;
    }

    // No basta con quitar la promesa: la sección sigue en la página, numerada,
    // y una sección sobre SMS que no dice nada sobre SMS se lee como un olvido.
    $frases = [
        'es' => 'no envía mensajes de texto',
        'en' => 'does not send text messages',
    ];

    foreach ($frases as $idioma => $frase) {
        $seccion = hojasSms($idioma)['marketing.privacy.sections.smsConsentAndStop.body'] ?? '';

        expect($seccion)->toContain($frase);
    }
});

it('el panel no llama real a un canal que no entrega', function (): void {
    $fuente = Source::compacta(raizSms().'/app/Support/Platform/Providers.php');

    // Escribir TWILIO_SID no manda un mensaje. Mientras no haya emisor, el
    // estado es suyo propio: ni `live` ni `mock` —un simulado responde como el
    // de verdad sin salir a la red, y aquí no hay ni eso.
    expect($fuente)->toContain("'key'=>'sms','interface'=>'SMS','bound'=>'—','status'=>'unbuilt'");

    // Y la fila se identifica: con una raya en la primera columna, el operador
    // veía un estado sin saber de qué. Lo encontré mirando la pantalla, no el
    // código —el guardián estaba verde y la fila era ilegible.
    expect($fuente)->toContain("'interface'=>'SMS'");
    expect($fuente)->not->toContain('services.twilio.sid');

    // Y la pantalla sabe pintarlo, en los dos idiomas.
    $salud = (string) file_get_contents(raizSms().'/resources/js/pages/Platform/Health.tsx');
    expect($salud)->toContain('platform.health.providerUnbuilt');

    foreach (['es', 'en'] as $idioma) {
        assertArrayHasKey(
            'platform.health.providerUnbuilt',
            hojasSms($idioma),
            "falta la copia del estado «sin construir» en {$idioma}",
        );
    }
});

it('la ficha del conductor no enseña un consentimiento que nadie puede dar', function (): void {
    $ficha = (string) file_get_contents(raizSms().'/resources/js/pages/App/Drivers/Show.tsx');
    $controlador = Source::compacta(raizSms().'/app/Http/Controllers/App/DriverController.php');

    // `sms_consent_granted_at` no lo escribe nadie: la fila decía «No otorgado»
    // para todos los conductores, siempre, al lado del consentimiento de
    // rastreo, que sí es real y sí se otorga.
    expect($ficha)->not->toContain('smsConsentAt');
    expect($controlador)->not->toContain('sms_consent_granted_at');

    // El de rastreo, que es el de verdad, sigue en su sitio: quitar de más
    // sería el otro modo de mentir.
    expect($ficha)->toContain('drivers.detail.trackingConsent');
});

it('la lista de subencargados no nombra a quien no recibe un dato', function (): void {
    // Cuatro categorías de la política —SMS, OCR, mapas y datos de rastreo— no
    // reciben nada de nadie. Cada una se comprueba contra el código que la
    // desmiente, no contra una lista escrita a mano aquí: si alguien ata un
    // proveedor de verdad, la comprobación que le toca deja de aplicarse sola.
    $servicios = Source::compacta(raizSms().'/app/Providers/AppServiceProvider.php');
    $verificacion = Source::compacta(raizSms().'/app/Support/Equipment/Verification.php');

    $ausentes = [];

    if (array_key_exists('sms', Channels::SUPRIMIDOS)) {
        $ausentes['SMS'] = '/(entrega de SMS|SMS delivery|servicio de mensajer[íi]a|messaging service)/iu';
    }

    // Las rutas y el progreso salen de las paradas, dentro de la aplicación.
    if (str_contains($servicios, 'RouteProvider::class,StopDerivedRouteProvider::class')) {
        $ausentes['mapas'] = '/(mapas y rutas|mapping and routing)/iu';
    }

    if (str_contains($servicios, 'TrackingProvider::class,StopDerivedTrackingProvider::class')) {
        $ausentes['datos de rastreo'] = '/(proveedores de datos de rastreo|tracking data providers)/iu';
    }

    // «Las columnas existen y se quedan vacías», dice la propia clase.
    if (str_contains($verificacion, "'extracted_vins'=>'[]'")) {
        $ausentes['OCR'] = '/(extracci[óo]n de texto|text extraction)/iu';
    }

    expect($ausentes)->not->toBe([], 'ningún proveedor ausente que comprobar: revise este guardián');

    foreach (['es', 'en'] as $idioma) {
        $lista = hojasSms($idioma)['marketing.privacy.sections.subprocessors.body'] ?? '';

        expect($lista)->not->toBe('', "falta la lista de subencargados en {$idioma}");

        foreach ($ausentes as $quien => $aguja) {
            // Nombrarlo para DECIR QUE NO se usa es legítimo y es justamente lo
            // que dice ahora la política; lo que no puede es aparecer en la
            // enumeración de quién recibe datos. Por eso se mira solo la
            // primera frase, que es la enumeración.
            $enumeracion = explode('.', $lista)[0];

            expect(preg_match($aguja, $enumeracion))->toBe(
                0,
                "la lista de subencargados ({$idioma}) nombra {$quien}, y no recibe ningún dato",
            );
        }
    }
});
