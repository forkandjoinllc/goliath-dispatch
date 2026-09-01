<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use App\Support\Tracking\CustomerLink;
use App\Support\Tracking\LinkMailer;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    Mail::fake();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Le pone al cliente de la carga un contacto principal con correo. */
function contactoPrincipal(Scenario $scenario, string $email): void
{
    DB::table('customer_contacts')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $scenario->tenant->id,
        'customer_id' => $scenario->customer->id,
        'first_name' => 'Ana',
        'last_name' => 'Contacto',
        'email' => $email,
        'is_primary' => 1,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

/** Deja la carga lista para despachar. */
function listaParaDespachar(Scenario $scenario): void
{
    $scenario->approveCarrierDocuments();
    $scenario->crew($scenario->load);

    app(TenantContext::class)->withoutTenant(fn () => DB::table('loads')
        ->where('id', $scenario->load->id)
        ->update(['status' => 'assigned', 'carrier_gross_rate_cents' => 500000, 'updated_at' => now()]));
}

// ───────────────────────────────────────────────────────────── a quién y cuándo

it('al despachar sale el enlace al contacto principal del cliente', function () {
    // Es lo que el sitio público promete en cinco sitios y no ocurría nunca.
    contactoPrincipal($this->scenario, 'compras@cliente.test');
    listaParaDespachar($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/status/dispatched")
        ->assertSessionHasNoErrors();

    $enlace = DB::table('public_tracking_links')
        ->where('load_id', $this->scenario->load->id)
        ->first();

    expect($enlace)->not->toBeNull()
        ->and($enlace->recipient_email)->toBe('compras@cliente.test')
        // Que SALIÓ, no solo que se creó.
        ->and($enlace->sent_at)->not->toBeNull();
});

it('no manda dos veces la misma carga', function () {
    // Dos correos con dos enlaces distintos para la misma carga es cómo se
    // consigue que el cliente abra el que ya no vale.
    contactoPrincipal($this->scenario, 'compras@cliente.test');
    listaParaDespachar($this->scenario);

    $tenantId = (string) $this->scenario->tenant->id;
    $loadId = (string) $this->scenario->load->id;

    // Desde el lote 64 devuelve el MOTIVO y no un sí o un no: los cuatro «no»
    // son cosas distintas y solo dos son un problema.
    expect(CustomerLink::sendForLoad($tenantId, $loadId, null))->toBe('sent')
        ->and(CustomerLink::sendForLoad($tenantId, $loadId, null))->toBe('alreadySent');

    expect(DB::table('public_tracking_links')->where('load_id', $loadId)->count())->toBe(1);
});

it('sin dirección de contacto no se manda, y no pasa nada', function () {
    // Una carga sin dirección es un dato que falta, no un error que haya que
    // gritar en mitad de un despacho.
    listaParaDespachar($this->scenario);

    app(TenantContext::class)->withoutTenant(fn () => DB::table('customers')
        ->where('id', $this->scenario->customer->id)
        ->update(['email' => null, 'email_normalized' => null]));

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/status/dispatched")
        ->assertSessionHasNoErrors();

    expect(DB::table('public_tracking_links')->count())->toBe(0)
        ->and(DB::table('loads')->where('id', $this->scenario->load->id)->value('status'))
        ->toBe('dispatched');
});

it('respeta el interruptor de enlaces públicos de la empresa', function () {
    // Un ajuste que la creación manual respeta y el envío automático se salta
    // sería el mismo defecto de siempre por la puerta de atrás.
    contactoPrincipal($this->scenario, 'compras@cliente.test');
    listaParaDespachar($this->scenario);

    app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_settings')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->update(['public_tracking_enabled' => 0, 'updated_at' => now()]));

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/status/dispatched")
        ->assertSessionHasNoErrors();

    expect(DB::table('public_tracking_links')->count())->toBe(0);
});

it('el correo que falla no rompe el despacho', function () {
    contactoPrincipal($this->scenario, 'compras@cliente.test');
    listaParaDespachar($this->scenario);

    Mail::shouldReceive('mailer')->andThrow(new RuntimeException('servidor de correo caído'));

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/status/dispatched")
        ->assertSessionHasNoErrors();

    expect(DB::table('loads')->where('id', $this->scenario->load->id)->value('status'))
        ->toBe('dispatched')
        // El enlace queda creado y SIN marcar como enviado: se reenvía a mano.
        ->and(DB::table('public_tracking_links')->whereNull('sent_at')->count())->toBe(1);
});

// ─────────────────────────────────────────────────────────────────── el mensaje

it('el correo va en el idioma de la empresa, no en el de quien despacha', function () {
    // Un despachador que tiene la aplicación en español no decide en qué idioma
    // lee su cliente.
    $es = LinkMailer::compose('a@b.test', 'https://x/t/abc', 'Demo', 'es');
    $en = LinkMailer::compose('a@b.test', 'https://x/t/abc', 'Demo', 'en');

    expect($es['subject'])->not->toBe($en['subject'])
        ->and($es['subject'])->toContain('Demo')
        ->and($es['body'])->toContain('https://x/t/abc');
});

it('el correo no lleva datos de la carga', function () {
    // Lo que viaja es la dirección. Meter aquí el número de carga o el
    // transportista sería filtrar por correo lo que la página pública controla.
    $mensaje = LinkMailer::compose('a@b.test', 'https://x/t/abc', 'Demo', 'es');

    expect($mensaje['body'])->not->toContain($this->scenario->load->load_number);
});

// ──────────────────────────────────────────────────────────────── a mano

it('se puede mandar a una dirección concreta, y crea un enlace nuevo', function () {
    listaParaDespachar($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/tracking-links/send", [
        'email' => 'otra@cliente.test',
    ])->assertSessionHas('success');

    $enlace = DB::table('public_tracking_links')->where('recipient_email', 'otra@cliente.test')->first();

    expect($enlace)->not->toBeNull()
        ->and($enlace->sent_at)->not->toBeNull()
        // El token NUNCA se guarda en claro, así que reenviar el viejo es
        // imposible por construcción. Se emite uno nuevo.
        ->and($enlace->token_hash)->not->toBeNull();
});
