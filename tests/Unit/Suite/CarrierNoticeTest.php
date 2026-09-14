<?php

declare(strict_types=1);

use App\Authorization\RoleMatrix;
use App\Enums\Role;
use App\Enums\Scope;
use App\Support\Loads\RateResponse;
use App\Support\Notifications\Events;
use Tests\Support\Source;

use function PHPUnit\Framework\assertArrayHasKey;
use function PHPUnit\Framework\assertContains;

/**
 * Nadie configura un aviso que no puede llegarle, y a nadie le llega lo ajeno.
 *
 * ## El defecto
 *
 * La pantalla «De qué se le avisa» ofrecía los mismos diecisiete interruptores
 * a todo el mundo. A un transportista y a un conductor **no puede llegarles
 * ninguno**: `Notifier::recipients()` exige alcance de empresa o más, y esos
 * dos roles lo tienen todo con alcance de transportista o propio. Diecisiete
 * casillas que no encienden nada.
 *
 * Y la regla del emisor era correcta —avisar a un transportista de que «hay
 * facturas vencidas» le contaría que existen las de los demás—. Lo que faltaba
 * era la otra mitad: avisarle de LO SUYO.
 *
 * Detrás había dos silencios. Al rechazar un documento, la pantalla le exige al
 * revisor diez caracteres de motivo porque «el transportista lo va a leer», y
 * nada se lo decía; igual con las notas de correcciones de la incorporación.
 *
 * ## Lo que vigila este fichero
 *
 * Que el catálogo no envejezca —un suceso que se emite y no está declarado, o
 * declarado y sin emisor, son las dos formas de que la pantalla y la realidad
 * dejen de coincidir—, que la lista que se enseña salga del catálogo y no de
 * una copia a mano, y que la vía del transportista filtre por las tres cosas.
 *
 * Quien MIDE el aislamiento es `tests/Feature/Notifications/CarrierNoticeTest.php`:
 * planta otro transportista y comprueba que no le llega nada.
 */
function raizAvisoTransportista(): string
{
    return Source::root();
}

it('todo suceso que se emite está en el catálogo, y al revés', function (): void {
    $fuente = '';

    foreach ([
        '/app/Console/Commands/SweepNotifications.php',
        '/app/Support/Signatures/Outcome.php',
        '/app/Support/Leads/Arrival.php',
        '/app/Support/Loads/RateResponse.php',
        '/app/Http/Controllers/App/LeadController.php',
        '/app/Http/Controllers/App/DocumentController.php',
        '/app/Http/Controllers/App/CarrierOnboardingController.php',
    ] as $ruta) {
        $fuente .= Source::sinComentarios(raizAvisoTransportista().$ruta);
    }

    // Los que se escriben literales en un `eventKey:`.
    preg_match_all("/eventKey:\s*'([\w.]+)'/", $fuente, $m);

    foreach (array_unique($m[1]) as $suceso) {
        assertArrayHasKey(
            $suceso,
            Events::CATALOGO,
            "se emite «{$suceso}» y el catálogo no lo conoce: nadie puede apagarlo",
        );
    }

    // Y al revés, con los que salen de una constante: si un suceso declarado
    // no lo emite nadie, es un interruptor para algo que no ocurre.
    $sinEmisor = [];

    // Los de la confirmación de tarifa NO se escriben literales: se arman con
    // `'load.rateconf.'.$decision` sobre `RateConfirmation::DECISIONES`. Se
    // preguntan a la clase que los arma en vez de buscarlos como texto — que
    // es lo que hice primero, y daba por no emitidos dos que sí se emiten.
    // Y no vale con mirar detrás de `eventKey:`: la mitad salen de una
    // constante (`Outcome::FIRMADA`) o de un ternario
    // (`$caducado ? 'document.expired' : 'document.expiring'`). Se busca la
    // cadena en cualquier posición de los emisores, y los de la tarifa se le
    // preguntan a la clase que los arma.
    $armados = RateResponse::sucesos();

    foreach (array_keys(Events::CATALOGO) as $suceso) {
        if (! str_contains($fuente, "'{$suceso}'") && ! in_array($suceso, $armados, true)) {
            $sinEmisor[] = $suceso;
        }
    }

    expect($sinEmisor)->toBe([], 'sucesos declarados que no emite nadie: '.implode(', ', $sinEmisor));
});

it('cada suceso declara un permiso que existe y un público conocido', function (): void {
    foreach (Events::CATALOGO as $suceso => [$permiso, $publico]) {
        expect([Events::OFICINA, Events::TRANSPORTISTA])->toContain($publico);

        // El permiso tiene que existir en la matriz de ALGÚN rol: uno
        // inventado deja el suceso sin destinatario posible y nadie lo nota,
        // porque no recibir un aviso se parece mucho a que no haya pasado nada.
        $conocido = false;

        foreach (Role::cases() as $rol) {
            if (array_key_exists($permiso, RoleMatrix::for($rol))) {
                $conocido = true;

                break;
            }
        }

        expect($conocido)->toBeTrue("«{$suceso}» declara el permiso «{$permiso}», que no está en ninguna matriz");
    }
});

