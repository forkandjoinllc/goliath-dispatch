<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Enums\UserStatus;
use App\Http\Controllers\Platform\HealthController;
use App\Models\User;
use App\Models\UserTenantMembership;
use App\Support\Platform\Expirations;
use App\Support\Platform\Providers;
use App\Support\Platform\ScheduledRuns;
use App\Support\Platform\ScheduledTasks;
use App\Support\Routing\RouteProvider;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Un super administrador de plataforma, y cómo entrar con él.
 *
 * Son copias LOCALES de las de `PlatformTest.php` y con otro nombre a propósito.
 * Pest carga todos los ficheros de prueba en un único espacio global: tomarlas
 * prestadas de otro fichero funciona al correr la suite entera y revienta al
 * correr solo este, y dos funciones con el mismo nombre de primer nivel son un
 * fatal que se lleva por delante toda la suite.
 */
function superAdminDeSalud(Scenario $scenario): User
{
    return app(TenantContext::class)->runAs($scenario->tenant->id, function () use ($scenario): User {
        $user = User::create([
            'email' => 'salud+'.Str::random(8).'@escenario.test',
            'password' => 'contraseña-de-prueba-1',
            'first_name' => 'Salud',
            'last_name' => 'Prueba',
            'status' => UserStatus::Active,
            'email_verified_at' => now(),
        ]);

        DB::table('users')->where('id', $user->id)->update(['is_platform_super_admin' => 1]);

        UserTenantMembership::create([
            'tenant_id' => $scenario->tenant->id,
            'user_id' => $user->id,
            'role' => Role::PlatformSuperAdmin,
            'status' => 'active',
            'accepted_at' => now(),
        ]);

        return $user;
    });
}

function entrarEnSalud(User $user): void
{
    static $n = 0;
    $n++;

    if (auth()->check()) {
        auth()->logout();
        test()->flushSession();
    }

    test()
        ->withServerVariables(['REMOTE_ADDR' => '203.0.113.'.(($n % 250) + 1)])
        ->post('/login', ['email' => $user->email, 'password' => 'contraseña-de-prueba-1'])
        ->assertRedirect();

    test()->withCookie(config('session.cookie'), session()->getId());
}

