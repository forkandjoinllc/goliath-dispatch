<?php

declare(strict_types=1);

use App\Support\Time\Clock;
use App\Support\Time\Pending;
use Tests\Support\Source;

/**
 * La segunda mitad de una regla que llevaba escrita desde el puerto.
 *
 * ## El defecto
 *
 * `docs/mysql-port.md` lo dice con estas palabras:
 *
 * > MySQL no tiene equivalente de `timestamptz`: no guarda la zona. La
 * > aplicación almacena UTC y **resuelve la zona al presentar**.
 *
 * La primera mitad se cumplía. La segunda no se hacía en NINGÚN sitio fuera de
 * las paradas de carga. Sesenta y tantas marcas de tiempo salían a pantalla así:
 *
 *     'signedAt' => substr((string) $registro->signed_at, 0, 16),
 *
 * En UTC, sin etiqueta y sin convertir. Cuándo se firmó un documento, cuándo
 * entró un mensaje, cuándo se aprobó un transportista. Para una casa de
 * despacho de Chicago, todo una hora por delante en verano; para una de Los
 * Ángeles, tres.
 *
 * Y lo que lo cerraba: `users.timezone` existe desde el primer esquema, con
 * `America/New_York` por omisión, se carga en el `Actor`… y no lo leía nadie.
 * Encima no había pantalla donde cambiarlo, así que ni siquiera era un ajuste
 * mal aplicado: era una columna muerta.
 *
 * ## Qué vigila este guardián
 *
 * Cuatro cosas, y la tercera es la que de verdad se compra:
 *
 *  1. Que la conversión y la etiqueta hagan lo que dicen.
 *  2. Que el huso se pueda FIJAR: ruta, validación y sitio en la barra.
 *  3. Que un fichero nuevo no pueda sacar una hora en crudo sin declararlo en
 *     `Pending::SIN_CONVERTIR`. La deuda que queda está contada; la que se
 *     intente añadir, no cabe.
 *  4. Que las pantallas ya convertidas no vuelvan atrás.
 *
 * ## Por qué la cuenta va por fichero y no una lista de «prohibido»
 *
 * Porque una lista de prohibiciones se satisface cambiando la forma de escribir
 * lo mismo. Un número por fichero no: para bajarlo hay que arreglar un sitio, y
 * para subirlo hay que editar `Pending` a mano y explicar por qué —y eso es más
 * trabajo que hacerlo bien.
 */
function raizVista(): string
{
    return Source::root();
}

/**
 * Cómo se reconoce una hora sacada en crudo.
 *
 * `substr(...)` sobre algo que se llama `..._at` y recortado a 10, 16 o 19
 * caracteres. Los tres cortes son los que usa la aplicación: día, minuto y
 * segundo.
 *
 * `(?<!_)` está para que no case `mb_substr` —ni `iconv_substr` ni
 * `grapheme_substr`—, que recortan nombres de fichero y huellas y no tienen
 * nada que ver con relojes. Sin eso el censo daba dieciocho sitios de más y el
 * guardián habría exigido explicar deuda que no existe.
 *
 * La primera versión decía `(?<![a-z_])` y ERA UN AGUJERO. Sobre el fichero
 * compactado no hay espacios, así que `return substr(...)` se lee
 * `returnsubstr(` y la letra anterior es la `n` de `return`: la aguja lo
 * descartaba. Un fichero nuevo que sacara la hora con un `return` directo
 * pasaba el guardián sin declarar nada. Lo cazó el sabotaje de «un fichero sin
 * declarar saca una hora cruda», que es la comprobación por la que existe todo
 * esto — y solo lo cazó al repetir la tanda contra un árbol verificado en
 * verde.
 *
 * Solo casa columnas con `_at` en el nombre. Es la convención de TODO el
 * esquema, pero no es una garantía: un alias sin `_at` —`min(created_at) as
 * mas_viejo`— se escapa. Aparecieron tres al montar esto y se convirtieron en
 * el sitio en vez de inventar maquinaria para seguirles la pista. Queda dicho
 * para quien añada un alias así.
 */
const AGUJA_HORA_CRUDA = '/(?<!_)substr\(\(string\)[^;]{0,180}?_at[^;]{0,80}?,0,(?:10|16|19)\)/';

/**
 * Los sitios sancionados para presentar una hora sin convertirla.
 *
 * `Clock` porque ahí viven `literal()` y `utc()`, que son eso mismo con nombre
 * y motivo. `StopClock` porque `window()` es la hora del muelle, que no se
 * convierte a propósito.
 *
 * @var list<string>
 */
const EXENTOS_DEL_RELOJ = [
    'app/Support/Time/Clock.php',
    'app/Support/Loads/StopClock.php',
];

