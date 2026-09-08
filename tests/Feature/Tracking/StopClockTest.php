<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use App\Support\Tracking\StopProgress;
use App\Support\Tracking\TrackingLinks;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Deja la primera parada en un huso concreto, con ventana, y anota la llegada.
 *
 * La llegada se anota por el camino REAL —`StopProgress`— para que la hora la
 * escriba el mismo código que la escribe en producción. Fijándola a mano se
 * mediría la fijación, no el defecto.
 *
 * @return array{loadId: string, stopId: string, utc: string}
 */
function paradaConLlegada(Scenario $scenario, string $huso, string $ventana, string $instanteUtc): array
{
    $tenantId = (string) $scenario->tenant->id;
    $loadId = (string) $scenario->load->id;

    $stopId = app(TenantContext::class)->runAs($tenantId, function () use ($tenantId, $loadId, $huso, $ventana, $instanteUtc): string {
        $parada = DB::table('load_stops')
            ->where('tenant_id', $tenantId)->where('load_id', $loadId)
            ->whereNull('deleted_at')->orderBy('sequence')->first();

        DB::table('load_stops')->where('id', $parada->id)->update([
            'timezone' => $huso,
            'window_start' => $ventana,
            'window_end' => $ventana,
            'actual_arrival_at' => null,
        ]);

        StopProgress::llegada($tenantId, $loadId, (string) $parada->id, CarbonImmutable::parse($instanteUtc, 'UTC'));

        return (string) $parada->id;
    });

    return ['loadId' => $loadId, 'stopId' => $stopId, 'utc' => $instanteUtc];
}

/* ── Lo que la pantalla de despacho enseña ───────────────────────────────── */

it('la llegada se enseña en la hora del muelle, no en UTC', function () {
    // El caso exacto que se midió antes de arreglar nada: una parada de Nueva
    // York con ventana a las 08:00 y una llegada a las 09:04 locales —dentro de
    // la ventana— se guardaba y se pintaba como 13:04.
    $caso = paradaConLlegada($this->scenario, 'America/New_York', '2026-09-08 08:00:00', '2026-09-08 13:04:00');

    signIn($this->scenario, Role::Admin);

    $this->get("/loads/{$caso['loadId']}/tracking")->assertOk()->assertInertia(function ($p) {
        $parada = $p->toArray()['props']['stops'][0];

        expect($parada['arrivedAt'])->toBe('2026-09-08 09:04')
            ->and($parada['windowStart'])->toBe('2026-09-08 08:00')
            ->and($parada['zone'])->toBe('EDT');
    });
});

it('en la base sigue guardada en UTC', function () {
    // La conversión es de PINTADO. Cambiar lo guardado obligaría a reinterpretar
    // cada fila que ya existe, y una fila con el huso mal movería una cita de
    // verdad sin dejar rastro de cuál.
    $caso = paradaConLlegada($this->scenario, 'America/New_York', '2026-09-08 08:00:00', '2026-09-08 13:04:00');

    $fila = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('load_stops')->where('id', $caso['stopId'])->first()
    );

    expect(substr((string) $fila->actual_arrival_at, 0, 16))->toBe('2026-09-08 13:04');
});

it('una parada de Chicago en invierno se enseña en CST', function () {
    // La etiqueta no sale del nombre del huso: sale de la fecha. Enero y julio
    // se separan una hora, y ese es el error que un rótulo fijo dejaría puesto
    // medio año.
    $caso = paradaConLlegada($this->scenario, 'America/Chicago', '2026-01-15 08:00:00', '2026-01-15 14:30:00');

    signIn($this->scenario, Role::Admin);

    $this->get("/loads/{$caso['loadId']}/tracking")->assertOk()->assertInertia(function ($p) {
        $parada = $p->toArray()['props']['stops'][0];

        expect($parada['arrivedAt'])->toBe('2026-01-15 08:30')
            ->and($parada['zone'])->toBe('CST');
    });
});

/* ── Y lo que ve el cliente, que es lo que más importa ───────────────────── */

it('el cliente ve la misma hora que el muelle, con su reloj al lado', function () {
    $caso = paradaConLlegada($this->scenario, 'America/New_York', '2026-09-08 08:00:00', '2026-09-08 13:04:00');

    $token = app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, fn (): string => TrackingLinks::issue(
        tenantId: (string) $this->scenario->tenant->id,
        loadId: $caso['loadId'],
        label: null,
        recipientEmail: null,
        ttlHours: 48,
        createdByUserId: (string) $this->scenario->user(Role::Admin)->id,
    )['token']);

    $this->get("/t/{$token}")->assertOk()->assertInertia(function ($p) {
        $parada = $p->toArray()['props']['stops'][0];

        expect($parada['arrivedAt'])->toBe('2026-09-08 09:04')
            ->and($parada['zone'])->toBe('EDT');
    });
});

it('la cronología dice la misma hora que la parada, en la misma página', function () {
    // Este fue el susto del recorrido: al arreglar la lista de paradas, la
    // cronología de más abajo seguía en UTC. La página del cliente decía «llegó
    // a las 09:04» arriba y «13:04» abajo, del MISMO suceso. Arreglar una
    // superficie y dejar la de al lado es peor que no tocar ninguna: antes era
    // una hora mala, después son dos horas que se contradicen.
    $caso = paradaConLlegada($this->scenario, 'America/New_York', '2026-09-08 08:00:00', '2026-09-08 13:04:00');

    $token = app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, fn (): string => TrackingLinks::issue(
        tenantId: (string) $this->scenario->tenant->id,
        loadId: $caso['loadId'],
        label: null,
        recipientEmail: null,
        ttlHours: 48,
        createdByUserId: (string) $this->scenario->user(Role::Admin)->id,
    )['token']);

    $this->get("/t/{$token}")->assertOk()->assertInertia(function ($p) {
        $props = $p->toArray()['props'];

        // El tipo lleva el tipo de parada dentro: `arrived_pickup`,
        // `arrived_delivery`. Buscar 'arrived' a secas no encuentra nada, y la
        // prueba habría fallado por la aguja y no por el defecto.
        $llegada = collect($props['timeline'])
            ->first(fn (array $e): bool => str_starts_with((string) $e['type'], 'arrived'));

        expect($llegada)->not->toBeNull()
            ->and($llegada['at'])->toBe($props['stops'][0]['arrivedAt'])
            ->and($llegada['zone'])->toBe($props['stops'][0]['zone']);
    });
});

it('una parada sin huso no rompe la pantalla del cliente', function () {
    // Esta pantalla la abre alguien sin cuenta desde un enlace: un dato malo en
    // una fila no puede dejarle un error.
    $caso = paradaConLlegada($this->scenario, 'America/New_York', '2026-09-08 08:00:00', '2026-09-08 13:04:00');

    app(TenantContext::class)->withoutTenant(fn () => DB::table('load_stops')
        ->where('id', $caso['stopId'])->update(['timezone' => '']));

    $token = app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, fn (): string => TrackingLinks::issue(
        tenantId: (string) $this->scenario->tenant->id,
        loadId: $caso['loadId'],
        label: null,
        recipientEmail: null,
        ttlHours: 48,
        createdByUserId: (string) $this->scenario->user(Role::Admin)->id,
    )['token']);

    $this->get("/t/{$token}")->assertOk()->assertInertia(function ($p) {
        expect($p->toArray()['props']['stops'][0]['arrivedAt'])->toBeString();
    });
});
