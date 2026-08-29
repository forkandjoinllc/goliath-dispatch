<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    TenantPolicy::forget();
    $this->scenario = Scenario::create();
});

afterEach(function () {
    app(TenantContext::class)->forget();
    TenantPolicy::forget();
});

/**
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function ajustes(array $overrides = []): array
{
    return array_merge([
        'dispatch_fee_base' => 'commissionable_base',
        'default_carrier_dispatch_fee_bps' => 1200,
        'default_dispatcher_commission_bps' => 2000,
        'dispatcher_commission_basis' => 'dispatch_fee_amount',
        'default_payment_terms_days' => 15,
        'load_number_prefix' => 'FJ',
        'invoice_number_prefix' => 'FAC',
        'document_expiration_warning_days' => 20,
        'fmcsa_reverification_days' => 7,
        'allow_dispatcher_resource_assignment' => false,
        'require_oversize_admin_validation' => true,
        'public_tracking_enabled' => true,
        'public_tracking_token_ttl_hours' => 72,
        'address_country' => 'US',
        'address_state' => 'TX',
    ], $overrides);
}

/* ── Lo que este lote arregla ──────────────────────────────────────────── */

it('una carga nueva nace con la POLÍTICA de la empresa', function () {
    signIn($this->scenario, Role::Admin);

    $this->patch('/settings', ajustes())->assertRedirect()->assertSessionHasNoErrors();

    $this->post('/loads', [
        'customer_id' => $this->scenario->customer->id,
        'commodity' => 'Acero en rollos',
        'stops' => [
            ['stop_type' => 'pickup', 'sequence' => 1, 'facility_name' => 'Origen', 'city' => 'Laredo', 'state' => 'TX', 'timezone' => 'America/Chicago'],
            ['stop_type' => 'delivery', 'sequence' => 2, 'facility_name' => 'Destino', 'city' => 'Dallas', 'state' => 'TX', 'timezone' => 'America/Chicago'],
        ],
    ])->assertRedirect()->assertSessionHasNoErrors();

    $carga = DB::table('loads')->orderByDesc('created_at')->first();

    // Antes eran `?? 1000` y `?? 2500`: la política de la empresa no la leía
    // nadie y toda carga nacía con mis constantes.
    expect((int) $carga->carrier_dispatch_fee_bps)->toBe(1200)
        ->and((int) $carga->dispatcher_commission_bps)->toBe(2000)
        ->and($carga->load_number)->toStartWith('FJ-');
});

it('una factura nueva vence según el plazo de la empresa', function () {
    signIn($this->scenario, Role::Admin);
    $this->patch('/settings', ajustes())->assertRedirect();

    DB::table('loads')->where('id', $this->scenario->load->id)->update([
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'status' => 'delivered',
        'actual_delivery_at' => now()->subDay(),
        'updated_at' => now(),
    ]);

    $this->post('/invoices', [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'load_ids' => [$this->scenario->load->id],
    ])->assertRedirect();

    $id = (string) DB::table('invoices')->orderByDesc('created_at')->value('id');
    $this->post("/invoices/{$id}/send")->assertRedirect();

    $f = DB::table('invoices')->where('id', $id)->first();

    // Quince días, no los treinta que estaban escritos a mano.
    expect((int) $f->payment_terms_days)->toBe(15)
        ->and(substr((string) $f->due_date, 0, 10))->toBe(now()->addDays(15)->toDateString())
        ->and($f->invoice_number)->toStartWith('FAC-');
});

/* ── La pantalla ───────────────────────────────────────────────────────── */

it('guarda y devuelve lo guardado', function () {
    signIn($this->scenario, Role::Admin);

    $this->patch('/settings', ajustes(['default_payment_terms_days' => 45]))
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    $this->get('/settings')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('settings.default_payment_terms_days', 45)
            ->where('settings.load_number_prefix', 'FJ'));
});

it('no acepta un porcentaje por encima del cien por cien', function () {
    signIn($this->scenario, Role::Admin);

    $this->patch('/settings', ajustes(['default_carrier_dispatch_fee_bps' => 10001]))
        ->assertSessionHasErrors('default_carrier_dispatch_fee_bps');
});

it('no acepta un prefijo con minúsculas ni espacios', function () {
    signIn($this->scenario, Role::Admin);

    $this->patch('/settings', ajustes(['load_number_prefix' => 'fj 1']))
        ->assertSessionHasErrors('load_number_prefix');
});

it('el estado tiene que ser del país elegido', function () {
    signIn($this->scenario, Role::Admin);

    // TX no es de Canadá.
    $this->patch('/settings', ajustes(['address_country' => 'CA', 'address_state' => 'TX']))
        ->assertSessionHasErrors('address_state');
});

it('cambiar la política NO reescribe lo ya creado', function () {
    signIn($this->scenario, Role::Admin);

    $antes = (int) DB::table('loads')->where('id', $this->scenario->load->id)
        ->value('carrier_dispatch_fee_bps');

    $this->patch('/settings', ajustes(['default_carrier_dispatch_fee_bps' => 9999]))
        ->assertRedirect();

    // Lo que se acordó en una carga es suyo y no lo mueve un ajuste posterior.
    expect((int) DB::table('loads')->where('id', $this->scenario->load->id)
        ->value('carrier_dispatch_fee_bps'))->toBe($antes);
});

/* ── Quién puede ───────────────────────────────────────────────────────── */

it('contabilidad mira pero no toca', function () {
    signIn($this->scenario, Role::Accounting);

    $this->get('/settings')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('can.update', false));

    $this->patch('/settings', ajustes())->assertRedirect()->assertSessionHas('error');
});

it('el despachador los ve pero no los cambia', function () {
    signIn($this->scenario, Role::Dispatcher);

    // `tenant:settings:read` SÍ está en su matriz, y tiene sentido: necesita
    // saber con qué antelación avisa la aplicación de una caducidad y sobre qué
    // base se cobra la tarifa. Lo que no tiene es `tenant:settings:update`.
    $this->get('/settings')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('can.update', false));

    $this->patch('/settings', ajustes())->assertRedirect()->assertSessionHas('error');
});
