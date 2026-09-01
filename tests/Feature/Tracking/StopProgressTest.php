<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use App\Support\Tracking\Ingestion;
use App\Support\Tracking\Timeline;
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

/** Las paradas de la carga del transportista asignado, en orden. */
function paradasDe(Scenario $s): array
{
    return app(TenantContext::class)->runAs($s->tenant->id, fn (): array => DB::table('load_stops')
        ->where('load_id', $s->load->id)
        ->orderBy('sequence')
        ->get(['id', 'stop_type'])
        ->all());
}

it('marcar la llegada la escribe en la parada y en la línea de tiempo', function (): void {
    $paradas = paradasDe($this->scenario);
    $cuando = CarbonImmutable::now()->subHour();

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/stops/{$paradas[0]->id}/progress", [
            'event' => 'arrived',
            'occurred_at' => $cuando->format('Y-m-d\TH:i'),
        ])
        ->assertSessionHas('success');

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($paradas): void {
        // La columna que TRES pantallas leían y nadie escribía.
        expect(DB::table('load_stops')->where('id', $paradas[0]->id)->value('actual_arrival_at'))
            ->not->toBeNull();

        $eventos = Timeline::paraDespacho((string) $this->scenario->tenant->id, (string) $this->scenario->load->id);

        expect($eventos)->toHaveCount(1)
            ->and($eventos[0]['type'])->toBe('arrived_pickup')
            ->and($eventos[0]['reportedByPerson'])->toBeTrue()
            ->and($eventos[0]['location'])->toBe('Laredo, TX');
    });
});

it('no se sale de una parada a la que no consta que se llegara', function (): void {
    $paradas = paradasDe($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/stops/{$paradas[0]->id}/progress", [
            'event' => 'departed',
            'occurred_at' => CarbonImmutable::now()->format('Y-m-d\TH:i'),
        ])
        ->assertSessionHas('error', __('tracking.errors.stopNotArrivedYet'));

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($paradas): void {
        expect(DB::table('load_stops')->where('id', $paradas[0]->id)->value('actual_departure_at'))->toBeNull();
    });
});

it('no se llega a la segunda parada sin pasar por la primera', function (): void {
    $paradas = paradasDe($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/stops/{$paradas[1]->id}/progress", [
            'event' => 'arrived',
            'occurred_at' => CarbonImmutable::now()->format('Y-m-d\TH:i'),
        ])
        ->assertSessionHas('error', __('tracking.errors.earlierStopNotArrived'));
});

it('una llegada no se anota dos veces', function (): void {
    $paradas = paradasDe($this->scenario);
    $cuando = CarbonImmutable::now()->subHours(2)->format('Y-m-d\TH:i');

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/stops/{$paradas[0]->id}/progress", [
        'event' => 'arrived', 'occurred_at' => $cuando,
    ])->assertSessionHas('success');

    $this->post("/loads/{$this->scenario->load->id}/stops/{$paradas[0]->id}/progress", [
        'event' => 'arrived', 'occurred_at' => $cuando,
    ])->assertSessionHas('error', __('tracking.errors.stopAlreadyArrived'));

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        expect(DB::table('tracking_events')->where('load_id', $this->scenario->load->id)->count())->toBe(1);
    });
});

it('una llegada futura no entra', function (): void {
    $paradas = paradasDe($this->scenario);

    // Colada, se queda en lo alto de la línea de tiempo del cliente hasta que
    // el reloj la alcanza.
    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/stops/{$paradas[0]->id}/progress", [
            'event' => 'arrived',
            'occurred_at' => CarbonImmutable::now()->addDay()->format('Y-m-d\TH:i'),
        ])
        ->assertSessionHasErrors('occurred_at');
});

it('el avance se cuenta en paradas', function (): void {
    $paradas = paradasDe($this->scenario);
    signIn($this->scenario, Role::Admin);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        expect(Ingestion::paradas((string) $this->scenario->tenant->id, (string) $this->scenario->load->id))
            ->toBe(['done' => 0, 'total' => 2]);
    });

    foreach ($paradas as $i => $parada) {
        $this->post("/loads/{$this->scenario->load->id}/stops/{$parada->id}/progress", [
            'event' => 'arrived',
            'occurred_at' => CarbonImmutable::now()->subHours(5 - $i)->format('Y-m-d\TH:i'),
        ])->assertSessionHas('success');
    }

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        expect(Ingestion::paradas((string) $this->scenario->tenant->id, (string) $this->scenario->load->id))
            ->toBe(['done' => 2, 'total' => 2])
            // La caché de la sesión sigue siendo el porcentaje, porque es lo
            // que cabe en la columna. Lo que se ENSEÑA son las paradas.
            ->and(Ingestion::avance((string) $this->scenario->tenant->id, (string) $this->scenario->load->id))->toBe(100);
    });
});

it('una parada de otra carga no se marca desde esta', function (): void {
    $ajenas = app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => DB::table('load_stops')
        ->where('load_id', $this->scenario->otherLoad->id)
        ->orderBy('sequence')
        ->first(['id']));

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/stops/{$ajenas->id}/progress", [
            'event' => 'arrived',
            'occurred_at' => CarbonImmutable::now()->format('Y-m-d\TH:i'),
        ])
        ->assertSessionHas('error', __('tracking.errors.stopNotFound'));
});