it('a la oficina le llegan los suyos y al transportista los suyos', function (): void {
    $admin = Events::paraRol(Role::Admin);
    $transportista = Events::paraRol(Role::Carrier);
    $conductor = Events::paraRol(Role::Driver);

    // La oficina sigue viendo lo de siempre.
    assertContains('invoice.overdue', $admin, 'el administrador dejó de ver las facturas vencidas');
    assertContains('document.expiring', $admin);

    // Y NO ve como suyos los dos del transportista: son avisos dirigidos, no
    // una copia de la decisión que acaba de tomar él mismo.
    expect($admin)->not->toContain('document.rejected');
    expect($admin)->not->toContain('onboarding.corrections_required');

    // El transportista ve exactamente lo suyo, y nada de la oficina.
    expect($transportista)->toBe(['document.rejected', 'onboarding.corrections_required']);

    // El conductor, por ahora, nada: no tiene ningún suceso dirigido a él y la
    // pantalla se lo dice en vez de enseñarle interruptores muertos. El día que
    // se le dirija uno, esta línea se pone roja y hay que decidirlo a la cara.
    expect($conductor)->toBe([]);
});

it('la pantalla ofrece lo que sale del catálogo, no una lista a mano', function (): void {
    $fuente = Source::compacta(raizAvisoTransportista().'/app/Http/Controllers/App/NotificationController.php');

    // La lista de diecisiete estaba escrita aquí dentro. Mientras lo estuviera,
    // añadir un suceso obligaba a acordarse de dos sitios.
    expect($fuente)->toContain('Events::paraRol($actor->role)');
    expect($fuente)->not->toContain("'document.expiring','document.expired'");

    // Y lo que se valida al guardar es lo mismo que se enseña: si no, se puede
    // escribir la preferencia de un suceso que no llega.
    expect(substr_count($fuente, 'self::eventosDe($actor)'))->toBeGreaterThanOrEqual(3);
});

it('la vía del transportista filtra por empresa, transportista y rol', function (): void {
    $fuente = Source::compacta(raizAvisoTransportista().'/app/Support/Notifications/Notifier.php');

    // Las tres juntas. Quien llama pasa un id de transportista; sin el filtro
    // por empresa, un id de otra empresa devolvería a los de la otra.
    expect($fuente)->toContain("->where('tenant_id',\$tenantId)->where('carrier_id',\$carrierId)->where('role',Role::Carrier->value)");
    expect($fuente)->toContain("->where('status','active')");

    // Y el permiso se comprueba, como en la otra vía.
    expect($fuente)->toContain('RoleMatrix::for(Role::Carrier)[$permission]');
});

it('la regla de la oficina no se ha relajado', function (): void {
    // Lo que hacía falta era una vía NUEVA, no ablandar la que había: si
    // `recipients()` dejara de exigir alcance de empresa, un transportista
    // empezaría a recibir los avisos de todos los demás.
    $fuente = Source::compacta(raizAvisoTransportista().'/app/Support/Notifications/Notifier.php');

    expect($fuente)->toContain('$alcance->atLeast(Scope::Tenant)');

    // Y la comprobación de la vía nueva es la del transportista, más estrecha
    // que la de la oficina y nunca al revés.
    expect(Scope::Carrier->atLeast(Scope::Tenant))->toBeFalse();
    expect(Scope::Tenant->atLeast(Scope::Carrier))->toBeTrue();
});

it('los dos sucesos nuevos tienen copia en los dos idiomas', function (): void {
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(raizAvisoTransportista()."/lang/{$idioma}/notifications.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        foreach ([['document', 'rejected'], ['onboarding', 'corrections_required']] as [$grupo, $clave]) {
            expect($d['events'][$grupo][$clave]['title'] ?? null)->toBeString("falta el título de {$grupo}.{$clave} en {$idioma}");
            expect($d['events'][$grupo][$clave]['body'] ?? null)->toBeString("falta el cuerpo de {$grupo}.{$clave} en {$idioma}");
            expect($d['eventNames'][$grupo][$clave] ?? null)->toBeString("falta el nombre de {$grupo}.{$clave} en {$idioma}");
        }

        expect($d['preferences']['nothingForYou'] ?? null)->toBeString();
    }

    // La copia PORTADA de estos dos sucesos estaba escrita para la oficina —«El
    // documento X de {ownerName} fue rechazado»— y aquí el que lee es el dueño
    // del documento. Decirle a alguien «el documento de Acme» cuando él ES Acme
    // es la clase de detalle que delata que el texto se copió sin mirar.
    $es = json_decode((string) file_get_contents(raizAvisoTransportista().'/lang/es/notifications.json'), true);

    expect($es['events']['document']['rejected']['body'])->not->toContain('{ownerName}');
    expect($es['events']['onboarding']['corrections_required']['body'])->not->toContain('{carrierName}');
});
