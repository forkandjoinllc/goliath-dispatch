<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Loads\ScheduleConflict;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

/**
 * El mismo conductor en dos cargas que se pisan.
 *
 * La página de Servicios decía que un recurso con «un conflicto de horario» no
 * puede asignarse a una carga. No existía: ni una consulta en todo el producto
 * comparaba las asignaciones de un recurso contra las ventanas de otra carga.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    $this->escenario = Scenario::create();
    $this->tenantId = (string) $this->escenario->tenant->id;
    $this->escenario->crew($this->escenario->load);
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Una carga con una sola parada, con su ventana. */
function cargaConVentana(Scenario $e, string $numero, ?string $desde, ?string $hasta, string $estado = 'assigned'): string
{
    $id = (string) Str::uuid();

    DB::table('loads')->insert([
        'id' => $id,
        'tenant_id' => $e->tenant->id,
        'customer_id' => $e->customer->id,
        'carrier_id' => $e->assignedCarrier->id,
        'load_number' => $numero,
        'status' => $estado,
        'commodity' => 'Prueba',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    DB::table('load_stops')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $e->tenant->id,
        'load_id' => $id,
        'stop_type' => 'pickup',
        'sequence' => 1,
        'facility_name' => 'Planta',
        'city' => 'Odessa',
        'state' => 'TX',
        'timezone' => 'America/Chicago',
        'window_start' => $desde,
        'window_end' => $hasta,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

function asignar(Scenario $e, string $loadId, string $tipo, string $recursoId): void
{
    DB::table('load_assignments')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $e->tenant->id,
        'load_id' => $loadId,
        'resource_type' => $tipo,
        $tipo.'_id' => $recursoId,
        'is_primary' => true,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

function conductorDelEscenario(string $tenantId): string
{
    return (string) DB::table('drivers')->where('tenant_id', $tenantId)->value('id');
}

/**
 * Ata el conductor del escenario a su transportista.
 *
 * `Scenario::crew()` crea el conductor pero no la relación, y el desplegable de
 * asignación se llena por `driver_carrier_relationships`: sin esta fila el
 * conductor no sale en la lista, y la prueba fallaría por el fixture y no por
 * el código.
 */
function ataConductorAlTransportista(Scenario $e, string $driverId): void
{
    DB::table('driver_carrier_relationships')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $e->tenant->id,
        'driver_id' => $driverId,
        'carrier_id' => $e->assignedCarrier->id,
        'start_date' => now()->subYear()->toDateString(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

/* ── Se pisan ────────────────────────────────────────────────────────────── */

it('el mismo conductor en dos cargas que se solapan se detecta', function (): void {
    $drv = conductorDelEscenario($this->tenantId);

    $ocupada = cargaConVentana($this->escenario, 'GD-OCUPA', '2026-10-01 08:00:00', '2026-10-01 18:00:00');
    asignar($this->escenario, $ocupada, 'driver', $drv);

    $nueva = cargaConVentana($this->escenario, 'GD-NUEVA', '2026-10-01 12:00:00', '2026-10-01 20:00:00');

    $solapes = ScheduleConflict::forResource($this->tenantId, 'driver', $drv, $nueva);

    expect($solapes)->toHaveCount(1)
        ->and($solapes[0]['loadNumber'])->toBe('GD-OCUPA');
});

it('dos ventanas que no se tocan no se pisan', function (): void {
    $drv = conductorDelEscenario($this->tenantId);

    $ocupada = cargaConVentana($this->escenario, 'GD-LUNES', '2026-10-01 08:00:00', '2026-10-01 12:00:00');
    asignar($this->escenario, $ocupada, 'driver', $drv);

    $nueva = cargaConVentana($this->escenario, 'GD-MARTES', '2026-10-02 08:00:00', '2026-10-02 12:00:00');

    expect(ScheduleConflict::forResource($this->tenantId, 'driver', $drv, $nueva))->toBe([]);
});

it('tocarse por un extremo cuenta como pisarse', function (): void {
    // Terminar a las 12:00 y empezar a las 12:00 el mismo día es estar en dos
    // sitios a la vez. El caso del borde se decide a propósito y se fija aquí.
    $drv = conductorDelEscenario($this->tenantId);

    $ocupada = cargaConVentana($this->escenario, 'GD-ANTES', '2026-10-01 08:00:00', '2026-10-01 12:00:00');
    asignar($this->escenario, $ocupada, 'driver', $drv);

    $nueva = cargaConVentana($this->escenario, 'GD-DESPUES', '2026-10-01 12:00:00', '2026-10-01 18:00:00');

    expect(ScheduleConflict::forResource($this->tenantId, 'driver', $drv, $nueva))->toHaveCount(1);
});

it('una parada sin ventana de cierre dura lo que su inicio', function (): void {
    // Sin `window_end` se toma el propio inicio: una cita sin cierre no es una
    // cita que dure para siempre.
    $drv = conductorDelEscenario($this->tenantId);

    $ocupada = cargaConVentana($this->escenario, 'GD-SINFIN', '2026-10-01 08:00:00', null);
    asignar($this->escenario, $ocupada, 'driver', $drv);

    $mismoRato = cargaConVentana($this->escenario, 'GD-MISMO', '2026-10-01 06:00:00', '2026-10-01 10:00:00');
    $masTarde = cargaConVentana($this->escenario, 'GD-TARDE', '2026-10-01 14:00:00', '2026-10-01 18:00:00');

    expect(ScheduleConflict::forResource($this->tenantId, 'driver', $drv, $mismoRato))->toHaveCount(1)
        ->and(ScheduleConflict::forResource($this->tenantId, 'driver', $drv, $masTarde))->toBe([]);
});

/* ── Lo que no cuenta ────────────────────────────────────────────────────── */

it('una carga cancelada no ocupa a nadie', function (): void {
    $drv = conductorDelEscenario($this->tenantId);

    $cancelada = cargaConVentana($this->escenario, 'GD-CANCEL', '2026-10-01 08:00:00', '2026-10-01 18:00:00', 'cancelled');
    asignar($this->escenario, $cancelada, 'driver', $drv);

    $nueva = cargaConVentana($this->escenario, 'GD-VIVA', '2026-10-01 12:00:00', '2026-10-01 20:00:00');

    expect(ScheduleConflict::forResource($this->tenantId, 'driver', $drv, $nueva))->toBe([]);
});

it('un conductor retirado de la otra carga deja de ocuparla', function (): void {
    $drv = conductorDelEscenario($this->tenantId);

    $ocupada = cargaConVentana($this->escenario, 'GD-RETIRA', '2026-10-01 08:00:00', '2026-10-01 18:00:00');
    asignar($this->escenario, $ocupada, 'driver', $drv);

    DB::table('load_assignments')->where('load_id', $ocupada)
        ->update(['unassigned_at' => now(), 'unassigned_reason' => 'Prueba']);

    $nueva = cargaConVentana($this->escenario, 'GD-LIBRE', '2026-10-01 12:00:00', '2026-10-01 20:00:00');

    expect(ScheduleConflict::forResource($this->tenantId, 'driver', $drv, $nueva))->toBe([]);
});

it('una carga sin fechas no se pisa con nada', function (): void {
    // Sin ventanas no hay conflicto que afirmar, y avisar «quizá» de todo
    // convierte el aviso en ruido.
    $drv = conductorDelEscenario($this->tenantId);

    $ocupada = cargaConVentana($this->escenario, 'GD-CONFECHA', '2026-10-01 08:00:00', '2026-10-01 18:00:00');
    asignar($this->escenario, $ocupada, 'driver', $drv);

    $sinFechas = cargaConVentana($this->escenario, 'GD-SINFECHA', null, null);

    expect(ScheduleConflict::forResource($this->tenantId, 'driver', $drv, $sinFechas))->toBe([]);
});

it('otro conductor en la misma ventana no es un conflicto', function (): void {
    $drv = conductorDelEscenario($this->tenantId);

    $ocupada = cargaConVentana($this->escenario, 'GD-OTRO', '2026-10-01 08:00:00', '2026-10-01 18:00:00');
    asignar($this->escenario, $ocupada, 'driver', $drv);

    $nueva = cargaConVentana($this->escenario, 'GD-NUEVA2', '2026-10-01 12:00:00', '2026-10-01 20:00:00');

    expect(ScheduleConflict::forResource($this->tenantId, 'driver', (string) Str::uuid(), $nueva))->toBe([]);
});

/* ── Avisa, no bloquea ───────────────────────────────────────────────────── */

it('el solape NO impide asignar', function (): void {
    // Es la decisión del lote: un documento vencido es una puerta, una agenda
    // apretada es una decisión de quien despacha. Si algún día se endurece,
    // esta prueba se pone roja y obliga a cambiar también el texto de la
    // página de Servicios.
    $drv = conductorDelEscenario($this->tenantId);
    $carga = $this->escenario->load;

    DB::table('load_stops')->where('load_id', $carga->id)
        ->update(['window_start' => '2026-10-01 08:00:00', 'window_end' => '2026-10-01 18:00:00']);

    $otra = cargaConVentana($this->escenario, 'GD-CHOCA', '2026-10-01 10:00:00', '2026-10-01 20:00:00');
    asignar($this->escenario, $otra, 'driver', $drv);

    signIn($this->escenario, Role::Admin);

    $this->post("/loads/{$carga->id}/resources", [
        'resource_type' => 'driver',
        'resource_id' => $drv,
    ])->assertRedirect();

    expect(DB::table('load_assignments')
        ->where('load_id', $carga->id)
        ->where('driver_id', $drv)
        ->whereNull('unassigned_at')
        ->exists())->toBeTrue();
});

it('la ficha de la carga enseña el solape en la opción', function (): void {
    $drv = conductorDelEscenario($this->tenantId);
    $carga = $this->escenario->load;

    DB::table('load_stops')->where('load_id', $carga->id)
        ->update(['window_start' => '2026-10-01 08:00:00', 'window_end' => '2026-10-01 18:00:00']);

    $otra = cargaConVentana($this->escenario, 'GD-AVISA', '2026-10-01 10:00:00', '2026-10-01 20:00:00');
    asignar($this->escenario, $otra, 'driver', $drv);

    ataConductorAlTransportista($this->escenario, $drv);

    signIn($this->escenario, Role::Admin);

    $p = json_decode((string) json_encode(
        $this->get("/loads/{$carga->id}")->viewData('page')['props'] ?? []), true);

    $opcion = collect($p['assignable']['drivers'] ?? [])->firstWhere('id', $drv);

    expect($opcion)->not->toBeNull('El conductor no sale en el desplegable.');
    expect($opcion['conflicts'])->toHaveCount(1)
        ->and($opcion['conflicts'][0]['loadNumber'])->toBe('GD-AVISA')
        // Y sigue pudiéndose elegir.
        ->and($opcion['ok'])->toBeTrue();
});