/**
 * Cuántas horas en crudo saca cada fichero de verdad.
 *
 * @return array<string, int>
 */
function horasCrudasPorFichero(): array
{
    $encontrado = [];

    foreach (['app/Http/Controllers', 'app/Support'] as $carpeta) {
        $arbol = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator(raizVista().'/'.$carpeta)
        );

        foreach ($arbol as $fichero) {
            if ($fichero->getExtension() !== 'php') {
                continue;
            }

            $relativo = str_replace(raizVista().'/', '', str_replace('\\', '/', $fichero->getPathname()));

            if (in_array($relativo, EXENTOS_DEL_RELOJ, true)) {
                continue;
            }

            // compacta() y no sinComentarios(): la aguja está escrita sin
            // espacios porque lo que busca cruza saltos de línea —media docena
            // de estos sitios son ternarios de tres renglones— y porque un
            // comentario que MENCIONE el defecto (los hay, en Clock y en
            // PresentsTime) no debe contar como defecto.
            $cuenta = preg_match_all(AGUJA_HORA_CRUDA, Source::compacta($fichero->getPathname()));

            if ($cuenta > 0) {
                $encontrado[$relativo] = $cuenta;
            }
        }
    }

    return $encontrado;
}

/* ── La conversión hace lo que dice ──────────────────────────────────────── */

it('un instante en UTC se enseña en el huso pedido', function (): void {
    // Medido de verdad: 13:04 UTC son las 08:04 en Chicago en septiembre.
    expect(Clock::at('2026-09-08 13:04:11', 'America/Chicago'))->toBe('2026-09-08 08:04');
});

it('la etiqueta del huso cambia con la estación', function (): void {
    expect(Clock::label('America/Chicago', '2026-07-15 12:00:00'))->toBe('CDT');
    expect(Clock::label('America/Chicago', '2026-01-15 12:00:00'))->toBe('CST');
});

it('un huso sin horario de verano no cambia de etiqueta', function (): void {
    // Phoenix está en la lista precisamente por esto: es el sitio donde la
    // diferencia con Denver aparece y desaparece dos veces al año.
    expect(Clock::label('America/Phoenix', '2026-07-15 12:00:00'))->toBe('MST');
    expect(Clock::label('America/Phoenix', '2026-01-15 12:00:00'))->toBe('MST');
});

it('la conversión no pierde el día al cruzar la medianoche', function (): void {
    // Las 03:00 UTC son las 22:00 del día ANTERIOR en Chicago. Es el error que
    // se cuela en los recortes a diez caracteres, que quedan pendientes.
    expect(Clock::at('2026-09-09 03:00:00', 'America/Chicago'))->toBe('2026-09-08 22:00');
});

it('un huso roto en la fila no tumba la pantalla', function (): void {
    expect(Clock::at('2026-09-08 13:04:11', 'Marte/Olympus'))->toBe('2026-09-08 09:04');
    expect(Clock::zona('Marte/Olympus'))->toBe(Clock::POR_OMISION);
    expect(Clock::zona(''))->toBe(Clock::POR_OMISION);
    expect(Clock::zona(null))->toBe(Clock::POR_OMISION);
});

it('un nulo sigue siendo nulo y no se convierte en una fecha inventada', function (): void {
    expect(Clock::at(null, 'America/Chicago'))->toBeNull();
    expect(Clock::literal(null))->toBeNull();
    expect(Clock::utc(null))->toBeNull();
});

it('lo que escribió una persona NO se mueve', function (): void {
    // Un permiso emitido a las 08:00 dice 08:00 para todo el mundo. Si esto
    // convirtiera, movería una hora de verdad.
    expect(Clock::literal('2026-09-08 08:00:00'))->toBe('2026-09-08 08:00');
});

/* ── El huso se puede fijar de verdad ────────────────────────────────────── */

it('hay una ruta para cambiar el huso', function (): void {
    $rutas = Source::sinComentarios(raizVista().'/routes/auth.php');

    test()->assertStringContainsString(
        "Route::post('timezone', TimezoneController::class)",
        $rutas,
        'Sin ruta, users.timezone vuelve a ser una columna que solo se cambia con un UPDATE a mano.',
    );
});

it('la ruta solo acepta los husos que el desplegable ofrece', function (): void {
    $fuente = Source::compacta(raizVista().'/app/Http/Controllers/App/TimezoneController.php');

    test()->assertStringContainsString(
        'Rule::in(Clock::opciones())',
        $fuente,
        'Con timezone_identifiers_list() se puede dejar la cuenta en un huso que ninguna pantalla vuelve a ofrecer, y desde el que no se puede salir.',
    );
});