/** Un documento del transportista con fecha de caducidad. */
function documentoConCaducidadDeSalud(Scenario $scenario, mixed $cuando): string
{
    $id = (string) Str::uuid();

    DB::table('documents')->insert([
        'id' => $id,
        'tenant_id' => $scenario->tenant->id,
        'document_type' => 'certificate_of_insurance',
        'owner_type' => 'carrier',
        'owner_id' => $scenario->assignedCarrier->id,
        'title' => 'COI '.substr($id, 0, 6),
        'review_status' => 'approved',
        'expiration_date' => $cuando,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

/* ── El rastro de las ejecuciones ───────────────────────────────────────── */

it('una tarea que corrió deja fila con su resumen', function () {
    $resultado = ScheduledRuns::wrap('prueba:tarea', fn (): array => [42, ['documentos' => 3]]);

    expect($resultado)->toBe(42);

    $fila = DB::table('job_queue')->where('job_type', 'schedule:prueba:tarea')->first();

    expect((string) $fila->status)->toBe('succeeded');
    expect($fila->tenant_id)->toBeNull();
    expect($fila->started_at)->not->toBeNull();
    expect($fila->completed_at)->not->toBeNull();
    expect(json_decode((string) $fila->payload, true))->toBe(['documentos' => 3]);
});

it('una tarea que revienta deja el error escrito y vuelve a lanzar', function () {
    // Tragarse la excepción dejaría una fila que dice «falló» y un comando que
    // devuelve éxito, que es la peor de las dos mentiras posibles.
    expect(fn () => ScheduledRuns::wrap('prueba:rota', function (): array {
        throw new RuntimeException('se cayó la base');
    }))->toThrow(RuntimeException::class);

    $fila = DB::table('job_queue')->where('job_type', 'schedule:prueba:rota')->first();

    expect((string) $fila->status)->toBe('failed');
    expect((string) $fila->last_error)->toContain('se cayó la base');
});

it('el resumen incluye las tareas que NO han corrido nunca', function () {
    // Es la razón de ser de toda la pantalla: una tarea que nunca corrió es
    // justo la que hay que enseñar, y una consulta que agrupa lo que existe la
    // dejaría fuera.
    // Cada tarea llega con su expresión de cron desde este lote: de ella sale
    // si va con retraso, y una tarea que nunca corrió no puede ir con retraso
    // porque no hay desde dónde contar.
    $resumen = ScheduledRuns::summary([
        ['command' => 'notifications:sweep', 'expression' => '0 6 * * *'],
        ['command' => 'inventada:jamas', 'expression' => '0 6 * * *'],
    ]);

    $inventada = collect($resumen)->firstWhere('task', 'inventada:jamas');

    expect($inventada['hasEverRun'])->toBeFalse();
    expect($inventada['status'])->toBeNull();
    expect($inventada['runCount'])->toBe(0);
    expect($inventada['state'])->toBe('neverRan');
    expect($inventada['dueSince'])->toBeNull();
});

it('el barrido deja rastro, y un simulacro NO', function () {
    // Si el simulacro dejara rastro, la pantalla diría que el barrido corrió
    // anoche cuando lo que corrió fue alguien probando desde una terminal.
    Artisan::call('notifications:sweep', ['--dry-run' => true]);

    expect(DB::table('job_queue')->where('job_type', 'schedule:notifications:sweep')->count())->toBe(0);

    Artisan::call('notifications:sweep');

    $fila = DB::table('job_queue')->where('job_type', 'schedule:notifications:sweep')->first();

    expect((string) $fila->status)->toBe('succeeded');
    expect(json_decode((string) $fila->payload, true))->toHaveKeys(['tenants', 'documents', 'carriers', 'invoices']);
});

/* ── Los vencimientos materializados ────────────────────────────────────── */

it('el barrido materializa los vencimientos y no los duplica', function () {
    $documentId = documentoConCaducidadDeSalud($this->scenario, now()->addDays(10));

    Artisan::call('notifications:sweep');
    Artisan::call('notifications:sweep');

    $filas = DB::table('document_expirations')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('document_id', $documentId)
        ->get();

    // El índice único es quien deduplica, no una comprobación previa.
    expect($filas)->toHaveCount(1);
    expect((string) $filas->first()->kind)->toBe('warning');
});

it('distingue lo que está por vencer de lo que ya venció', function () {
    documentoConCaducidadDeSalud($this->scenario, now()->addDays(10));
    documentoConCaducidadDeSalud($this->scenario, now()->subDays(3));

    Artisan::call('notifications:sweep');

    $kinds = DB::table('document_expirations')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->pluck('kind')
        ->sort()
        ->values()
        ->all();

    expect($kinds)->toBe(['expired', 'warning']);
});

it('renovar un documento resuelve el aviso de la caducidad vieja', function () {
    $documentId = documentoConCaducidadDeSalud($this->scenario, now()->addDays(10));

    Artisan::call('notifications:sweep');

    // Se renueva: caducidad nueva.
    DB::table('documents')->where('id', $documentId)->update([
        'expiration_date' => now()->addDays(20),
    ]);

    Artisan::call('notifications:sweep');

    $filas = DB::table('document_expirations')
        ->where('document_id', $documentId)
        ->orderBy('expiration_date')
        ->get(['expiration_date', 'resolved_at']);

    expect($filas)->toHaveCount(2);
    // La vieja queda resuelta; la nueva sigue viva.
    expect($filas[0]->resolved_at)->not->toBeNull();
    expect($filas[1]->resolved_at)->toBeNull();
});

it('un documento borrado deja de tener aviso pendiente', function () {
    $documentId = documentoConCaducidadDeSalud($this->scenario, now()->addDays(10));

    Artisan::call('notifications:sweep');

    expect(DB::table('document_expirations')->where('document_id', $documentId)->whereNull('resolved_at')->count())->toBe(1);

    DB::table('documents')->where('id', $documentId)->update(['deleted_at' => now()]);

    Artisan::call('notifications:sweep');

    // Si no se resolvieran, la lista se llenaría de avisos que nadie cierra.
    expect(DB::table('document_expirations')->where('document_id', $documentId)->whereNull('resolved_at')->count())->toBe(0);
});

it('el resumen de vencimientos cuenta por tipo', function () {
    documentoConCaducidadDeSalud($this->scenario, now()->addDays(10));
    documentoConCaducidadDeSalud($this->scenario, now()->subDays(3));

    Artisan::call('notifications:sweep');

    $resumen = Expirations::summary((string) $this->scenario->tenant->id);

    expect($resumen['warning'])->toBe(1);
    expect($resumen['expired'])->toBe(1);
    expect($resumen['oldestFirstDetectedAt'])->not->toBeNull();
});

/* ── El inventario de proveedores ───────────────────────────────────────── */

it('dice que el correo de pruebas no manda nada a nadie', function () {
    // `log` escribe en un fichero. Decir que el correo está «conectado» porque
    // hay un mailer configurado sería la clase de tranquilidad falsa que esta
    // pantalla existe para no dar.
    config(['mail.default' => 'log']);

    $correo = collect(Providers::inventory())->firstWhere('key', 'email');

    expect($correo['status'])->toBe('mock');
    // Y el detalle NO se presenta como variable de entorno que falta.
    expect($correo['envVar'])->toBeFalse();
});

it('el inventario se lee del contenedor, no de una tabla', function () {
    $rutas = collect(Providers::inventory())->firstWhere('key', 'routing');

    expect($rutas['bound'])->toBe('StopDerivedRouteProvider');
    expect($rutas['status'])->toBe('mock');

    // Se ata otro proveedor y el inventario cambia sin tocar ninguna fila.
    app()->instance(RouteProvider::class, new class implements RouteProvider
    {
        public function calculate(array $stops): array
        {
            return ['provider' => 'inventado', 'totalMiles' => null, 'estimatedDurationMinutes' => null,
                'estimatedTollCents' => null, 'polyline' => null, 'legs' => [], 'states' => [], 'warnings' => []];
        }

        public function name(): string
        {
            return 'inventado';
        }
    });

    expect(collect(Providers::inventory())->firstWhere('key', 'routing')['status'])->toBe('live');
});

it('avisa de que el sello de firma usa la clave derivada', function () {
    config(['signatures.pepper' => null]);

    $sello = collect(Providers::inventory())->firstWhere('key', 'signatureSeal');

    // `fallback` y no `mock`: el sello se hace de verdad, lo que pasa es que
    // rotar APP_KEY invalidaría las firmas anteriores.
    expect($sello['status'])->toBe('fallback');
    expect($sello['detail'])->toBe('SIGNATURE_HASH_PEPPER');
    expect($sello['envVar'])->toBeTrue();

    config(['signatures.pepper' => str_repeat('a', 64)]);

    expect(collect(Providers::inventory())->firstWhere('key', 'signatureSeal')['status'])->toBe('live');
});

/* ── La pantalla ────────────────────────────────────────────────────────── */

it('la pantalla enseña el aviso grande cuando el barrido no ha corrido nunca', function () {
    entrarEnSalud(superAdminDeSalud($this->scenario));

    $respuesta = $this->get('/platform/health')->assertOk();

    $respuesta->assertInertia(function (Assert $p) {
        $tareas = $p->toArray()['props']['scheduler']['tasks'];

        expect($tareas[0]['task'])->toBe('notifications:sweep');
        expect($tareas[0]['hasEverRun'])->toBeFalse();
    });

    // Y se comprueba el HTML, no solo los props: es la pantalla entera la que
    // tiene que decirlo, con la línea de cron lista para copiar.
    $cuerpo = $respuesta->getContent();

    expect($cuerpo)->toContain('schedule:run');
    expect($cuerpo)->not->toContain('platform.health.');
});

it('tras correr el barrido, la pantalla lo dice', function () {
    Artisan::call('notifications:sweep');

    entrarEnSalud(superAdminDeSalud($this->scenario));

    $this->get('/platform/health')->assertOk()->assertInertia(function (Assert $p) {
        $tarea = $p->toArray()['props']['scheduler']['tasks'][0];

        expect($tarea['hasEverRun'])->toBeTrue();
        expect($tarea['status'])->toBe('succeeded');
        expect($tarea['summary'])->toHaveKey('tenants');
    });
});

it('las ejecuciones programadas no cuentan como trabajos de la cola', function () {
    // Si contaran, «tareas correctas» crecería cada mañana y el número dejaría
    // de significar nada.
    Artisan::call('notifications:sweep');

    entrarEnSalud(superAdminDeSalud($this->scenario));

    $this->get('/platform/health')->assertInertia(fn (Assert $p) => $p
        ->where('jobs.queued', 0)
        ->where('jobs.running', 0)
        ->where('jobs.failed', 0));
});

it('un administrador de empresa no entra en la salud de la plataforma', function () {
    signIn($this->scenario, Role::Admin);

    // Un GET a una pantalla que no le toca contesta 403, no una redirección:
    // no hay a dónde mandarle que sea mejor que decírselo.
    $this->get('/platform/health')->assertForbidden();
});

it('cada tarea del planificador explica QUÉ se deja de hacer si no corre', function () {
    // Lo encontró el navegador. La pantalla tenía un solo texto de consecuencia
    // —escrito para `notifications:sweep`— y se lo pintaba a todas: al añadir
    // `retention:sweep`, la pantalla le decía a quien mira que sin él no se
    // mandan los avisos de documentos que caducan. Un aviso que describe mal lo
    // que pasa se corrige tarde, porque quien lo lee busca donde no es.
    //
    // Ahora la consecuencia es por tarea, y esto obliga a que la siguiente que
    // se añada traiga la suya en los dos idiomas.
    //
    // LA LISTA SALE DEL PLANIFICADOR, no de una constante del controlador. Se
    // leía `HealthController::TAREAS` por reflexión, y esa constante era una
    // copia a mano de `routes/console.php`: un `Schedule::command()` nuevo no
    // aparecía en la pantalla ni le faltaba nada según esta prueba. Ahora un
    // comando programado sin su texto de consecuencia falla aquí.
    $tareas = array_column(ScheduledTasks::all(), 'command');

    expect($tareas)->not->toBeEmpty();

    foreach (['es', 'en'] as $locale) {
        $faltan = [];

        foreach ($tareas as $tarea) {
            // La clave se compone igual que en la pantalla: `notifications:sweep`
            // se vuelve `notificationsSweep`.
            $clave = preg_replace_callback(
                '/[:.](.)/',
                static fn (array $m): string => strtoupper($m[1]),
                $tarea,
            );

            $texto = __("platform.health.consequence.{$clave}", [], $locale);

            if ($texto === "platform.health.consequence.{$clave}" || trim($texto) === '') {
                $faltan[] = $tarea;
            }
        }

        expect($faltan)->toBe([], "Tareas sin consecuencia escrita en {$locale}: ".implode(', ', $faltan));
    }
});
