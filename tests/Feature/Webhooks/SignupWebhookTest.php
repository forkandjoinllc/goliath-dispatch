<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Models\Tenant;
use App\Support\TenantContext;
use App\Support\Webhooks\Deliveries;
use App\Support\Webhooks\Signature;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

/**
 * Una dirección PÚBLICA y literal.
 *
 * Literal a propósito: `SafeUrl` resuelve los nombres de verdad, y una prueba
 * que dependa del DNS de la máquina donde corre no es una prueba, es una
 * lotería. Con una IP no hay nada que resolver y lo que se comprueba sigue
 * siendo lo mismo: que la dirección es pública.
 */
const DESTINO = 'https://93.184.216.34/hook';

beforeEach(function () {
    RateLimiter::clear('');
    app(TenantContext::class)->forget();
});

afterEach(fn () => app(TenantContext::class)->forget());

function selloWebhook(string $form = 'carrier_signup', int $hace = 10): string
{
    $payload = json_encode(['f' => $form, 't' => (int) ((microtime(true) - $hace) * 1000)]);
    $body = rtrim(strtr(base64_encode((string) $payload), '+/', '-_'), '=');
    $key = (string) config('app.key');

    if (str_starts_with($key, 'base64:')) {
        $key = (string) base64_decode(substr($key, 7), true);
    }

    return $body.'.'.hash_hmac('sha256', $body, $key);
}

function casaConWebhook(string $url = DESTINO, bool $encendido = true, string $secreto = 'whsec_pruebas_0123456789abcdef'): Tenant
{
    $casa = Tenant::create([
        'slug' => 'wh-'.Str::random(6),
        'legal_name' => 'Casa Webhook LLC',
        'display_name' => 'Webhook',
        'status' => 'active',
        'custom_domain' => 'wh-'.Str::random(6).'.test',
        'custom_domain_verified_at' => now(),
    ]);

    DB::table('tenant_settings')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $casa->id,
        'carrier_signup_webhook_url' => $url,
        'carrier_signup_webhook_secret_encrypted' => Crypt::encryptString($secreto),
        'carrier_signup_webhook_secret_last4' => substr($secreto, -4),
        'carrier_signup_webhook_enabled' => $encendido,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $casa;
}

function altaWebhook(array $cambios = []): array
{
    return [
        'legal_name' => 'Transportes Webhook LLC',
        'dot_number' => '3456783',
        'contact_first_name' => 'Iván',
        'contact_last_name' => 'Mora',
        'email' => 'ivan-'.Str::random(6).'@wh.test',
        'phone' => '+1 555 0177',
        'physical_line1' => '12 Dock St',
        'physical_city' => 'Newark',
        'physical_state' => 'nj',
        'physical_postal_code' => '07105',
        'mailing_same_as_physical' => true,
        'preferred_locale' => 'en',
        'uses_factoring' => false,
        'lead_consent' => true,
        'privacy_consent' => true,
        'terms_consent' => true,
        'hp_field' => '',
        'form_token' => selloWebhook(),
        ...$cambios,
    ];
}

/* ── El alta anota, y no manda ──────────────────────────────────────────── */

it('un alta deja una entrega pendiente', function (): void {
    Http::fake();

    $casa = casaConWebhook();

    $this->post("http://{$casa->custom_domain}/carrier-signup", altaWebhook())
        ->assertSessionHasNoErrors();

    $fila = DB::table('webhook_deliveries')->where('tenant_id', $casa->id)->first();

    expect($fila)->not->toBeNull();
    expect($fila->status)->toBe('pending');
    expect($fila->event)->toBe('carrier.signup.submitted');
    expect($fila->url)->toBe(DESTINO);

    Http::assertNothingSent();
});

it('con el webhook apagado no se anota nada', function (): void {
    $casa = casaConWebhook(encendido: false);

    $this->post("http://{$casa->custom_domain}/carrier-signup", altaWebhook())
        ->assertSessionHasNoErrors();

    expect(DB::table('webhook_deliveries')->where('tenant_id', $casa->id)->count())->toBe(0);
});

