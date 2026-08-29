<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
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

/** Deja al despachador sin nada, para partir de cero. */
function sinAsignaciones(Scenario $scenario): void
{
    DB::table('dispatcher_resource_assignments')
        ->where('tenant_id', $scenario->tenant->id)
        ->delete();
}

function despachador(Scenario $scenario): string
{
    return (string) $scenario->user(Role::Dispatcher)->id;
}

function crearGrupo(Scenario $scenario, string $nombre = 'Flota norte'): string
{
    $id = (string) Str::uuid();

    DB::table('dispatcher_groups')->insert([
        'id' => $id,
        'tenant_id' => $scenario->tenant->id,
        'name' => $nombre,
        'active' => true,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

/* ── Lo que este lote arregla ──────────────────────────────────────────── */

it('un GRUPO asignado concede lo que hay dentro', function () {
    sinAsignaciones($this->scenario);
    $grupo = crearGrupo($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post("/assignment-groups/{$grupo}/members", [
        'member_type' => 'carrier',
        'member_id' => $this->scenario->otherCarrier->id,
    ])->assertRedirect();

    $this->post('/assignments', [
        'dispatcher_user_id' => despachador($this->scenario),
        'resource_type' => 'group',
        'resource_id' => $grupo,
    ])->assertRedirect();

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Dispatcher);

    // ANTES de este lote esto salía en cero: ActorFactory recogía los ids de
    // grupo y no los abría nunca, así que asignar un grupo no concedía nada
    // —aunque el comentario de AssignmentScope ya prometía «vía grupo».
    $this->get('/loads')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('loads.data', 1));
});

it('un grupo apagado deja de conceder', function () {
    sinAsignaciones($this->scenario);
    $grupo = crearGrupo($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/assignment-groups/{$grupo}/members", [
        'member_type' => 'carrier',
        'member_id' => $this->scenario->otherCarrier->id,
    ])->assertRedirect();
    $this->post('/assignments', [
        'dispatcher_user_id' => despachador($this->scenario),
        'resource_type' => 'group',
        'resource_id' => $grupo,
    ])->assertRedirect();

    $this->post("/assignment-groups/{$grupo}/toggle")->assertRedirect();

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Dispatcher);

    // Apagar el grupo se lo quita a la vez a todos los que lo tengan.
    $this->get('/loads')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('loads.data', 0));
});

/* ── Asignar y retirar ─────────────────────────────────────────────────── */

it('sin asignaciones el despachador ve las listas vacías', function () {
    sinAsignaciones($this->scenario);
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/loads')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('loads.data', 0));
});

it('asignar un transportista le abre sus cargas', function () {
    sinAsignaciones($this->scenario);
    signIn($this->scenario, Role::Admin);

    $this->post('/assignments', [
        'dispatcher_user_id' => despachador($this->scenario),
        'resource_type' => 'carrier',
        'resource_id' => $this->scenario->assignedCarrier->id,
    ])->assertRedirect();

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/loads')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('loads.data', 1));
});

it('retirar corta el acceso, sin borrar la fila', function () {
    signIn($this->scenario, Role::Admin);

    $fila = DB::table('dispatcher_resource_assignments')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->first(['id']);

    $this->post("/assignments/{$fila->id}/end")->assertRedirect();

    $despues = DB::table('dispatcher_resource_assignments')->where('id', $fila->id)->first();

    // Fecha de fin, no borrado: «¿quién llevaba esto en marzo?» sigue teniendo
    // respuesta.
    expect($despues)->not->toBeNull()
        ->and($despues->deleted_at)->toBeNull()
        ->and($despues->end_date)->not->toBeNull();

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/loads')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('loads.data', 0));
});

