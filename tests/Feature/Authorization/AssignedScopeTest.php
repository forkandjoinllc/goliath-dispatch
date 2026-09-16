<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

/**
 * El despachador ve lo que tiene asignado, y solo eso.
 *
 * Dos pantallas escribían `Scope::Platform, Scope::Tenant, Scope::Assigned =>
 * $consulta`, es decir: al despachador —cuyo ámbito ES `Assigned`— le devolvían
 * la empresa entera.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** El transportista que NO está asignado al despachador. */
function transportistaAjeno(Scenario $s): object
{
    return app(TenantContext::class)->runAs((string) $s->tenant->id, fn () => DB::table('carriers')
        ->where('tenant_id', $s->tenant->id)
        ->where('id', '!=', $s->assignedCarrier->id)
        ->whereNull('deleted_at')
        ->first(['id', 'legal_name']));
}

/** Una solicitud de firma colgada de un transportista concreto. */
function solicitudDe(Scenario $s, string $carrierId, string $correo): string
{
    return app(TenantContext::class)->runAs((string) $s->tenant->id, function () use ($s, $carrierId, $correo): string {
        // Una sola plantilla por empresa: el índice único es
        // (tenant, template_key, version), y estas pruebas piden dos firmas.
        $plantilla = (string) DB::table('signature_templates')
            ->where('tenant_id', (string) $s->tenant->id)
            ->where('template_key', 'carrier_agreement')
            ->value('id');

        if ($plantilla === '') {
            $plantilla = (string) Str::uuid();

            DB::table('signature_templates')->insert([
                'id' => $plantilla, 'tenant_id' => (string) $s->tenant->id,
                'template_key' => 'carrier_agreement', 'version' => 1,
                'title_en' => 'Carrier agreement', 'title_es' => 'Acuerdo de transportista',
                'body_en' => 'Body', 'body_es' => 'Cuerpo',
                'consent_copy_en' => 'Consent', 'consent_copy_es' => 'Consentimiento',
                'content_hash' => hash('sha256', $plantilla),
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        $id = (string) Str::uuid();

        DB::table('signature_requests')->insert([
            'id' => $id, 'tenant_id' => (string) $s->tenant->id,
            'template_id' => $plantilla, 'template_version' => 1,
            'template_content_hash' => hash('sha256', $plantilla),
            'subject_type' => 'carrier', 'subject_id' => $carrierId, 'carrier_id' => $carrierId,
            'status' => 'pending', 'signer_email' => $correo,
            'requested_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    });
}

/* ── El tablero de altas ─────────────────────────────────────────────────── */

it('el tablero de altas solo enseña los transportistas asignados', function (): void {
    // ESTE ES EL FALLO. Antes: los dos, con nombre legal, DOT, estado del alta
    // y qué papeles le faltan al que no es suyo.
    $ajeno = transportistaAjeno($this->scenario);

    signIn($this->scenario, Role::Dispatcher);

    $this->get('/onboarding')->assertInertia(fn ($page) => $page
        ->where('carriers', fn ($filas) => collect($filas)
            ->pluck('id')
            ->doesntContain((string) $ajeno->id)));
});

it('el administrador sigue viendo la empresa entera', function (): void {
    // Estrechar de más sería un fallo peor que el que se arregla: dejaría a
    // cumplimiento sin su cola del día.
    $ajeno = transportistaAjeno($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->get('/onboarding')->assertInertia(fn ($page) => $page
        ->where('carriers', fn ($filas) => collect($filas)
            ->pluck('id')
            ->contains((string) $ajeno->id)));
});

it('el tablero ya no ofrece un botón que devuelve 404', function (): void {
    // El síntoma que delataba la fuga: el tablero ofrecía un movimiento sobre
    // el transportista ajeno, y la ruta de transición —que sí estrecha por
    // asignación— contestaba 404. Dos piezas que contestaban distinto a la
    // misma pregunta.
    $ajeno = transportistaAjeno($this->scenario);

    signIn($this->scenario, Role::Dispatcher);

    // Lo que importa no es el código: es que el estado del transportista ajeno
    // no se mueva. Antes el tablero OFRECÍA este movimiento y la ruta lo
    // rechazaba — dos piezas contestando distinto a la misma pregunta.
    $antes = app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, fn () => DB::table('carriers')
        ->where('id', $ajeno->id)->value('onboarding_status'));

    $this->post("/carriers/{$ajeno->id}/onboarding/submitted");

    $despues = app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, fn () => DB::table('carriers')
        ->where('id', $ajeno->id)->value('onboarding_status'));

    expect($despues)->toBe($antes);

    $this->get('/onboarding')->assertInertia(fn ($page) => $page
        ->where('carriers', fn ($filas) => collect($filas)->every(
            fn (array $c): bool => $c['id'] !== (string) $ajeno->id,
        )));
});

/* ── Firmas ──────────────────────────────────────────────────────────────── */

it('el listado de firmas solo enseña las de los transportistas asignados', function (): void {
    $ajeno = transportistaAjeno($this->scenario);
    $suya = solicitudDe($this->scenario, (string) $this->scenario->assignedCarrier->id, 'mia@prueba.test');
    $ajena = solicitudDe($this->scenario, (string) $ajeno->id, 'ajena@prueba.test');

    signIn($this->scenario, Role::Dispatcher);

    $this->get('/signatures')->assertInertia(fn ($page) => $page
        ->where('requests', function ($filas) use ($suya, $ajena): bool {
            $ids = collect($filas)->pluck('id');

            return $ids->contains($suya) && $ids->doesntContain($ajena);
        }));
});

it('no puede abrir la solicitud de un transportista que no es suyo', function (): void {
    // No es solo el listado: `scoped()` es el mismo estrechamiento que decide
    // `show()`, el certificado y la anulación. Dentro está el correo del
    // firmante.
    $ajeno = transportistaAjeno($this->scenario);
    $ajena = solicitudDe($this->scenario, (string) $ajeno->id, 'ajena@prueba.test');

    signIn($this->scenario, Role::Dispatcher);

    $this->get("/signatures/{$ajena}")->assertNotFound();
});

it('sí puede abrir la de los suyos', function (): void {
    $suya = solicitudDe($this->scenario, (string) $this->scenario->assignedCarrier->id, 'mia@prueba.test');

    signIn($this->scenario, Role::Dispatcher);

    $this->get("/signatures/{$suya}")->assertOk();
});

it('el desplegable de mandar a firmar no ofrece transportistas ajenos', function (): void {
    // Esto ya no es ver de más: es poder mandarle un acuerdo a otro.
    $ajeno = transportistaAjeno($this->scenario);

    signIn($this->scenario, Role::Dispatcher);

    $this->get('/signatures')->assertInertia(fn ($page) => $page
        ->where('carriers', fn ($filas) => collect($filas)
            ->pluck('id')
            ->doesntContain((string) $ajeno->id)));
});

it('el administrador sigue viendo todas las firmas', function (): void {
    $ajeno = transportistaAjeno($this->scenario);
    $ajena = solicitudDe($this->scenario, (string) $ajeno->id, 'ajena@prueba.test');

    signIn($this->scenario, Role::Admin);

    $this->get('/signatures')->assertInertia(fn ($page) => $page
        ->where('requests', fn ($filas) => collect($filas)->pluck('id')->contains($ajena)));

    $this->get("/signatures/{$ajena}")->assertOk();
});

it('el transportista sigue viendo lo suyo y nada más', function (): void {
    // El ámbito `Carrier` funcionaba antes y tiene que seguir funcionando: la
    // pieza contesta por los cinco ámbitos, no solo por el que se arregló.
    $ajeno = transportistaAjeno($this->scenario);
    $suya = solicitudDe($this->scenario, (string) $this->scenario->assignedCarrier->id, 'mia@prueba.test');
    $ajena = solicitudDe($this->scenario, (string) $ajeno->id, 'ajena@prueba.test');

    signIn($this->scenario, Role::Carrier);

    $this->get('/signatures')->assertInertia(fn ($page) => $page
        ->where('requests', function ($filas) use ($suya, $ajena): bool {
            $ids = collect($filas)->pluck('id');

            return $ids->contains($suya) && $ids->doesntContain($ajena);
        }));
});

/* ── El despachador recién llegado ───────────────────────────────────────── */

/** Le quita al despachador todas sus asignaciones. */
function despachadorSinCartera(Scenario $s): void
{
    app(TenantContext::class)->runAs((string) $s->tenant->id, fn () => DB::table('dispatcher_resource_assignments')
        ->where('tenant_id', $s->tenant->id)
        ->where('dispatcher_user_id', $s->user(Role::Dispatcher)->id)
        ->delete());
}

it('un despachador sin asignaciones no ve NADA, no lo ve todo', function (): void {
    // El caso del recién llegado, y el que un fixture con una asignación no
    // prueba: cuando `assignments->carrierIds` viene vacío no hay columna que
    // casar, y la pieza tiene que cerrar (`1 = 0`) en vez de abrir. Lo destapó
    // un sabotaje que cambiaba ese cierre por `1 = 1` y se quedó en verde.
    despachadorSinCartera($this->scenario);
    solicitudDe($this->scenario, (string) $this->scenario->assignedCarrier->id, 'mia@prueba.test');

    signIn($this->scenario, Role::Dispatcher);

    $this->get('/onboarding')->assertInertia(fn ($page) => $page->where('carriers', []));

    $this->get('/signatures')->assertInertia(fn ($page) => $page
        ->where('requests', [])
        ->where('carriers', []));
});