it('en el sitio de la plataforma no hay webhook', function (): void {
    casaConWebhook();

    $this->post('/carrier-signup', altaWebhook())->assertSessionHasNoErrors();

    expect(DB::table('webhook_deliveries')->count())->toBe(0);
});

it('la carga lleva el alta y no el identificador de la empresa', function (): void {
    Http::fake();

    $casa = casaConWebhook();
    $alta = altaWebhook();

    $this->post("http://{$casa->custom_domain}/carrier-signup", $alta)->assertSessionHasNoErrors();

    $carga = (string) DB::table('webhook_deliveries')->where('tenant_id', $casa->id)->value('payload');

    expect($carga)->toContain('Transportes Webhook LLC');
    expect($carga)->toContain($alta['email']);
    expect($carga)->not->toContain($casa->id);
    expect($carga)->not->toContain('tenant');
});

/* ── La entrega ─────────────────────────────────────────────────────────── */

it('el barrido entrega y firma', function (): void {
    Http::fake([DESTINO => Http::response('ok', 200)]);

    $casa = casaConWebhook();
    $this->post("http://{$casa->custom_domain}/carrier-signup", altaWebhook())->assertSessionHasNoErrors();

    $this->artisan('webhooks:deliver')->assertSuccessful();

    $fila = DB::table('webhook_deliveries')->where('tenant_id', $casa->id)->first();

    expect($fila->status)->toBe('delivered');
    expect((int) $fila->attempts)->toBe(1);
    expect((int) $fila->response_status)->toBe(200);
    expect($fila->delivered_at)->not->toBeNull();

    Http::assertSent(function ($request) {
        $firma = $request->header(Signature::HEADER)[0] ?? '';

        return Signature::check('whsec_pruebas_0123456789abcdef', $request->body(), $firma)
            && ($request->header('X-Goliath-Event')[0] ?? '') === 'carrier.signup.submitted';
    });
});

it('una firma con otro secreto no vale', function (): void {
    Http::fake([DESTINO => Http::response('ok', 200)]);

    $casa = casaConWebhook();
    $this->post("http://{$casa->custom_domain}/carrier-signup", altaWebhook())->assertSessionHasNoErrors();
    $this->artisan('webhooks:deliver');

    Http::assertSent(function ($request) {
        $firma = $request->header(Signature::HEADER)[0] ?? '';

        return ! Signature::check('whsec_otro_secreto_distinto', $request->body(), $firma);
    });
});

it('un fallo del servidor se reintenta más tarde', function (): void {
    Http::fake([DESTINO => Http::response('boom', 500)]);

    $casa = casaConWebhook();
    $this->post("http://{$casa->custom_domain}/carrier-signup", altaWebhook())->assertSessionHasNoErrors();
    $this->artisan('webhooks:deliver');

    $fila = DB::table('webhook_deliveries')->where('tenant_id', $casa->id)->first();

    expect($fila->status)->toBe('pending');
    expect((int) $fila->attempts)->toBe(1);
    expect((int) $fila->response_status)->toBe(500);
    expect($fila->next_attempt_at)->not->toBeNull();
    expect(strtotime((string) $fila->next_attempt_at))->toBeGreaterThan(time());
});

it('un 400 no se reintenta: mañana estará igual de mal', function (): void {
    Http::fake([DESTINO => Http::response('nope', 400)]);

    $casa = casaConWebhook();
    $this->post("http://{$casa->custom_domain}/carrier-signup", altaWebhook())->assertSessionHasNoErrors();
    $this->artisan('webhooks:deliver');

    $fila = DB::table('webhook_deliveries')->where('tenant_id', $casa->id)->first();

    expect($fila->status)->toBe('abandoned');
    expect($fila->next_attempt_at)->toBeNull();
});

