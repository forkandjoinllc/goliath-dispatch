<?php

declare(strict_types=1);

use App\Enums\OnboardingStatus;
use App\Enums\Role;
use App\Support\Onboarding\Transitions;
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

/** Deja al transportista del escenario en un estado, con su fila de alta. */
function altaEn(Scenario $scenario, string $estado): void
{
    DB::table('carriers')->where('id', $scenario->assignedCarrier->id)->update([
        'onboarding_status' => $estado,
        'approved_at' => $estado === 'approved' ? now() : null,
        'suspended_at' => $estado === 'suspended' ? now() : null,
        'updated_at' => now(),
    ]);

    DB::table('carrier_onboardings')->updateOrInsert(
        ['carrier_id' => $scenario->assignedCarrier->id],
        [
            'id' => (string) Str::uuid(),
            'tenant_id' => $scenario->tenant->id,
            'status' => $estado,
            'created_at' => now(),
            'updated_at' => now(),
        ],
    );
}

/** @return list<array<string, mixed>> */
function movimientosDe(Assert $p, string $carrierId): array
{
    $fila = collect($p->toArray()['props']['carriers'])->firstWhere('id', $carrierId);

    return $fila === null ? [] : $fila['moves'];
}

/* ── Las columnas ────────────────────────────────────────────────────────── */

it('manda una columna por estado, en el orden del recorrido', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/onboarding')->assertOk()->assertInertia(function (Assert $p) {
        expect($p->toArray()['props']['columns'])->toBe([
            'draft', 'submitted', 'under_review', 'corrections_required',
            'approved', 'suspended', 'rejected',
        ]);
    });
});

/* ── A dónde puede ir cada tarjeta ───────────────────────────────────────── */

it('cada tarjeta trae los destinos que el grafo admite desde su estado', function () {
    altaEn($this->scenario, 'under_review');
    signIn($this->scenario, Role::Admin);

    $este = (string) $this->scenario->assignedCarrier->id;

    $this->get('/onboarding')->assertInertia(function (Assert $p) use ($este) {
        $destinos = array_column(movimientosDe($p, $este), 'to');
        sort($destinos);

        // Desde revisión: aprobar, rechazar o pedir correcciones. Y nada más:
        // volver a borrador no existe, y el tablero no puede ofrecerlo.
        expect($destinos)->toBe(['approved', 'corrections_required', 'rejected']);
    });
});

it('no ofrece ningún destino que la transición vaya a negar', function () {
    signIn($this->scenario, Role::Admin);

    $este = (string) $this->scenario->assignedCarrier->id;

    // Se recorre el grafo entero: para cada estado, lo que el tablero ofrece
    // tiene que ser exactamente lo que `allowedFrom` admite. Una comprobación
    // de un solo estado dejaría pasar una arista mal copiada en cualquier otro.
    foreach (['draft', 'submitted', 'under_review', 'corrections_required', 'approved', 'suspended', 'rejected'] as $estado) {
        altaEn($this->scenario, $estado);

        $this->get('/onboarding')->assertInertia(function (Assert $p) use ($este, $estado) {
            foreach (movimientosDe($p, $este) as $movimiento) {
                expect(Transitions::allowedFrom(
                    $movimiento['action'],
                    OnboardingStatus::from($estado),
                ))->toBeTrue(
                    "El tablero ofrece «{$movimiento['action']}» desde «{$estado}» y el servidor no lo admite."
                );
            }
        });
    }
});

it('un estado terminal no ofrece ningún movimiento', function () {
    altaEn($this->scenario, 'rejected');
    signIn($this->scenario, Role::Admin);

    $this->get('/onboarding')->assertInertia(function (Assert $p) {
        expect(movimientosDe($p, (string) $this->scenario->assignedCarrier->id))->toBe([]);
    });
});

it('marca los tres pasos que exigen motivo escrito', function () {
    altaEn($this->scenario, 'under_review');
    signIn($this->scenario, Role::Admin);

    $this->get('/onboarding')->assertInertia(function (Assert $p) {
        $porAccion = collect(movimientosDe($p, (string) $this->scenario->assignedCarrier->id))
            ->keyBy('action');

        // Sin esta marca el tablero ejecutaría un rechazo de una sola arrastrada
        // y sin que nadie escriba por qué.
        expect($porAccion['approved']['reason'])->toBeFalse()
            ->and($porAccion['rejected']['reason'])->toBeTrue()
            ->and($porAccion['corrections_required']['reason'])->toBeTrue();
    });
});

/* ── El permiso decide lo que se ofrece ──────────────────────────────────── */

it('quien no puede aprobar no recibe el destino de aprobar', function () {
    altaEn($this->scenario, 'under_review');

    // El despachador revisa, pero no decide.
    signIn($this->scenario, Role::Dispatcher);

    $este = (string) $this->scenario->assignedCarrier->id;

    $this->get('/onboarding')->assertOk()->assertInertia(function (Assert $p) use ($este) {
        $destinos = array_column(movimientosDe($p, $este), 'to');

        expect(in_array('approved', $destinos, true))->toBeFalse(
            'El tablero ofrece aprobar a quien no tiene el permiso de aprobar.'
        );
    });
});

/* ── Soltar mueve el alta de verdad ──────────────────────────────────────── */

it('soltar en otra columna ejecuta la transición', function () {
    altaEn($this->scenario, 'submitted');
    signIn($this->scenario, Role::Admin);

    $this->post('/carriers/'.$this->scenario->assignedCarrier->id.'/onboarding/under_review')
        ->assertRedirect();

    expect((string) DB::table('carriers')
        ->where('id', $this->scenario->assignedCarrier->id)
        ->value('onboarding_status'))->toBe('under_review');
});

it('un destino que el grafo no admite se rechaza aunque se mande a mano', function () {
    altaEn($this->scenario, 'draft');
    signIn($this->scenario, Role::Admin);

    // La pantalla no lo ofrece, pero el servidor es quien manda: de borrador no
    // se salta a aprobado ni teniendo todos los permisos del mundo.
    $this->post('/carriers/'.$this->scenario->assignedCarrier->id.'/onboarding/approved')
        ->assertSessionHasErrors('action');

    expect((string) DB::table('carriers')
        ->where('id', $this->scenario->assignedCarrier->id)
        ->value('onboarding_status'))->toBe('draft');
});

it('un paso que exige motivo no pasa sin él', function () {
    altaEn($this->scenario, 'under_review');
    signIn($this->scenario, Role::Admin);

    $this->post('/carriers/'.$this->scenario->assignedCarrier->id.'/onboarding/rejected', ['reason' => ''])
        ->assertSessionHasErrors('reason');

    expect((string) DB::table('carriers')
        ->where('id', $this->scenario->assignedCarrier->id)
        ->value('onboarding_status'))->toBe('under_review');
});

/* ── Los recuentos del filtro cuadran con el tablero ─────────────────────── */

it('el recuento del filtro y las tarjetas dicen lo mismo', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/onboarding')->assertInertia(function (Assert $p) {
        $props = $p->toArray()['props'];
        $bloqueadas = count(array_filter($props['carriers'], static fn (array $c): bool => ! $c['canHaul']));

        // Dos respuestas a la misma pregunta en la misma pantalla es cómo se
        // pierde la confianza en las dos.
        expect($props['counts']['blocked'])->toBe($bloqueadas)
            ->and($props['counts']['all'])->toBe(count($props['carriers']));
    });
});
