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

function ajustesDe(string $tenantId): object
{
    $fila = DB::table('tenant_settings')->where('tenant_id', $tenantId)->first();

    expect($fila)->not->toBeNull();

    return (object) $fila;
}

/* ── Guardar una sección no toca las demás ──────────────────────────────── */

it('guardar dinero no escribe nada de las otras pestañas', function (): void {
    $sc = $this->scenario;
    signIn($sc, Role::Admin);

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc): void {
        DB::table('tenant_settings')->where('tenant_id', $sc->tenant->id)->update([
            'load_number_prefix' => 'ANTES',
            'contact_email' => 'antes@x.test',
            'document_expiration_warning_days' => 44,
        ]);
    });

    /*
     * La petición manda, ADEMÁS de lo suyo, campos de otras tres secciones.
     * Es lo que haría un cliente mal escrito —o alguien a mano— y es justo lo
     * que no puede escribir: `validate()` devuelve solo las claves que validó.
     */
    $this->patch('/settings', [
        'section' => 'money',
        'dispatch_fee_base' => 'commissionable_base',
        'default_carrier_dispatch_fee_bps' => 1500,
        'default_dispatcher_commission_bps' => 2000,
        'dispatcher_commission_basis' => 'dispatch_fee_amount',
        'default_payment_terms_days' => 15,

        'load_number_prefix' => 'COLADO',
        'contact_email' => 'colado@x.test',
        'document_expiration_warning_days' => 99,
    ])->assertRedirect()->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc): void {
        $f = ajustesDe($sc->tenant->id);

        // Lo suyo sí.
        expect((int) $f->default_carrier_dispatch_fee_bps)->toBe(1500);

        // Lo de las otras, intacto.
        expect($f->load_number_prefix)->toBe('ANTES');
        expect($f->contact_email)->toBe('antes@x.test');
        expect((int) $f->document_expiration_warning_days)->toBe(44);
    });
});

it('cada sección guarda lo suyo', function (): void {
    $sc = $this->scenario;
    signIn($sc, Role::Admin);

    $this->patch('/settings', [
        'section' => 'numbering',
        'load_number_prefix' => 'ZZZ',
        'invoice_number_prefix' => 'YYY',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $this->patch('/settings', [
        'section' => 'contact',
        'contact_email' => 'nuevo@x.test',
        'address_country' => 'US',
        'address_state' => 'FL',
    ])->assertRedirect()->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc): void {
        $f = ajustesDe($sc->tenant->id);

        expect($f->load_number_prefix)->toBe('ZZZ');
        expect($f->invoice_number_prefix)->toBe('YYY');
        expect($f->contact_email)->toBe('nuevo@x.test');
        expect($f->address_state)->toBe('FL');
    });
});

it('sin sección no se guarda nada', function (): void {
    /*
    | Una petición sin sección no dice qué columnas quiere escribir. Adivinarlo
    | convertiría un error del cliente en una escritura silenciosa.
    */
    $sc = $this->scenario;
    signIn($sc, Role::Admin);

    $antes = null;

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc, &$antes): void {
        $antes = ajustesDe($sc->tenant->id)->load_number_prefix;
    });

    $this->patch('/settings', [
        'load_number_prefix' => 'SINSECCION',
        'invoice_number_prefix' => 'SINSECCION',
    ])->assertSessionHasErrors('section');

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc, $antes): void {
        expect(ajustesDe($sc->tenant->id)->load_number_prefix)->toBe($antes);
    });
});

it('una sección inventada se rechaza', function (): void {
    signIn($this->scenario, Role::Admin);

    $this->patch('/settings', ['section' => 'loquesea', 'load_number_prefix' => 'X'])
        ->assertSessionHasErrors('section');
});

it('las reglas de una sección no se aplican a otra', function (): void {
    /*
    | Guardar Contacto —donde todo es opcional— no puede fallar por los
    | `required` de Dinero. Era el defecto que obligaba a partir las reglas:
    | quien guarda una pestaña no tiene delante los campos de las otras, ni
    | forma de verlos.
    */
    signIn($this->scenario, Role::Admin);

    $this->patch('/settings', ['section' => 'contact'])
        ->assertRedirect()
        ->assertSessionHasNoErrors();
});

/* ── La pestaña abierta ─────────────────────────────────────────────────── */

it('la pantalla abre la pestaña que dice la URL', function (): void {
    signIn($this->scenario, Role::Admin);

    $this->get('/settings?tab=contact')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('tab', 'contact'));
});

it('una pestaña inventada cae a la primera', function (): void {
    // Y no a ninguna: una pantalla sin sección abierta no es la respuesta a
    // «no sé qué me has pedido».
    signIn($this->scenario, Role::Admin);

    $this->get('/settings?tab=loquesea')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('tab', 'money'));
});

it('la pantalla declara sus pestañas', function (): void {
    signIn($this->scenario, Role::Admin);

    $this->get('/settings')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('tabs', ['money', 'numbering', 'ops', 'contact', 'brand', 'webhook']));
});

it('guardar devuelve a la MISMA pestaña', function (): void {
    /*
    | `back()` vuelve a la URL de origen, que lleva el parámetro. Sin eso, quien
    | guarda «Contacto» aterriza en «Dinero» y lo que ve es una pantalla que no
    | hizo nada.
    */
    signIn($this->scenario, Role::Admin);

    $this->from('/settings?tab=contact')
        ->patch('/settings', [
            'section' => 'contact',
            'address_country' => 'US',
            'address_state' => 'TX',
        ])
        ->assertRedirect('/settings?tab=contact');
});

/* ── Quién puede ────────────────────────────────────────────────────────── */

it('quien solo mira no puede guardar ninguna sección', function (): void {
    $sc = $this->scenario;
    signIn($sc, Role::Dispatcher);

    foreach (['money', 'numbering', 'ops', 'contact'] as $seccion) {
        $this->patch('/settings', ['section' => $seccion])
            ->assertRedirect()
            ->assertSessionHas('error');
    }
});

it('la pantalla le dice que solo mira', function (): void {
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/settings')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('can.update', false));
});