it('un 429 sí se reintenta: es «ahora no»', function (): void {
    Http::fake([DESTINO => Http::response('slow down', 429)]);

    $casa = casaConWebhook();
    $this->post("http://{$casa->custom_domain}/carrier-signup", altaWebhook())->assertSessionHasNoErrors();
    $this->artisan('webhooks:deliver');

    expect(DB::table('webhook_deliveries')->where('tenant_id', $casa->id)->value('status'))->toBe('pending');
});

it('después de agotar los intentos se da por perdida, y se dice', function (): void {
    Http::fake([DESTINO => Http::response('boom', 503)]);

    $casa = casaConWebhook();
    $this->post("http://{$casa->custom_domain}/carrier-signup", altaWebhook())->assertSessionHasNoErrors();

    for ($i = 0; $i < 6; $i++) {
        DB::table('webhook_deliveries')->where('tenant_id', $casa->id)->update(['next_attempt_at' => now()->subMinute()]);
        $this->artisan('webhooks:deliver');
    }

    $fila = DB::table('webhook_deliveries')->where('tenant_id', $casa->id)->first();

    expect($fila->status)->toBe('abandoned');
    expect((int) $fila->attempts)->toBe(6);
});

it('una entrega que se quedó «enviando» se rescata', function (): void {
    $casa = casaConWebhook();

    $id = (string) Str::uuid();

    DB::table('webhook_deliveries')->insert([
        'id' => $id,
        'tenant_id' => $casa->id,
        'event' => 'carrier.signup.submitted',
        'url' => DESTINO,
        'payload' => '{}',
        'status' => 'sending',
        'last_attempt_at' => now()->subHour(),
        'created_at' => now()->subHour(),
        'updated_at' => now()->subHour(),
    ]);

    expect(Deliveries::rescueStuck())->toBe(1);
    expect(DB::table('webhook_deliveries')->where('id', $id)->value('status'))->toBe('pending');
});

it('una entrega recién reclamada NO se rescata', function (): void {
    $casa = casaConWebhook();

    DB::table('webhook_deliveries')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $casa->id,
        'event' => 'carrier.signup.submitted',
        'url' => DESTINO,
        'payload' => '{}',
        'status' => 'sending',
        'last_attempt_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    expect(Deliveries::rescueStuck())->toBe(0);
});

it('dos barridos seguidos no mandan la misma entrega dos veces', function (): void {
    Http::fake([DESTINO => Http::response('ok', 200)]);

    $casa = casaConWebhook();
    $this->post("http://{$casa->custom_domain}/carrier-signup", altaWebhook())->assertSessionHasNoErrors();

    $this->artisan('webhooks:deliver');
    $this->artisan('webhooks:deliver');

    expect((int) DB::table('webhook_deliveries')->where('tenant_id', $casa->id)->value('attempts'))->toBe(1);
    Http::assertSentCount(1);
});

/* ── SSRF, en vivo ──────────────────────────────────────────────────────── */

it('una URL interna no llega a guardarse', function (): void {
    $sc = Scenario::create();
    signIn($sc, Role::Admin);

    foreach ([
        'http://ejemplo.test/hook',
        'https://169.254.169.254/latest/meta-data/',
        'https://127.0.0.1/hook',
        'https://10.0.0.5/hook',
        'https://[::1]/hook',
        'https://usuario:clave@93.184.216.34/hook',
    ] as $mala) {
        $this->post('/settings/webhook', [
            'carrier_signup_webhook_url' => $mala,
            'carrier_signup_webhook_enabled' => false,
            'carrier_signup_webhook_secret' => 'whsec_1234567890abcdef',
        ])->assertSessionHasErrors('carrier_signup_webhook_url');
    }

    app(TenantContext::class)->runAs($sc->tenant->id, function (): void {
        expect(DB::table('tenant_settings')->value('carrier_signup_webhook_url'))->toBeNull();
    });
});

