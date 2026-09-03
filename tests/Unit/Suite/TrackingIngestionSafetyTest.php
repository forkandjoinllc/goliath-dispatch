<?php

declare(strict_types=1);

use App\Services\Tracking\StopDerivedTrackingProvider;
use App\Support\Tracking\Ingestion;
use App\Support\Tracking\Timeline;
use Carbon\CarbonImmutable;
use Tests\Support\Source;

/**
 * Que las posiciones no se inventen, no se dupliquen y no se le enseñen de más
 * a un cliente.
 *
 * ## El defecto que este lote quitó
 *
 * `tracking_events` llevaba vacía desde el primer día y `load_stops.
 * actual_arrival_at` se LEÍA en tres pantallas sin que nada la escribiera nunca.
 * Al cliente al que se le manda un enlace con el logo de su casa de despacho se
 * le enseñaba una lista de paradas donde todas ponían «pendiente» para siempre,
 * también con la carga ya entregada.
 *
 * ## Lo que este guardián sujeta
 *
 * 1. **No se inventa una coordenada.** Es lo más fácil de deshacer sin querer:
 *    basta con que alguien, para pintar un mapa bonito, interpole un punto entre
 *    dos ciudades. En esta aplicación NO HAY coordenadas —`load_stops.latitude`
 *    está vacía en todas partes— así que cualquier punto sería inventado, y un
 *    punto inventado en un mapa es la forma más convincente que tiene un dato
 *    falso de parecer verdadero.
 * 2. **La idempotencia la impone el índice**, no una comprobación previa.
 * 3. **El consentimiento sigue siendo una puerta** para lo que manda un aparato.
 * 4. **La página del cliente enseña menos que el panel.**
 *
 * `tests/Unit` no arranca la aplicación: se lee el código, como en los demás
 * guardianes de esta carpeta.
 */
function raizIngesta(): string
{
    return dirname(__DIR__, 3);
}

function codigoDeIngestaSinComentarios(string $ruta): string
{
    // El cuerpo vivía copiado en quince ficheros. Ver Tests\Support\Source:
    // no quitaba los espacios, y por eso varias agujas de esta carpeta no
    // podían casar con nada.
    return Source::sinComentarios($ruta);
}

it('el proveedor deducido no reporta nada por su cuenta y lo dice', function (): void {
    $proveedor = new StopDerivedTrackingProvider;

    expect($proveedor->isLive())->toBeFalse(
        'El adaptador deducido dice ser un proveedor de verdad. Es el que existe cuando NO hay ninguno: '
        .'si `isLive()` miente, la pantalla deja de avisar de que nadie está mandando posiciones.'
    );

    expect($proveedor->poll(['id' => 'x']))->toBe([],
        'El adaptador deducido está reportando posiciones por su cuenta. No sabe dónde está el camión: '
        .'nadie se lo dice. Lo que devuelva aquí es necesariamente inventado.'
    );

    // El nombre tiene que caber en la restricción del esquema, o el INSERT lo
    // rechaza la base de datos en producción y no aquí.
    expect(['mock', 'trucker_tools', 'macropoint', 'highway', 'manual'])
        ->toContain($proveedor->name());
});

it('el proveedor deducido nunca produce una coordenada', function (): void {
    $paradas = [
        ['id' => 'a', 'stop_type' => 'pickup', 'city' => 'Laredo', 'state' => 'TX'],
        ['id' => 'b', 'stop_type' => 'delivery', 'city' => 'Dallas', 'state' => 'TX'],
    ];

    $partes = (new StopDerivedTrackingProvider)->simulate(
        'sesion-1',
        $paradas,
        CarbonImmutable::parse('2026-09-01 06:00:00'),
        minutos: 10000,
    );

    expect($partes)->not->toBeEmpty();

    foreach ($partes as $parte) {
        expect($parte->latitude)->toBeNull(
            'El adaptador deducido produjo una latitud. No hay una sola coordenada en toda la aplicación: '
            .'`load_stops.latitude` no la escribe nadie, así que esto solo puede haberla inventado.'
        );
        expect($parte->longitude)->toBeNull();
    }
});

it('la simulación es idempotente por construcción', function (): void {
    $paradas = [
        ['id' => 'a', 'stop_type' => 'pickup', 'city' => 'Laredo', 'state' => 'TX'],
        ['id' => 'b', 'stop_type' => 'delivery', 'city' => 'Dallas', 'state' => 'TX'],
    ];

    $proveedor = new StopDerivedTrackingProvider;
    $desde = CarbonImmutable::parse('2026-09-01 06:00:00');

    // Dos llamadas iguales tienen que dar las MISMAS referencias: es lo que hace
    // que la segunda choque contra el índice único en vez de duplicar la línea
    // de tiempo del cliente. Si las referencias llevaran la hora de ahora,
    // cambiarían en cada pulsación y no idempotarían nada.
    $unas = array_map(fn ($p) => $p->reference, $proveedor->simulate('s1', $paradas, $desde, 300));
    $otras = array_map(fn ($p) => $p->reference, $proveedor->simulate('s1', $paradas, $desde, 300));

    expect($unas)->toBe($otras)->and($unas)->toBe(array_unique($unas));

    // Y sesiones distintas no comparten referencia, o la segunda sesión de una
    // carga nacería con la línea de tiempo de la primera.
    $deOtra = array_map(fn ($p) => $p->reference, $proveedor->simulate('s2', $paradas, $desde, 300));
    expect(array_intersect($unas, $deOtra))->toBe([]);
});

