<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Deletion\OpenWork;
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

/**
 * Borrar de verdad, pidiendo la ruta.
 *
 * El guardián de `tests/Unit/Suite` comprueba que el código llame a la pieza.
 * Esto comprueba lo otro: que con una carga en marcha el servidor DIGA QUE NO
 * y la ficha siga ahí, y que con todo cerrado sí se pueda. Una pieza correcta
 * llamada con el identificador equivocado deja pasar el mismo borrado.
 */

/** Cierra todas las cargas de este escenario, para partir de cero. */
function cerrarCargasDe(Scenario $s): void
{
    app(TenantContext::class)->runAs((string) $s->tenant->id, function () use ($s): void {
        DB::table('loads')->where('tenant_id', $s->tenant->id)->update(['status' => 'cancelled']);
    });
}

/* ── Con trabajo abierto, no ─────────────────────────────────────────────── */

it('un transportista con una carga en tránsito no se borra', function () {
    $carrierId = (string) $this->scenario->assignedCarrier->id;

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () {
        DB::table('loads')->where('id', $this->scenario->load->id)->update(['status' => 'in_transit']);
    });

    signIn($this->scenario, Role::Admin);

    $this->from("/carriers/{$carrierId}")
        ->delete("/carriers/{$carrierId}")
        ->assertSessionHasErrors('carrier');

    // Y sigue vivo: lo que importa no es el mensaje, es que la ficha no se fue.
    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($carrierId) {
        expect(DB::table('carriers')->where('id', $carrierId)->whereNull('deleted_at')->exists())->toBeTrue();
    });
});