it('una entrega a una URL que dejó de ser válida se abandona diciendo por qué', function (): void {
    Http::fake();

    $casa = casaConWebhook();

    $id = (string) Str::uuid();

    DB::table('webhook_deliveries')->insert([
        'id' => $id,
        'tenant_id' => $casa->id,
        'event' => 'carrier.signup.submitted',
        'url' => 'https://127.0.0.1/hook',
        'payload' => '{}',
        'status' => 'pending',
        'next_attempt_at' => now()->subMinute(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $this->artisan('webhooks:deliver');

    $fila = DB::table('webhook_deliveries')->where('id', $id)->first();

    expect($fila->status)->toBe('abandoned');
    expect((string) $fila->error)->toContain('private_address');
    Http::assertNothingSent();
});

/* ── Los ajustes ────────────────────────────────────────────────────────── */

it('guardar sin secreto conserva el que había', function (): void {
    $sc = Scenario::create();
    signIn($sc, Role::Admin);

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc): void {
        DB::table('tenant_settings')->where('tenant_id', $sc->tenant->id)->update([
            'carrier_signup_webhook_url' => DESTINO,
            'carrier_signup_webhook_secret_encrypted' => Crypt::encryptString('whsec_el_de_siempre_000'),
            'carrier_signup_webhook_secret_last4' => '_000',
        ]);
    });

    $this->post('/settings/webhook', [
        'carrier_signup_webhook_url' => 'https://93.184.216.34/otro',
        'carrier_signup_webhook_enabled' => true,
        'carrier_signup_webhook_secret' => '',
    ])->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc): void {
        expect(Deliveries::settings($sc->tenant->id)['secret'])->toBe('whsec_el_de_siempre_000');
        expect(Deliveries::settings($sc->tenant->id)['url'])->toBe('https://93.184.216.34/otro');
    });
});

it('no se puede encender sin URL o sin secreto', function (): void {
    $sc = Scenario::create();
    signIn($sc, Role::Admin);

    $this->post('/settings/webhook', [
        'carrier_signup_webhook_url' => '',
        'carrier_signup_webhook_enabled' => true,
    ])->assertSessionHasErrors('carrier_signup_webhook_enabled');
});

it('la base tampoco deja encenderlo sin destino', function (): void {
    $sc = Scenario::create();

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc): void {
        expect(fn () => DB::table('tenant_settings')
            ->where('tenant_id', $sc->tenant->id)
            ->update(['carrier_signup_webhook_enabled' => 1]))
            ->toThrow(QueryException::class);
    });
});

it('el secreto no viaja nunca a la pantalla', function (): void {
    $sc = Scenario::create();

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc): void {
        DB::table('tenant_settings')->where('tenant_id', $sc->tenant->id)->update([
            'carrier_signup_webhook_url' => DESTINO,
            'carrier_signup_webhook_secret_encrypted' => Crypt::encryptString('whsec_SECRETO_QUE_NO_SALE'),
            'carrier_signup_webhook_secret_last4' => 'SALE',
        ]);
    });

    signIn($sc, Role::Admin);

    $r = $this->get('/settings');

    $r->assertOk();
    $r->assertDontSee('whsec_SECRETO_QUE_NO_SALE', false);
    $r->assertInertia(fn (Assert $page) => $page
        ->where('webhook.secretLast4', 'SALE')
        ->missing('webhook.secret'));
});

it('el secreto creado se enseña una vez y no vuelve', function (): void {
    $sc = Scenario::create();
    signIn($sc, Role::Admin);

    $this->post('/settings/webhook', [
        'carrier_signup_webhook_url' => DESTINO,
        'carrier_signup_webhook_enabled' => false,
        'generate_secret' => true,
    ])->assertSessionHasNoErrors();

    $primera = $this->get('/settings');
    $primera->assertOk();

    $secreto = $primera->viewData('page')['props']['webhookSecretOnce'];
    expect($secreto)->toBeString();
    expect($secreto)->toStartWith('whsec_');

    $segunda = $this->get('/settings');
    expect($segunda->viewData('page')['props']['webhookSecretOnce'])->toBeNull();
});

/* ── El envío de prueba ─────────────────────────────────────────────────── */