it('la ingesta comprueba el consentimiento y deduplica con el índice', function (): void {
    $codigo = codigoDeIngestaSinComentarios(raizIngesta().'/app/Support/Tracking/Ingestion.php');

    expect(str_contains($codigo, 'Consent::permiteRastrear'))->toBeTrue(
        'La ingesta acepta partes de un proveedor sin comprobar el consentimiento. La pantalla del conductor '
        .'promete que el rastreo «se detiene de inmediato si el consentimiento se retira»: cerrar la sesión no '
        .'basta si el parte que llega un segundo después entra igual.'
    );

    expect(str_contains($codigo, 'insertOrIgnore'))->toBeTrue(
        'La ingesta dejó de apoyarse en el índice único para deduplicar. Comprobar antes de insertar es la '
        .'carrera clásica: dos entregas del mismo webhook ven las dos que no hay nada.'
    );

    // Que las coordenadas se copien del parte y no se calculen aquí.
    expect(str_contains($codigo, "'latitude' => \$parte->latitude"))->toBeTrue(
        'La ingesta está calculando la latitud en vez de copiarla del parte. Solo el proveedor sabe dónde está '
        .'el camión, y el deducido no lo sabe.'
    );
});

it('marcar una parada no depende del rastreo', function (): void {
    $codigo = codigoDeIngestaSinComentarios(raizIngesta().'/app/Support/Tracking/StopProgress.php');

    // Es la mitad que tiene que funcionar HOY, sin proveedor y sin
    // consentimiento: despacho documentando el viaje. Atarla al consentimiento
    // del conductor daría a entender que sin su permiso la carga tampoco se
    // puede documentar, y dejaría al cliente con «pendiente» para siempre otra
    // vez.
    expect(str_contains($codigo, 'Consent::'))->toBeFalse(
        'Marcar la llegada a una parada pasa ahora por el consentimiento de rastreo. Son dos cosas distintas: '
        .'el consentimiento es para que un APARATO mande la posición de una persona; esto es despacho anotando '
        .'un hecho del viaje.'
    );

    expect(str_contains($codigo, 'Ingestion::manual'))->toBeTrue(
        'La llegada a una parada ya no entra en la línea de tiempo, así que el cliente no la ve.'
    );
});

it('la página del cliente enseña menos que el panel', function (): void {
    $codigo = codigoDeIngestaSinComentarios(raizIngesta().'/app/Support/Tracking/Timeline.php');

    // Las coordenadas no se seleccionan siquiera para el cliente: no puede
    // filtrarlas quien no las tiene.
    expect(str_contains($codigo, 'latitude'))->toBeFalse(
        'La línea de tiempo empezó a leer coordenadas. La lee la página pública, que abre cualquiera con el '
        .'enlace: un cliente no necesita el punto exacto donde está un conductor.'
    );

    expect(str_contains($codigo, 'consent_'))->toBeTrue(
        'La versión para el cliente dejó de filtrar los sucesos de consentimiento. Son asunto entre el '
        .'conductor y su empresa, no de quien compró un flete.'
    );

    // Y el tope existe: una carga larga con GPS de verdad produce miles de
    // sucesos, y la página pública no lleva sesión que la proteja.
    expect(Timeline::TOPE)->toBeLessThanOrEqual(500);
});

it('los umbrales de salud están ordenados', function (): void {
    // Al revés, una sesión «perdida» nunca se alcanzaría y todo se quedaría en
    // «desactualizado» para siempre.
    expect(Ingestion::HORAS_PERDIDO)->toBeGreaterThan(Ingestion::HORAS_DESACTUALIZADO);

    $ahora = CarbonImmutable::now();

    expect(Ingestion::salud(false, $ahora))->toBe('healthy')
        ->and(Ingestion::salud(false, $ahora->subHours(Ingestion::HORAS_DESACTUALIZADO)))->toBe('stale')
        ->and(Ingestion::salud(false, $ahora->subHours(Ingestion::HORAS_PERDIDO)))->toBe('lost')
        ->and(Ingestion::salud(true, $ahora))->toBe('ended');
});

it('la simulación está cerrada en producción', function (): void {
    $codigo = codigoDeIngestaSinComentarios(
        raizIngesta().'/app/Http/Controllers/App/TrackingController.php'
    );

    // Mientras no exista un adaptador de GPS real, el proveedor atado es el
    // deducido TAMBIÉN en producción. Sin esta puerta, cualquier administrador
    // tendría en su servidor de verdad un botón que mete sucesos inventados en
    // la línea de tiempo que su cliente está mirando por un enlace.
    //
    // Una herramienta de desarrollo que existe en producción no es una
    // herramienta de desarrollo.
    expect(str_contains($codigo, "App::environment('production')"))->toBeTrue(
        'El simulador de movimiento dejó de estar cerrado en producción.'
    );
});
