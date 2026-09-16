<?php

declare(strict_types=1);

use App\Enums\LoadStatus;
use App\Enums\Role;
use App\Support\Loads\Guards;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Support\Scenario;

/**
 * La carga con sobrepeso pasa por las mismas puertas que la sobredimensionada.
 *
 * `Guards::blocking` cerraba sus dos puertas mirando solo `is_oversize`.
 * `Evaluator` pone las dos banderas por separado: una carga de maquinaria
 * compacta —medidas legales, exceso de peso— salía con `is_oversize = 0` y se
 * despachaba sin permiso aprobado y sin validación, mientras la pantalla de
 * permisos la listaba con las dos columnas en rojo.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Deja la carga con las banderas pedidas y todo lo demás en regla.
 *
 * Los papeles y la asignación se dan por buenos a propósito: así el único
 * motivo de bloqueo que puede quedar es el que la prueba mira.
 */
function cargaConPeso(Scenario $s, bool $sobredimension, bool $sobrepeso, bool $conPermiso = false, bool $validada = false): App\Models\Load
{
    app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $sobredimension, $sobrepeso, $conPermiso, $validada): void {
        DB::table('loads')->where('id', $s->load->id)->update([
            'is_oversize' => $sobredimension ? 1 : 0,
            'is_overweight' => $sobrepeso ? 1 : 0,
            'permit_ready_approved_at' => $conPermiso ? now() : null,
            'permit_ready_approved_by_user_id' => $conPermiso ? $s->user(Role::Admin)->id : null,
            'oversize_validated_at' => $validada ? now() : null,
            'oversize_validated_by_user_id' => $validada ? $s->user(Role::Admin)->id : null,
            'updated_at' => now(),
        ]);
    });

    $carga = $s->load->fresh();
    $carga->status = LoadStatus::Assigned;

    return $carga;
}

/** Enciende o apaga el segundo par de ojos de la empresa. */
function exigirValidacionPeso(Scenario $s, bool $encendido): void
{
    app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_settings')
        ->where('tenant_id', $s->tenant->id)
        ->update(['require_oversize_admin_validation' => $encendido ? 1 : 0, 'updated_at' => now()]));
}

/* ── La puerta del permiso aprobado ──────────────────────────────────────── */

it('el sobrepeso sin permiso aprobado bloquea el despacho', function (): void {
    // ESTE ES EL FALLO. Medidas legales, peso fuera de límite: se despachaba.
    $carga = cargaConPeso($this->scenario, sobredimension: false, sobrepeso: true);

    expect(Guards::blocking($carga, 'dispatched'))->toContain('permitNotApproved');
});

it('la sobredimensión sin permiso aprobado sigue bloqueando', function (): void {
    $carga = cargaConPeso($this->scenario, sobredimension: true, sobrepeso: false);

    expect(Guards::blocking($carga, 'dispatched'))->toContain('permitNotApproved');
});

it('una carga sin ninguna de las dos banderas no pasa por esa puerta', function (): void {
    // Bloquear una carga normal sería un fallo peor que el que se arregla:
    // pararía el trabajo de todos los días.
    $carga = cargaConPeso($this->scenario, sobredimension: false, sobrepeso: false);

    expect(Guards::blocking($carga, 'dispatched'))->not->toContain('permitNotApproved');
});

it('con el permiso aprobado, el sobrepeso pasa', function (): void {
    $carga = cargaConPeso($this->scenario, sobredimension: false, sobrepeso: true, conPermiso: true);

    expect(Guards::blocking($carga, 'dispatched'))->not->toContain('permitNotApproved');
});

/* ── La puerta de la validación ──────────────────────────────────────────── */

it('el sobrepeso también necesita la validación cuando la empresa la exige', function (): void {
    exigirValidacionPeso($this->scenario, true);

    $carga = cargaConPeso($this->scenario, sobredimension: false, sobrepeso: true, conPermiso: true);

    expect(Guards::blocking($carga, 'dispatched'))->toContain('oversizeNotValidated');
});

it('el sobrepeso validado pasa', function (): void {
    exigirValidacionPeso($this->scenario, true);

    $carga = cargaConPeso(
        $this->scenario,
        sobredimension: false,
        sobrepeso: true,
        conPermiso: true,
        validada: true,
    );

    expect(Guards::blocking($carga, 'dispatched'))->not->toContain('oversizeNotValidated');
});

it('con el interruptor apagado, el sobrepeso con permiso aprobado sale', function (): void {
    exigirValidacionPeso($this->scenario, false);

    $carga = cargaConPeso($this->scenario, sobredimension: false, sobrepeso: true, conPermiso: true);

    expect(Guards::blocking($carga, 'dispatched'))
        ->not->toContain('oversizeNotValidated')
        ->not->toContain('permitNotApproved');
});

/* ── La pantalla ─────────────────────────────────────────────────────────── */

it('la pantalla de permisos dice si el bloqueo del que habla existe', function (): void {
    exigirValidacionPeso($this->scenario, true);

    $carga = cargaConPeso($this->scenario, sobredimension: false, sobrepeso: true);

    signIn($this->scenario, Role::Admin);

    $this->get("/loads/{$carga->id}/permits")
        ->assertInertia(fn ($page) => $page
            ->where('validationRequired', true)
            ->where('load.needsPapers', true));
});

it('con el interruptor apagado la pantalla no promete el bloqueo', function (): void {
    // El texto decía, tajante, «el despacho permanece bloqueado hasta que un
    // administrador valide». El ajuste viene APAGADO de fábrica: con él
    // apagado, la frase era falsa en la pantalla que lee quien delega.
    exigirValidacionPeso($this->scenario, false);

    $carga = cargaConPeso($this->scenario, sobredimension: false, sobrepeso: true);

    signIn($this->scenario, Role::Admin);

    $this->get("/loads/{$carga->id}/permits")
        ->assertInertia(fn ($page) => $page->where('validationRequired', false));
});

it('una carga sin banderas no dice que necesita papeles', function (): void {
    $carga = cargaConPeso($this->scenario, sobredimension: false, sobrepeso: false);

    signIn($this->scenario, Role::Admin);

    $this->get("/loads/{$carga->id}/permits")
        ->assertInertia(fn ($page) => $page->where('load.needsPapers', false));
});

it('el listado de permisos trae la carga con solo sobrepeso', function (): void {
    // La consulta del listado ya preguntaba por las dos banderas: era la puerta
    // la que no. Esto lo fija para que no derive al revés.
    cargaConPeso($this->scenario, sobredimension: false, sobrepeso: true);

    signIn($this->scenario, Role::Admin);

    $this->get('/permits')
        ->assertInertia(fn ($page) => $page->where(
            'loads.0.isOverweight',
            true,
        )->where('loads.0.isOversize', false));
});