it('la prueba sale en directo y queda marcada como prueba', function (): void {
    Http::fake([DESTINO => Http::response('ok', 204)]);

    $sc = Scenario::create();

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc): void {
        DB::table('tenant_settings')->where('tenant_id', $sc->tenant->id)->update([
            'carrier_signup_webhook_url' => DESTINO,
            'carrier_signup_webhook_secret_encrypted' => Crypt::encryptString('whsec_prueba_1234567890'),
            'carrier_signup_webhook_secret_last4' => '7890',
        ]);
    });

    signIn($sc, Role::Admin);

    $this->post('/settings/webhook/test')->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc): void {
        $fila = DB::table('webhook_deliveries')->where('tenant_id', $sc->tenant->id)->first();

        expect($fila->event)->toBe('webhook.test');
        expect((bool) $fila->is_test)->toBeTrue();
        expect($fila->status)->toBe('delivered');
    });

    Http::assertSentCount(1);
});

it('una prueba correcta no cuenta como que las altas están llegando', function (): void {
    Http::fake([DESTINO => Http::response('ok', 204)]);

    $sc = Scenario::create();

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc): void {
        DB::table('tenant_settings')->where('tenant_id', $sc->tenant->id)->update([
            'carrier_signup_webhook_url' => DESTINO,
            'carrier_signup_webhook_secret_encrypted' => Crypt::encryptString('whsec_prueba_1234567890'),
            'carrier_signup_webhook_secret_last4' => '7890',
        ]);
    });

    signIn($sc, Role::Admin);
    $this->post('/settings/webhook/test');

    $this->get('/settings')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('webhook.last', null));
});

/* ── Lo que la pantalla dice del barrido ────────────────────────────────── */

it('si el barrido no ha corrido nunca, la pantalla lo dice', function (): void {
    $sc = Scenario::create();

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc): void {
        DB::table('tenant_settings')->where('tenant_id', $sc->tenant->id)->update([
            'carrier_signup_webhook_url' => DESTINO,
            'carrier_signup_webhook_secret_encrypted' => Crypt::encryptString('whsec_1234567890abcdef'),
            'carrier_signup_webhook_secret_last4' => 'cdef',
            'carrier_signup_webhook_enabled' => true,
        ]);
    });

    DB::table('job_queue')->where('job_type', 'schedule:webhooks:deliver')->delete();

    signIn($sc, Role::Admin);

    $this->get('/settings')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('webhook.sweepLastRunAt', null)
            ->where('webhook.sweepStalled', true));
});

it('después de correr el barrido, la pantalla deja de avisar', function (): void {
    Http::fake();

    $sc = Scenario::create();

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc): void {
        DB::table('tenant_settings')->where('tenant_id', $sc->tenant->id)->update([
            'carrier_signup_webhook_url' => DESTINO,
            'carrier_signup_webhook_secret_encrypted' => Crypt::encryptString('whsec_1234567890abcdef'),
            'carrier_signup_webhook_secret_last4' => 'cdef',
            'carrier_signup_webhook_enabled' => true,
        ]);
    });

    $this->artisan('webhooks:deliver')->assertSuccessful();

    signIn($sc, Role::Admin);

    $this->get('/settings')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('webhook.sweepStalled', false));
});

/* ── La firma, de cerca ─────────────────────────────────────────────────── */

it('una firma repetida de hace horas se rechaza', function (): void {
    $viejo = (int) ((microtime(true) - 7200) * 1000);
    $firma = Signature::for('whsec_x', '{"a":1}', $viejo);

    expect(Signature::check('whsec_x', '{"a":1}', $firma))->toBeFalse();
    expect(Signature::check('whsec_x', '{"a":1}', $firma, toleranceSeconds: 10800))->toBeTrue();
});

it('cambiar un byte del cuerpo invalida la firma', function (): void {
    $t = (int) (microtime(true) * 1000);
    $firma = Signature::for('whsec_x', '{"a":1}', $t);

    expect(Signature::check('whsec_x', '{"a":2}', $firma))->toBeFalse();
});