it('el huso viaja en el armazón, que se pinta en todas las pantallas', function (): void {
    $fuente = Source::compacta(raizVista().'/app/Support/AppShell.php');

    foreach (["'timezone'=>Clock::zona(\$actor->timezone)", "'zone'=>Clock::label(\$actor->timezone)", "'options'=>Clock::opciones()"] as $aguja) {
        test()->assertStringContainsString($aguja, $fuente, 'El armazón tiene que llevar el reloj: la barra superior se pinta en todas las páginas.');
    }
});

it('la barra superior enseña el huso y deja cambiarlo', function (): void {
    $barra = file_get_contents(raizVista().'/resources/js/components/App/Topbar.tsx');

    foreach (['{shell.clock.zone}', "router.post('/timezone'", '<TimezoneMenu shell={shell} />'] as $aguja) {
        test()->assertStringContainsString($aguja, (string) $barra, 'La abreviatura se dice UNA vez, en la barra, y ahí mismo se cambia.');
    }
});

it('los ocho husos tienen rótulo en los dos idiomas', function (): void {
    foreach (['en', 'es'] as $idioma) {
        $diccionario = json_decode((string) file_get_contents(raizVista()."/lang/{$idioma}/nav.json"), true);

        expect($diccionario['userMenu']['timezone'] ?? null)->toBeString();
        expect($diccionario['userMenu']['timezoneHint'] ?? null)->toBeString();

        foreach (Clock::opciones() as $huso) {
            expect($diccionario['clock'][$huso] ?? null)->toBeString()
                ->and($diccionario['clock'][$huso])->not->toBe('');
        }
    }
});

it('a quien se invita se le pone el huso de la empresa, no el del esquema', function (): void {
    $fuente = Source::compacta(raizVista().'/app/Actions/Tenancy/InviteUser.php');

    test()->assertStringContainsString(
        "'timezone'=>\$this->tenantTimezone(\$tenantId),",
        $fuente,
        'Una casa de despacho de Chicago que invita a diez personas las pondría a todas una hora por delante.',
    );
});

/* ── Las pantallas convertidas no vuelven atrás ──────────────────────────── */

it('las pantallas convertidas usan el reloj de quien mira', function (): void {
    // Fichero => cuántas conversiones tiene que haber. El número es lo que
    // impide que un cambio se lleve la mitad de las llamadas por delante sin
    // que nada se queje.
    $convertidas = [
        'app/Http/Controllers/App/SignatureController.php' => 10,
        'app/Http/Controllers/App/PermitController.php' => 7,
        'app/Http/Controllers/App/OnboardingController.php' => 7,
        'app/Http/Controllers/App/MessageController.php' => 1,
        'app/Http/Controllers/Platform/HealthController.php' => 2,
    ];

    foreach ($convertidas as $fichero => $cuantas) {
        $fuente = Source::compacta(raizVista().'/'.$fichero);

        expect(substr_count($fuente, '$this->hora('))->toBe(
            $cuantas,
            "{$fichero} tenía {$cuantas} horas convertidas y ahora tiene otra cuenta.",
        );

        test()->assertStringContainsString('usePresentsTime;', $fuente, "{$fichero} usa \$this->hora() y tiene que declarar el trait.");
    }
});

it('las ayudas estáticas usan la misma puerta', function (): void {
    $estaticas = [
        'app/Support/Messaging/Inbox.php' => 3,
        'app/Support/Onboarding/Readiness.php' => 2,
        'app/Support/Fmcsa/RevalidationState.php' => 1,
        'app/Http/Controllers/App/MessageController.php' => 1,
        // Los dos de aquí estaban escritos con $this->hora() y REVENTABAN en
        // marcha: el map de la lista de avisos es un `static fn`. Un guardián
        // que lee el código no lo puede ver —el texto es idéntico— y lo cazó la
        // prueba de integración al pedir la página de verdad. Queda contado
        // aquí para que no vuelva a escribirse con $this.
        'app/Http/Controllers/App/NotificationController.php' => 2,
    ];

    foreach ($estaticas as $fichero => $cuantas) {
        expect(substr_count(Source::compacta(raizVista().'/'.$fichero), 'Viewer::at('))->toBe(
            $cuantas,
            "{$fichero}: un trait no sirve donde el método es estático, y Viewer es la misma regla.",
        );
    }
});

it('ninguna de las tres copias de minute() ha vuelto', function (): void {
    // Tres controladores llevaban la MISMA función privada copiada. Fue la
    // palanca de este lote: borrarla en los tres obligaba a decidir qué hacía
    // cada llamada.
    foreach (['PermitController', 'OnboardingController', 'SignatureController'] as $controlador) {
        $fuente = Source::compacta(raizVista()."/app/Http/Controllers/App/{$controlador}.php");

        expect($fuente)->not->toContain('privatefunctionminute(mixed$valor)');
    }
});

