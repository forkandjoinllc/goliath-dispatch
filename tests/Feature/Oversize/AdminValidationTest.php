<?php

declare(strict_types=1);

use App\Enums\LoadStatus;
use App\Support\Loads\Guards;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Enciende o apaga el interruptor de la empresa. */
function exigirValidacionAdmin(Scenario $scenario, bool $encendido): void
{
    app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_settings')
        ->where('tenant_id', $scenario->tenant->id)
        ->update(['require_oversize_admin_validation' => $encendido ? 1 : 0, 'updated_at' => now()]));
}

/**
 * Una carga sobredimensionada lista para despachar salvo por lo que se pruebe.
 *
 * Se le aprueban los permisos y se le da todo lo demás: así el ÚNICO motivo de
 * bloqueo que puede quedar es el que la prueba mira.
 */
function cargaSobredimensionadaLista(Scenario $scenario, bool $validada = false): App\Models\Load
{
    app(TenantContext::class)->runAs($scenario->tenant->id, function () use ($scenario, $validada): void {
        DB::table('loads')->where('id', $scenario->load->id)->update([
            'is_oversize' => 1,
            'permit_ready_approved_at' => now(),
            'permit_ready_approved_by_user_id' => $scenario->users['admin']->id,
            'oversize_validated_at' => $validada ? now() : null,
            'oversize_validated_by_user_id' => $validada ? $scenario->users['admin']->id : null,
            'updated_at' => now(),
        ]);
    });

    $carga = $scenario->load->fresh();
    $carga->status = LoadStatus::Assigned;

    return $carga;
}

it('con el interruptor APAGADO, el permiso aprobado basta', function () {
    // El comportamiento de siempre, que no debe cambiar: una empresa que no ha
    // pedido el segundo par de ojos no puede encontrarse de pronto con cargas
    // bloqueadas.
    exigirValidacionAdmin($this->scenario, false);

    $carga = cargaSobredimensionadaLista($this->scenario, validada: false);

    expect(Guards::blocking($carga, 'dispatched'))
        ->not->toContain('oversizeNotValidated')
        ->not->toContain('permitNotApproved');
});

it('con el interruptor ENCENDIDO, hace falta además la validación', function () {
    // ESTE ES EL FALLO. La pantalla de configuración tiene un interruptor que
    // dice «las cargas sobredimensionadas necesitan validación de un
    // administrador» y NADIE lo leía: se encendía, y el despacho se comportaba
    // exactamente igual. Alguien creía tener un control que no existía, sobre
    // la parte del sistema donde la gente se hace daño.
    exigirValidacionAdmin($this->scenario, true);

    $carga = cargaSobredimensionadaLista($this->scenario, validada: false);

    expect(Guards::blocking($carga, 'dispatched'))->toContain('oversizeNotValidated');
});

it('con el interruptor encendido y la carga validada, pasa', function () {
    exigirValidacionAdmin($this->scenario, true);

    $carga = cargaSobredimensionadaLista($this->scenario, validada: true);

    expect(Guards::blocking($carga, 'dispatched'))->not->toContain('oversizeNotValidated');
});

it('a una carga que no es sobredimensionada no le afecta', function () {
    // El interruptor habla de sobredimensión. Bloquear una carga normal por él
    // sería un fallo peor que el que arregla: pararía el trabajo de todos los
    // días de una empresa que encendió una casilla sobre casos raros.
    exigirValidacionAdmin($this->scenario, true);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => DB::table('loads')
        ->where('id', $this->scenario->load->id)
        ->update(['is_oversize' => 0, 'oversize_validated_at' => null, 'updated_at' => now()]));

    $carga = $this->scenario->load->fresh();
    $carga->status = LoadStatus::Assigned;

    expect(Guards::blocking($carga, 'dispatched'))->not->toContain('oversizeNotValidated');
});

it('sin ajustes de empresa el interruptor se considera apagado', function () {
    // Falta de configuración NO es falta de permiso. Una empresa sin fila de
    // ajustes —no debería pasar, pero pasa— no puede quedarse con todas sus
    // cargas sobredimensionadas paradas por una consulta que devolvió nulo.
    app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_settings')
        ->where('tenant_id', $this->scenario->tenant->id)->delete());

    $carga = cargaSobredimensionadaLista($this->scenario, validada: false);

    expect(Guards::blocking($carga, 'dispatched'))->not->toContain('oversizeNotValidated');
});
