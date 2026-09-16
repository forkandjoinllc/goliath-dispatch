<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * La ficha de la carga, con cada hora en su reloj.
 *
 * El guardián de `tests/Unit/Suite/LoadClockTest.php` sujeta la estructura.
 * Esto planta el caso exacto que se leía mal —previsto a las 06:00 de Chicago,
 * llegada real a las 06:05, guardada en UTC como 11:05— y mira lo que sale por
 * el cable.
 */
function cargaConHoras(Scenario $s, string $husoRecogida = 'America/Chicago', string $husoEntrega = 'America/New_York'): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $husoRecogida, $husoEntrega): string {
        DB::table('loads')->where('id', $s->load->id)->update([
            // Hora de PARED: es lo que teclea el despachador.
            'planned_pickup_at' => '2026-09-16 06:00:00',
            'planned_delivery_at' => '2026-09-18 14:00:00',
            // Instantes UTC: los escribe el servidor con now().
            'actual_pickup_at' => '2026-09-16 11:05:00',
            'actual_delivery_at' => '2026-09-18 18:20:00',
            'pod_received_at' => '2026-09-18 21:30:00',
            'updated_at' => now(),
        ]);

        DB::table('load_stops')
            ->where('load_id', $s->load->id)
            ->where('stop_type', 'pickup')
            ->update(['timezone' => $husoRecogida, 'updated_at' => now()]);

        DB::table('load_stops')
            ->where('load_id', $s->load->id)
            ->where('stop_type', 'delivery')
            ->update(['timezone' => $husoEntrega, 'updated_at' => now()]);

        return (string) $s->load->id;
    });
}

it('cinco minutos de retraso se leen como cinco minutos', function () {
    $carga = cargaConHoras($this->scenario);
    signIn($this->scenario, Role::Admin);

    $this->get("/loads/{$carga}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            // Lo previsto no se toca: son las 06:00 del muelle.
            ->where('load.clock.plannedPickup.at', '2026-09-16 06:00')
            ->where('load.clock.plannedPickup.zone', 'CDT')
            // Y lo real se lleva a ESE muelle: 06:05, no 11:05.
            ->where('load.clock.actualPickup.at', '2026-09-16 06:05')
            ->where('load.clock.actualPickup.zone', 'CDT'));
});

it('la entrega usa el huso de SU parada, no el de la recogida', function () {
    $carga = cargaConHoras($this->scenario);
    signIn($this->scenario, Role::Admin);

    // Laredo a Nueva York: con un solo huso para las dos, la entrega se
    // enseñaría en hora de Texas y llegaría una hora antes de lo que dice el
    // muelle que la recibe.
    $this->get("/loads/{$carga}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('load.clock.plannedDelivery.at', '2026-09-18 14:00')
            ->where('load.clock.plannedDelivery.zone', 'EDT')
            ->where('load.clock.actualDelivery.at', '2026-09-18 14:20')
            ->where('load.clock.actualDelivery.zone', 'EDT'));
});

it('el comprobante va en el reloj de quien mira', function () {
    $carga = cargaConHoras($this->scenario);

    app(TenantContext::class)->withoutTenant(function (): void {
        DB::table('users')
            ->where('id', $this->scenario->user(Role::Admin)->id)
            ->update(['timezone' => 'America/Los_Angeles']);
    });

    signIn($this->scenario, Role::Admin);

    // 21:30 UTC son las 14:30 en Los Ángeles. No es una hora de muelle: es
    // cuándo llegó el papel a la oficina.
    $this->get("/loads/{$carga}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('load.clock.podReceived.at', '2026-09-18 14:30')
            ->where('load.clock.podReceived.zone', 'PDT'));
});

it('el formulario de edición recibe la hora tal cual la guardó', function () {
    $carga = cargaConHoras($this->scenario);
    signIn($this->scenario, Role::Admin);

    // Lo que impide que abrir la pantalla de edición MUEVA la hora. Es la misma
    // razón por la que `windowStart` de las paradas va sin recortar.
    $this->get("/loads/{$carga}/edit")
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $crudo = (string) $page->toArray()['props']['load']['plannedPickupAt'];

            expect(substr($crudo, 0, 16))->toBe('2026-09-16T06:00');
        });
});

it('el listado enseña el día del muelle, no el del navegador', function () {
    // Una recogida a las 02:00 del muelle. Guardada como hora de pared, un
    // navegador al oeste la pintaba con la fecha del día ANTERIOR.
    $carga = cargaConHoras($this->scenario);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($carga): void {
        DB::table('loads')->where('id', $carga)->update([
            'planned_pickup_at' => '2026-09-16 02:00:00',
            'updated_at' => now(),
        ]);
    });

    signIn($this->scenario, Role::Admin);

    $this->get('/loads')
        ->assertOk()
        ->assertInertia(function (Assert $page) use ($carga) {
            $fila = collect($page->toArray()['props']['loads']['data'])->firstWhere('id', $carga);

            expect($fila)->not->toBeNull();
            expect($fila['plannedPickup']['at'])->toBe('2026-09-16 02:00');
            expect($fila['plannedPickup']['zone'])->toBe('CDT');
        });
});

it('una carga sin paradas no revienta y cae al muelle por omisión', function () {
    $carga = cargaConHoras($this->scenario);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($carga): void {
        DB::table('load_stops')->where('load_id', $carga)->update(['deleted_at' => now()]);
    });

    signIn($this->scenario, Role::Admin);

    // Un borrador recién creado no tiene paradas todavía, y la ficha se abre
    // igual. El por omisión es el de las paradas —America/Chicago—, no el del
    // reloj general.
    $this->get("/loads/{$carga}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('load.clock.plannedPickup.at', '2026-09-16 06:00')
            ->where('load.clock.plannedPickup.zone', 'CDT'));
});