it('el permiso que emite un estado NO se convierte al huso de quien mira', function (): void {
    // Estas tres las teclea una persona en un datetime-local y significan la
    // hora del sitio donde ocurre la cosa. Convertirlas las MOVERÍA: un permiso
    // emitido a las 08:00 diría 07:00 para quien mira desde otro huso, y no hay
    // ningún sentido en el que eso sea más cierto.
    $fuente = Source::compacta(raizVista().'/app/Http/Controllers/App/PermitController.php');

    foreach (["'issuedAt'=>Clock::literal(\$p->issued_at)", "'expiresAt'=>Clock::literal(\$p->expires_at)", "'scheduledFor'=>Clock::literal(\$e->scheduled_for)"] as $aguja) {
        test()->assertStringContainsString($aguja, $fuente, 'Convertir una hora que escribió una persona la mueve.');
    }
});

it('el certificado de auditoría se queda en UTC y lo dice', function (): void {
    // La única superficie que NO se convierte a propósito. Un certificado se
    // archiva y se le enseña a un tercero: si la hora dependiera de quién pulsó
    // el botón, dos copias del mismo documento dirían cosas distintas del mismo
    // acto.
    $firma = Source::compacta(raizVista().'/app/Support/Signatures/Signing.php');
    test()->assertStringContainsString("'at'=>Clock::utc(\$e->occurred_at)", $firma, 'El certificado se queda en UTC a propósito, y con nombre.');

    $papel = Source::sinComentarios(raizVista().'/app/Support/Signatures/Renderer.php');
    test()->assertStringContainsString("'when' => 'Cuándo (UTC)'", $papel, 'Una hora sin reloj en el documento donde más importa cuándo pasó algo.');
    test()->assertStringContainsString("'when' => 'When (UTC)'", $papel, 'Y en los dos idiomas.');
});

it('la pantalla no recorta la hora otra vez por su cuenta', function (): void {
    // El front-end era la tercera forma del mismo defecto, y la que un guardián
    // sobre PHP no ve: `Inbox` mandaba la cadena UTC entera y el componente
    // hacía `.slice(0, 16)`. Convertir en el servidor y seguir recortando en el
    // navegador daría una hora convertida y luego troceada.
    foreach (['App/Messages/Show', 'App/Notifications/Index'] as $pagina) {
        $fuente = (string) file_get_contents(raizVista()."/resources/js/pages/{$pagina}.tsx");

        expect($fuente)->not->toContain('createdAt.slice(')
            ->and($fuente)->not->toContain("createdAt.replace('T'");
    }
});

/* ── Lo que falta está contado ───────────────────────────────────────────── */

it('cada hora en crudo que queda está declarada con su cuenta', function (): void {
    $real = horasCrudasPorFichero();

    foreach ($real as $fichero => $cuantas) {
        // assertArrayHasKey y NO expect()->toHaveKey($clave, $mensaje): el
        // segundo argumento de toHaveKey es el VALOR esperado, no un mensaje.
        // Misma familia que toContain, que ya costó cuatro lotes.
        test()->assertArrayHasKey(
            $fichero,
            Pending::SIN_CONVERTIR,
            "{$fichero} saca {$cuantas} hora(s) en UTC sin convertir y no está en Pending::SIN_CONVERTIR. ".
            'Conviértelas con Viewer::at()/$this->hora(), o —si la hora la escribió una persona— con Clock::literal(), '.
            'o declara aquí cuántas quedan y por qué.',
        );

        expect(Pending::SIN_CONVERTIR[$fichero][0])->toBe(
            $cuantas,
            "{$fichero}: la lista dice ".Pending::SIN_CONVERTIR[$fichero][0]." y hay {$cuantas}.",
        );
    }
});

it('la lista no reclama deuda ya pagada', function (): void {
    $real = horasCrudasPorFichero();

    foreach (array_keys(Pending::SIN_CONVERTIR) as $fichero) {
        test()->assertArrayHasKey(
            $fichero,
            $real,
            "{$fichero} ya no saca ninguna hora en crudo: bórralo de Pending::SIN_CONVERTIR. ".
            'Una lista que exagera la deuda deja de leerse.',
        );
    }
});

it('cada pendiente dice por qué sigue así', function (): void {
    foreach (Pending::SIN_CONVERTIR as $fichero => [$cuantas, $motivo]) {
        expect($cuantas)->toBeGreaterThan(0);

        // Un motivo corto es un «TODO» con más letras. El de más abajo tiene
        // ochenta y siete caracteres; el umbral deja fuera lo que no explica
        // nada.
        expect(strlen($motivo))->toBeGreaterThan(
            40,
            "{$fichero}: el motivo tiene que decir qué columna es y qué hay que decidir antes de tocarla.",
        );
    }
});
