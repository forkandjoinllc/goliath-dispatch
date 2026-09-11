<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Oversize\Evaluator;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

/**
 * Una escolta sin confirmar no deja salir la carga.
 *
 * La página pública decía «una carga no puede despacharse con un permiso o
 * escolta pendiente». Lo del permiso era verdad. Lo de la escolta no:
 * `Papers::faltan()` solo consultaba `permits`, y `escorts.status` no lo leía
 * ningún guardián. Hubo que quitar la frase de la página de ventas.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** La carga marcada como sobredimensionada, con su evaluación validada. */
function cargaConEscolta(Scenario $s): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s): string {
        DB::table('loads')->where('id', $s->load->id)->update([
            'is_oversize' => true,
            'planned_delivery_at' => now()->addDays(4),
            'updated_at' => now(),
        ]);

        DB::table('oversize_evaluations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $s->tenant->id,
            'load_id' => $s->load->id,
            'outcome' => 'escort_likely_required',
            'human_validation_status' => Evaluator::VALIDADA,
            'validated_by_user_id' => $s->user(Role::Admin)->id,
            'validated_at' => now(),
            'evaluated_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (string) $s->load->id;
    });
}

function escoltaDe(Scenario $s, string $loadId, string $estado): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $loadId, $estado): string {
        $id = (string) Str::uuid();

        DB::table('escorts')->insert([
            'id' => $id,
            'tenant_id' => $s->tenant->id,
            'load_id' => $loadId,
            'escort_type' => 'pilot_car',
            'state_code' => 'TX',
            'provider_name' => 'Escoltas del Golfo',
            'status' => $estado,
            'cost_cents' => 45000,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    });
}

function compuertaDe(Scenario $s, string $loadId): mixed
{
    return app(TenantContext::class)->runAs($s->tenant->id, fn () => DB::table('loads')
        ->where('id', $loadId)->value('permit_ready_approved_at'));
}

/* ── La escolta pendiente ────────────────────────────────────────────────── */

it('una escolta pendiente impide dar los papeles por completos', function (): void {
    // La medida de antes: esto pasaba, y la carga salía con una escolta que
    // nadie había confirmado.
    $carga = cargaConEscolta($this->scenario);
    escoltaDe($this->scenario, $carga, 'pending');

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$carga}/permits/ready")
        ->assertSessionHas('error', __('oversize.readiness.escortPending', ['state' => 'TX', 'n' => 1]));

    expect(compuertaDe($this->scenario, $carga))->toBeNull();
});

it('una escolta confirmada con su papel sí deja pasar', function (): void {
    $carga = cargaConEscolta($this->scenario);
    $escolta = escoltaDe($this->scenario, $carga, 'confirmed');

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$carga}/papers/escort/{$escolta}", [
        'file' => UploadedFile::fake()->create('escolta.pdf', 90, 'application/pdf'),
    ])->assertSessionHasNoErrors();

    $this->post("/loads/{$carga}/permits/ready")->assertSessionHas('success');

    expect(compuertaDe($this->scenario, $carga))->not->toBeNull();
});

it('una escolta confirmada SIN su papel no deja pasar', function (): void {
    // La casilla dice que está; el conductor no lo lleva. Es el mismo defecto
    // que ya se arregló para los permisos.
    $carga = cargaConEscolta($this->scenario);
    escoltaDe($this->scenario, $carga, 'confirmed');

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$carga}/permits/ready")
        ->assertSessionHas('error', __('oversize.readiness.escortWithoutDocument', ['state' => 'TX', 'n' => 1]));

    expect(compuertaDe($this->scenario, $carga))->toBeNull();
});

it('una escolta cancelada o no requerida no estorba', function (): void {
    // Bloquear por ausencia pararía toda carga que solo necesita permiso.
    foreach (['cancelled', 'not_required'] as $estado) {
        $s = Scenario::create();
        $carga = cargaConEscolta($s);
        escoltaDe($s, $carga, $estado);

        signIn($s, Role::Admin);

        $this->post("/loads/{$carga}/permits/ready")->assertSessionHas('success');

        expect(compuertaDe($s, $carga))->not->toBeNull("El estado {$estado} no debería estorbar.");
    }
});

it('una carga sin ninguna escolta pasa igual', function (): void {
    $carga = cargaConEscolta($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$carga}/permits/ready")->assertSessionHas('success');

    expect(compuertaDe($this->scenario, $carga))->not->toBeNull();
});

/* ── La compuerta se vuelve a cerrar ─────────────────────────────────────── */

it('devolver un permiso a pendiente reabre la compuerta', function (): void {
    // `storePermit` ya lo hacía al CREAR uno pendiente, y su comentario explica
    // por qué. Cambiar uno existente de vuelta a pendiente no lo hacía: la
    // carga aprobada el lunes seguía despachable el martes.
    $carga = cargaConEscolta($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$carga}/permits/ready")->assertSessionHas('success');
    expect(compuertaDe($this->scenario, $carga))->not->toBeNull();

    $permiso = (string) Str::uuid();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($permiso, $carga): void {
        DB::table('permits')->insert([
            'id' => $permiso,
            'tenant_id' => $this->scenario->tenant->id,
            'load_id' => $carga,
            'state_code' => 'TX',
            'status' => 'issued',
            'cost_cents' => 1000,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    $this->post("/loads/{$carga}/permits/items/{$permiso}", ['status' => 'pending'])
        ->assertSessionHasNoErrors();

    expect(compuertaDe($this->scenario, $carga))->toBeNull();
});

it('devolver una escolta a pendiente también la reabre', function (): void {
    $carga = cargaConEscolta($this->scenario);
    $escolta = escoltaDe($this->scenario, $carga, 'not_required');

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$carga}/permits/ready")->assertSessionHas('success');
    expect(compuertaDe($this->scenario, $carga))->not->toBeNull();

    $this->post("/loads/{$carga}/escorts/{$escolta}", ['status' => 'pending'])
        ->assertSessionHasNoErrors();

    expect(compuertaDe($this->scenario, $carga))->toBeNull();
});