it('no asigna dos veces el mismo recurso', function () {
    sinAsignaciones($this->scenario);
    signIn($this->scenario, Role::Admin);

    $datos = [
        'dispatcher_user_id' => despachador($this->scenario),
        'resource_type' => 'carrier',
        'resource_id' => $this->scenario->assignedCarrier->id,
    ];

    $this->post('/assignments', $datos)->assertRedirect();
    // La clave única incluye start_date, así que la base de datos NO lo
    // impediría: dejaría dos filas vivas y retirar una no quitaría el acceso.
    $this->post('/assignments', $datos)->assertSessionHasErrors('resource_id');

    expect(DB::table('dispatcher_resource_assignments')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->count())->toBe(1);
});

it('no se le asigna nada a quien no es despachador', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/assignments', [
        'dispatcher_user_id' => $this->scenario->user(Role::Accounting)->id,
        'resource_type' => 'carrier',
        'resource_id' => $this->scenario->assignedCarrier->id,
    ])->assertSessionHasErrors('dispatcher_user_id');
});

it('no se asigna un recurso que no existe', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/assignments', [
        'dispatcher_user_id' => despachador($this->scenario),
        'resource_type' => 'carrier',
        'resource_id' => (string) Str::uuid(),
    ])->assertSessionHasErrors('resource_id');
});

/* ── Grupos ────────────────────────────────────────────────────────────── */

it('no admite dos grupos con el mismo nombre', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/assignment-groups', ['name' => 'Flota sur'])->assertRedirect();
    $this->post('/assignment-groups', ['name' => 'Flota sur'])->assertSessionHasErrors('name');
});

it('quitar a un miembro del grupo le quita el acceso', function () {
    sinAsignaciones($this->scenario);
    $grupo = crearGrupo($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/assignment-groups/{$grupo}/members", [
        'member_type' => 'carrier',
        'member_id' => $this->scenario->assignedCarrier->id,
    ])->assertRedirect();
    $this->post('/assignments', [
        'dispatcher_user_id' => despachador($this->scenario),
        'resource_type' => 'group',
        'resource_id' => $grupo,
    ])->assertRedirect();

    $miembro = DB::table('group_members')->where('group_id', $grupo)->value('id');
    $this->delete("/assignment-groups/{$grupo}/members/{$miembro}")->assertRedirect();

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/loads')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('loads.data', 0));
});

/* ── La comisión ───────────────────────────────────────────────────────── */

it('guarda la comisión creando el perfil si no lo había', function () {
    signIn($this->scenario, Role::Admin);

    expect(DB::table('dispatcher_profiles')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('user_id', despachador($this->scenario))
        ->count())->toBe(0);

    $this->post('/assignments/commission', [
        'dispatcher_user_id' => despachador($this->scenario),
        'commission_bps' => 3000,
    ])->assertRedirect();

    expect((int) DB::table('dispatcher_profiles')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('user_id', despachador($this->scenario))
        ->value('commission_bps'))->toBe(3000);

    // Y una segunda vez actualiza en lugar de duplicar.
    $this->post('/assignments/commission', [
        'dispatcher_user_id' => despachador($this->scenario),
        'commission_bps' => 2000,
    ])->assertRedirect();

    expect(DB::table('dispatcher_profiles')
        ->where('user_id', despachador($this->scenario))
        ->count())->toBe(1);
});

it('no acepta una comisión por encima del cien por cien', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/assignments/commission', [
        'dispatcher_user_id' => despachador($this->scenario),
        'commission_bps' => 10001,
    ])->assertSessionHasErrors('commission_bps');
});

/* ── Quién ve qué ──────────────────────────────────────────────────────── */

it('el despachador se ve solo a sí mismo y no puede asignar', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/assignments')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('dispatchers', 1)
            ->where('can.manage', false)
            ->where('onlyMine', true)
            // El catálogo entero no se le manda: son nombres que su ámbito le
            // niega en todas las demás pantallas.
            ->where('resources', null));

    $this->post('/assignments', [
        'dispatcher_user_id' => despachador($this->scenario),
        'resource_type' => 'carrier',
        'resource_id' => $this->scenario->otherCarrier->id,
    ])->assertForbidden();
});

it('el transportista no entra en asignaciones', function () {
    signIn($this->scenario, Role::Carrier);

    $this->get('/assignments')->assertForbidden();
});