it('tampoco con una liquidación sin pagar', function () {
    $carrierId = (string) $this->scenario->assignedCarrier->id;

    cerrarCargasDe($this->scenario);

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($carrierId) {
        DB::table('carrier_settlements')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'carrier_id' => $carrierId,
            'settlement_number' => 'S-'.Str::upper(Str::random(6)),
            'period_start' => now()->subWeek(),
            'period_end' => now(),
            'status' => 'issued',
            'net_amount_cents' => 120000,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    signIn($this->scenario, Role::Admin);

    $this->from("/carriers/{$carrierId}")
        ->delete("/carriers/{$carrierId}")
        ->assertSessionHasErrors('carrier');
});

it('tampoco con una factura con saldo', function () {
    $carrierId = (string) $this->scenario->assignedCarrier->id;

    cerrarCargasDe($this->scenario);

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($carrierId) {
        DB::table('invoices')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'carrier_id' => $carrierId,
            'invoice_number' => 'F-'.Str::upper(Str::random(6)),
            'status' => 'sent',
            'total_cents' => 50000,
            'balance_cents' => 50000,
            'issue_date' => now()->toDateString(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    signIn($this->scenario, Role::Admin);

    $this->from("/carriers/{$carrierId}")
        ->delete("/carriers/{$carrierId}")
        ->assertSessionHasErrors('carrier');
});

it('una factura ya cobrada no bloquea', function () {
    // Por SALDO y no por estado: si se mirara el estado, una `sent` cobrada
    // bloquearía para siempre y el transportista no se podría borrar nunca.
    $carrierId = (string) $this->scenario->assignedCarrier->id;

    cerrarCargasDe($this->scenario);

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($carrierId) {
        DB::table('invoices')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'carrier_id' => $carrierId,
            'invoice_number' => 'F-'.Str::upper(Str::random(6)),
            'status' => 'sent',
            'total_cents' => 50000,
            'balance_cents' => 0,
            'issue_date' => now()->toDateString(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    signIn($this->scenario, Role::Admin);

    $this->from("/carriers/{$carrierId}")
        ->delete("/carriers/{$carrierId}")
        ->assertSessionHasNoErrors();
});

it('una carga entregada y sin cobrar también bloquea', function () {
    // `delivered` NO es terminal: la carga se entregó y todavía debe dinero al
    // transportista. Un sabotaje que metía `delivered` entre los estados
    // cerrados pasó en verde porque ninguna prueba lo ejercitaba — las otras
    // usan `in_transit`.
    $carrierId = (string) $this->scenario->assignedCarrier->id;

    cerrarCargasDe($this->scenario);

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () {
        DB::table('loads')->where('id', $this->scenario->load->id)->update(['status' => 'delivered']);
    });

    signIn($this->scenario, Role::Admin);

    $this->from("/carriers/{$carrierId}")
        ->delete("/carriers/{$carrierId}")
        ->assertSessionHasErrors('carrier');
});

it('una carga facturada y sin cobrar también', function () {
    $carrierId = (string) $this->scenario->assignedCarrier->id;

    cerrarCargasDe($this->scenario);

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () {
        DB::table('loads')->where('id', $this->scenario->load->id)->update(['status' => 'invoiced']);
    });

    signIn($this->scenario, Role::Admin);

    $this->from("/carriers/{$carrierId}")
        ->delete("/carriers/{$carrierId}")
        ->assertSessionHasErrors('carrier');
});

/* ── Con todo cerrado, sí ────────────────────────────────────────────────── */

it('con todo cerrado el transportista se borra', function () {
    $carrierId = (string) $this->scenario->assignedCarrier->id;

    cerrarCargasDe($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->from("/carriers/{$carrierId}")
        ->delete("/carriers/{$carrierId}")
        ->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($carrierId) {
        // Borrado SUAVE: la fila sigue, con su marca. Las facturas de hace dos
        // años tienen que poder seguir nombrándolo.
        expect(DB::table('carriers')->where('id', $carrierId)->whereNull('deleted_at')->exists())->toBeFalse()
            ->and(DB::table('carriers')->where('id', $carrierId)->exists())->toBeTrue();
    });
});

/* ── La pantalla lo sabe antes de ofrecerlo ──────────────────────────────── */

it('la ficha del transportista trae qué lo bloquea', function () {
    $carrierId = (string) $this->scenario->assignedCarrier->id;

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () {
        DB::table('loads')->where('id', $this->scenario->load->id)->update(['status' => 'in_transit']);
    });

    signIn($this->scenario, Role::Admin);

    $this->get("/carriers/{$carrierId}")
        ->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('blocking.loads', 1));
});

it('sin nada abierto, la ficha no trae bloqueo', function () {
    $carrierId = (string) $this->scenario->assignedCarrier->id;

    cerrarCargasDe($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->get("/carriers/{$carrierId}")
        ->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('blocking', []));
});

/* ── El cliente conserva su regla ────────────────────────────────────────── */

it('el cliente sigue sin poder borrarse con una carga viva', function () {
    // La regla era suya y este lote la movió a una pieza compartida: lo que no
    // puede pasar es que al generalizarla se haya perdido.
    $customerId = (string) $this->scenario->customer->id;

    signIn($this->scenario, Role::Admin);

    $this->from("/customers/{$customerId}")
        ->delete("/customers/{$customerId}")
        ->assertSessionHasErrors('customer');
});

it('la pieza cuenta lo mismo que la ruta rechaza', function () {
    // Sin esto, una pieza correcta llamada con el identificador equivocado
    // dejaría pasar el borrado y nadie lo notaría.
    $tenantId = (string) $this->scenario->tenant->id;
    $carrierId = (string) $this->scenario->assignedCarrier->id;

    app(TenantContext::class)->runAs($tenantId, function () use ($tenantId, $carrierId) {
        DB::table('loads')->where('id', $this->scenario->load->id)->update(['status' => 'in_transit']);

        expect(OpenWork::forCarrier($tenantId, $carrierId))->toBe(['loads' => 1]);

        // Y cada transportista cuenta LO SUYO: al cerrar solo las del otro, el
        // primero sigue con la suya. El escenario da una carga a cada uno a
        // propósito, y sin este segundo transportista la prueba no distingue
        // «cuenta bien» de «cuenta todas las de la empresa».
        DB::table('loads')->where('id', $this->scenario->otherLoad->id)->update(['status' => 'cancelled']);

        expect(OpenWork::forCarrier($tenantId, (string) $this->scenario->otherCarrier->id))->toBe([])
            ->and(OpenWork::forCarrier($tenantId, $carrierId))->toBe(['loads' => 1]);
    });
});
