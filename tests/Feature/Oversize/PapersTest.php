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

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** La carga marcada como sobredimensionada, con su evaluación ya validada. */
function cargaSobredimensionada(Scenario $s, ?string $entrega = null): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $entrega): string {
        DB::table('loads')->where('id', $s->load->id)->update([
            'is_oversize' => true,
            'planned_delivery_at' => $entrega ?? now()->addDays(4),
            'updated_at' => now(),
        ]);

        DB::table('oversize_evaluations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $s->tenant->id,
            'load_id' => $s->load->id,
            'outcome' => 'permit_likely_required',
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

/** Un permiso de esa carga, con el estado y el vencimiento que se le pidan. */
function permisoDe(Scenario $s, string $loadId, string $estado, ?string $vence = null): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $loadId, $estado, $vence): string {
        $id = (string) Str::uuid();

        DB::table('permits')->insert([
            'id' => $id,
            'tenant_id' => $s->tenant->id,
            'load_id' => $loadId,
            'state_code' => 'TX',
            'permit_number' => 'TX-99001',
            'status' => $estado,
            'expires_at' => $vence,
            'cost_cents' => 12000,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    });
}

function papelFalso(): UploadedFile
{
    return UploadedFile::fake()->create('permiso.pdf', 90, 'application/pdf');
}

it('no se dan los papeles por completos con un permiso emitido sin documento', function () {
    $carga = cargaSobredimensionada($this->scenario);
    permisoDe($this->scenario, $carga, 'issued');

    signIn($this->scenario, Role::Admin);

    // Hasta este lote esto pasaba: «emitido» contaba como hecho y el conductor
    // salía sin el papel.
    $this->post("/loads/{$carga}/permits/ready")
        ->assertSessionHas('error', __('oversize.readiness.permitWithoutDocument', ['state' => 'TX', 'n' => 1]));

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($carga): void {
        expect(DB::table('loads')->where('id', $carga)->value('permit_ready_approved_at'))->toBeNull();
    });
});

it('con el papel adjunto sí se dan por completos', function () {
    $carga = cargaSobredimensionada($this->scenario);
    $permiso = permisoDe($this->scenario, $carga, 'issued');

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$carga}/papers/permit/{$permiso}", ['file' => papelFalso()])
        ->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($permiso): void {
        // La columna que existía desde el primer día y no escribía nadie.
        expect(DB::table('permits')->where('id', $permiso)->value('document_id'))->not->toBeNull();
    });

    $this->post("/loads/{$carga}/permits/ready")->assertSessionHas('success');

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($carga): void {
        expect(DB::table('loads')->where('id', $carga)->value('permit_ready_approved_at'))->not->toBeNull();
    });
});

it('un permiso que vence antes de la entrega bloquea', function () {
    $carga = cargaSobredimensionada($this->scenario, entrega: now()->addDays(10)->toDateTimeString());
    $permiso = permisoDe($this->scenario, $carga, 'issued', vence: now()->addDays(3)->toDateTimeString());

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$carga}/papers/permit/{$permiso}", ['file' => papelFalso()]);

    // `expires_at` se guardaba desde el principio sin que lo mirara nadie.
    $this->post("/loads/{$carga}/permits/ready")
        ->assertSessionHas('error', __('oversize.readiness.permitExpiresBeforeDelivery', ['state' => 'TX', 'n' => 1]));
});

it('un permiso que vence después de la entrega no bloquea', function () {
    $carga = cargaSobredimensionada($this->scenario, entrega: now()->addDays(3)->toDateTimeString());
    $permiso = permisoDe($this->scenario, $carga, 'issued', vence: now()->addDays(10)->toDateTimeString());

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$carga}/papers/permit/{$permiso}", ['file' => papelFalso()]);
    $this->post("/loads/{$carga}/permits/ready")->assertSessionHas('success');
});

it('un permiso no requerido no necesita papel', function () {
    $carga = cargaSobredimensionada($this->scenario);
    permisoDe($this->scenario, $carga, 'not_required');

    signIn($this->scenario, Role::Admin);

    // Exigirle papel a algo que no hace falta sería pedir el justificante de un
    // trámite que nadie tiene que hacer.
    $this->post("/loads/{$carga}/permits/ready")->assertSessionHas('success');
});

it('sustituir el papel deja uno solo vivo', function () {
    $carga = cargaSobredimensionada($this->scenario);
    $permiso = permisoDe($this->scenario, $carga, 'issued');

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$carga}/papers/permit/{$permiso}", ['file' => papelFalso()]);
    $this->post("/loads/{$carga}/papers/permit/{$permiso}", ['file' => papelFalso()]);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($permiso): void {
        // El anterior se borra en suave: alguien pudo mirarlo antes de decidir.
        expect(DB::table('documents')->where('owner_id', $permiso)->whereNull('deleted_at')->count())->toBe(1)
            ->and(DB::table('documents')->where('owner_id', $permiso)->whereNotNull('deleted_at')->count())->toBe(1);
    });
});

it('una ranura que no existe no escribe nada', function () {
    $carga = cargaSobredimensionada($this->scenario);
    $permiso = permisoDe($this->scenario, $carga, 'issued');

    signIn($this->scenario, Role::Admin);

    // La ranura llega del navegador y decide qué columna se escribe.
    $this->post("/loads/{$carga}/papers/status/{$permiso}", ['file' => papelFalso()])
        ->assertNotFound();
});

it('un permiso de otra carga no acepta papel desde esta', function () {
    $carga = cargaSobredimensionada($this->scenario);

    $ajeno = app(TenantContext::class)->runAs($this->scenario->tenant->id, fn (): string => permisoDe(
        $this->scenario,
        (string) $this->scenario->otherLoad->id,
        'issued',
    ));

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$carga}/papers/permit/{$ajeno}", ['file' => papelFalso()])
        ->assertNotFound();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($ajeno): void {
        expect(DB::table('permits')->where('id', $ajeno)->value('document_id'))->toBeNull();
    });
});
