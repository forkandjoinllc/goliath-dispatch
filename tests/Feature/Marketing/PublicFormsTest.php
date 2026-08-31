<?php

declare(strict_types=1);

use App\Models\Carrier;
use App\Models\Lead;
use App\Models\QuoteRequest;
use App\Models\Tenant;
use App\Support\Forms\FormToken;
use App\Support\Plans\Limits;
use App\Support\Locales;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

uses(DatabaseTransactions::class);

beforeEach(function () {
    RateLimiter::clear('');
    app(TenantContext::class)->forget();
});

/**
 * Emite un sello y lo envejece, para no tener que dormir tres segundos por
 * prueba. Se manipula el CONTENIDO firmado, no la verificación: el sello sigue
 * pasando por el mismo hash_equals que en producción.
 */
function agedToken(string $form, int $secondsAgo = 10): string
{
    $payload = json_encode(['f' => $form, 't' => (int) ((microtime(true) - $secondsAgo) * 1000)]);
    $body = rtrim(strtr(base64_encode((string) $payload), '+/', '-_'), '=');

    $key = (string) config('app.key');
    if (str_starts_with($key, 'base64:')) {
        $key = (string) base64_decode(substr($key, 7), true);
    }

    return $body.'.'.hash_hmac('sha256', $body, $key);
}

function leadPayload(array $overrides = []): array
{
    return [
        'first_name' => 'Luis',
        'last_name' => 'Ramírez',
        'email' => 'luis-'.Str::random(6).'@forkandjoin.test',
        'phone' => '+1 555 0100',
        'company_name' => 'Fork and Join LLC',
        'message' => 'Necesito despacho para cargas sobredimensionadas.',
        'lead_consent' => true,
        'hp_field' => '',
        'form_token' => agedToken('lead'),
        ...$overrides,
    ];
}

/* ── Camino feliz ───────────────────────────────────────────────────────── */

it('guarda un lead del formulario de contacto', function () {
    $payload = leadPayload();

    $this->from('/en/contact')->post('/leads', $payload)->assertRedirect('/en/contact');

    app(TenantContext::class)->set(null);
    $lead = Lead::where('email', $payload['email'])->firstOrFail();

    expect($lead->first_name)->toBe('Luis');
    expect($lead->source)->toBe('contact_form');
    expect($lead->status)->toBe('new');
    // Sitio de la plataforma: el lead no pertenece a ninguna empresa cliente.
    expect($lead->tenant_id)->toBeNull();
});

it('guarda el idioma del envío, no el de la URL del endpoint', function () {
    $payload = leadPayload();
    $this->withCookie(Locales::COOKIE, 'es')->post('/leads', $payload);

    app(TenantContext::class)->set(null);
    expect(Lead::where('email', $payload['email'])->first()->locale->value)->toBe('es');
});

it('guarda solo los utm_, no la cadena de consulta entera', function () {
    $payload = leadPayload();

    $this->post('/leads?utm_source=google&utm_campaign=heavy&ssn=123-45-6789&secreto=x', $payload);

    app(TenantContext::class)->set(null);
    $utm = Lead::where('email', $payload['email'])->value('utm');

    expect($utm)->toBe(['utm_source' => 'google', 'utm_campaign' => 'heavy']);
    // Lo que alguien cuelgue de un enlace no entra en la base de datos.
    expect(json_encode($utm))->not->toContain('123-45-6789');
});

/* ── Validación ─────────────────────────────────────────────────────────── */

it('exige nombre, apellido y correo', function () {
    $this->post('/leads', leadPayload(['first_name' => '', 'last_name' => '', 'email' => '']))
        ->assertSessionHasErrors(['first_name', 'last_name', 'email']);
});

it('rechaza un correo con forma inválida', function () {
    $this->post('/leads', leadPayload(['email' => 'no-es-un-correo']))
        ->assertSessionHasErrors('email');
});

it('exige el consentimiento de contacto en el servidor', function () {
    // Una casilla marcada en el cliente no prueba nada: el POST puede no venir
    // del formulario.
    $this->post('/leads', leadPayload(['lead_consent' => false]))
        ->assertSessionHasErrors('lead_consent');

    app(TenantContext::class)->set(null);
    expect(Lead::count())->toBe(0);
});

/* ── Anti-spam ──────────────────────────────────────────────────────────── */

it('rechaza cuando el campo trampa viene relleno', function () {
    $this->post('/leads', leadPayload(['hp_field' => 'https://spam.example']))
        ->assertSessionHasErrors('hp_field');

    app(TenantContext::class)->set(null);
    expect(Lead::count())->toBe(0);
});

it('rechaza un envío instantáneo', function () {
    $this->post('/leads', leadPayload(['form_token' => FormToken::issue('lead')]))
        ->assertSessionHasErrors('email');

    app(TenantContext::class)->set(null);
    expect(Lead::count())->toBe(0);
});

it('rechaza un sello sin firma válida', function () {
    // Aquí está la diferencia con el diseño original: un bot que se inventa el
    // sello no puede firmarlo. Antes bastaba con mandar un Date.now() viejo.
    $forged = rtrim(strtr(base64_encode((string) json_encode([
        'f' => 'lead', 't' => (int) ((microtime(true) - 60) * 1000),
    ])), '+/', '-_'), '=').'.'.str_repeat('a', 64);

    $this->post('/leads', leadPayload(['form_token' => $forged]))
        ->assertSessionHasErrors('email');

    app(TenantContext::class)->set(null);
    expect(Lead::count())->toBe(0);
});

it('un sello de otro formulario no sirve', function () {
    $this->post('/leads', leadPayload(['form_token' => agedToken('quote')]))
        ->assertSessionHasErrors('email');
});

it('rechaza un sello caducado', function () {
    $this->post('/leads', leadPayload(['form_token' => agedToken('lead', FormToken::MAX_SECONDS + 60)]))
        ->assertSessionHasErrors('email');
});

it('el motivo del rechazo no se le dice al cliente', function () {
    // Decirle a un bot cuál de las tres defensas lo paró es enseñarle a rodearla.
    $this->post('/leads', leadPayload(['form_token' => agedToken('lead', 0)]))
        ->assertSessionHasErrors(['email' => __('marketing.forms.errors.rejected')]);

    $message = (string) __('marketing.forms.errors.rejected');
    foreach (['honeypot', 'token', 'signature', 'too_fast', 'trampa', 'firma', 'sello'] as $leak) {
        expect(mb_strtolower($message))->not->toContain($leak);
    }
});

/* ── Presupuestos ───────────────────────────────────────────────────────── */

it('una solicitud de presupuesto crea también un lead', function () {
    $email = 'quote-'.Str::random(6).'@example.test';

    $this->post('/quote-requests', [
        'contact_name' => 'Ana María Díaz',
        'email' => $email,
        'phone' => '+1 555 0111',
        'company_name' => 'Acme Shipping',
        'commodity' => 'Transformador',
        'weight_pounds' => 84000,
        'length_inches' => 480,
        'width_inches' => 144,
        'height_inches' => 168,
        'origin_city' => 'Houston',
        'origin_state' => 'tx',
        'destination_city' => 'Denver',
        'destination_state' => 'co',
        'is_oversize_suspected' => true,
        'lead_consent' => true,
        'hp_field' => '',
        'form_token' => agedToken('quote'),
    ])->assertSessionHasNoErrors();

    app(TenantContext::class)->set(null);

    $quote = QuoteRequest::where('email', $email)->firstOrFail();
    expect($quote->weight_pounds)->toBe(84000);
    expect($quote->is_oversize_suspected)->toBeTrue();
    // Los estados se normalizan a mayúsculas en el servidor.
    expect($quote->origin_state)->toBe('TX');
    expect($quote->destination_state)->toBe('CO');

    // El presupuesto es la carga; el lead es la persona a la que hay que llamar.
    $lead = Lead::where('email', $email)->firstOrFail();
    expect($lead->source)->toBe('quote_form');
    expect($lead->first_name)->toBe('Ana María');
    expect($lead->last_name)->toBe('Díaz');
    expect($quote->lead_id)->toBe($lead->id);
});

it('rechaza dimensiones con decimales', function () {
    // Una carga de 13'6" son 162 pulgadas, no 13,5 pies. Nada de decimales en una
    // medida que después decide si hace falta permiso.
    $this->post('/quote-requests', [
        'contact_name' => 'X Y', 'email' => 'x@y.test',
        'height_inches' => 162.5, 'lead_consent' => true,
        'hp_field' => '', 'form_token' => agedToken('quote'),
    ])->assertSessionHasErrors('height_inches');
});

it('rechaza una fecha de disponibilidad en el pasado', function () {
    $this->post('/quote-requests', [
        'contact_name' => 'X Y', 'email' => 'x@y.test',
        'ready_date' => now()->subWeek()->toDateString(),
        'lead_consent' => true, 'hp_field' => '', 'form_token' => agedToken('quote'),
    ])->assertSessionHasErrors('ready_date');
});

/* ── Alta de transportista ──────────────────────────────────────────────── */

function signupPayload(array $overrides = []): array
{
    return [
        'legal_name' => 'Roadway Heavy LLC',
        'dot_number' => '1234567',
        'mc_number' => 'MC987654',
        'contact_first_name' => 'Ana',
        'contact_last_name' => 'Díaz',
        'email' => 'ops-'.Str::random(6).'@roadway.test',
        'phone' => '+1 555 0122',
        'physical_line1' => '100 Freight Way',
        'physical_city' => 'Laredo',
        'physical_state' => 'tx',
        'physical_postal_code' => '78040',
        'mailing_same_as_physical' => true,
        'preferred_locale' => 'es',
        'uses_factoring' => true,
        'lead_consent' => true,
        'privacy_consent' => true,
        'terms_consent' => true,
        'hp_field' => '',
        'form_token' => agedToken('carrier_signup'),
        ...$overrides,
    ];
}

it('en el sitio de la plataforma el alta produce un lead, no un carrier', function () {
    $payload = signupPayload();

    $this->post('/carrier-signup', $payload)->assertSessionHasNoErrors();

    app(TenantContext::class)->set(null);
    $lead = Lead::where('email', $payload['email'])->firstOrFail();

    expect($lead->source)->toBe('carrier_signup');
    expect($lead->dot_number)->toBe('1234567');
    // «MC987654» y «987654» son el mismo número.
    expect($lead->mc_number)->toBe('987654');
    expect($lead->status)->toBe('new');

    // Y NO se ha inventado un carrier huérfano: carriers.tenant_id es NOT NULL.
    app(TenantContext::class)->withoutTenant(function () {
        expect(Carrier::where('dot_number', '1234567')->count())->toBe(0);
    });
});

it('bajo el dominio de una empresa el alta crea un carrier de verdad', function () {
    $tenant = Tenant::create([
        'slug' => 'host-'.Str::random(6),
        'legal_name' => 'Empresa Host LLC',
        'display_name' => 'Host',
        'status' => 'active',
        'custom_domain' => 'dispatch-'.Str::random(6).'.test',
        'custom_domain_verified_at' => now(),
    ]);

    $payload = signupPayload();

    // URL absoluta, no withServerVariables: el cliente de pruebas de Laravel
    // ignora HTTP_HOST en los server vars y sigue viendo `localhost`.
    $this->post("http://{$tenant->custom_domain}/carrier-signup", $payload)
        ->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($tenant->id, function () use ($payload) {
        $carrier = Carrier::where('dot_number', '1234567')->firstOrFail();
        expect($carrier->legal_name)->toBe('Roadway Heavy LLC');
        expect($carrier->preferred_locale->value)->toBe('es');
        expect($carrier->uses_factoring)->toBeTrue();
        // La dirección postal se COPIA, no se deja vacía: una liquidación se
        // manda ahí y «si está vacía usa la física» es donde acaba yendo mal.
        expect($carrier->mailing_line1)->toBe('100 Freight Way');
        expect($carrier->mailing_state)->toBe('TX');
        expect($carrier->carrierOnboarding)->not->toBeNull();

        expect(Lead::where('email', $payload['email'])->value('status'))->toBe('converted');
    });
});

it('un dominio sin verificar no sirve para elegir empresa', function () {
    $tenant = Tenant::create([
        'slug' => 'unver-'.Str::random(6),
        'legal_name' => 'Sin Verificar LLC',
        'display_name' => 'Sin Verificar',
        'status' => 'active',
        'custom_domain' => 'unverified-'.Str::random(6).'.test',
        'custom_domain_verified_at' => null,
    ]);

    $this->post("http://{$tenant->custom_domain}/carrier-signup", signupPayload())
        ->assertSessionHasNoErrors();

    // Si bastara con apuntar un DNS a nuestro servidor, cualquiera elegiría de
    // qué empresa recibir las altas.
    app(TenantContext::class)->runAs($tenant->id, function () {
        expect(Carrier::where('dot_number', '1234567')->count())->toBe(0);
    });
});

it('exige los tres consentimientos', function () {
    foreach (['lead_consent', 'privacy_consent', 'terms_consent'] as $field) {
        $this->post('/carrier-signup', signupPayload([$field => false]))
            ->assertSessionHasErrors($field);
    }
});

it('exige la dirección postal cuando no es la misma', function () {
    $this->post('/carrier-signup', signupPayload(['mailing_same_as_physical' => false]))
        ->assertSessionHasErrors(['mailing_line1', 'mailing_city', 'mailing_state', 'mailing_postal_code']);
});

it('valida la FORMA del USDOT, no su existencia', function () {
    // Consultar FMCSA aquí encadenaría el formulario público a un servicio
    // externo. La verificación real ocurre después, dentro del sistema.
    $this->post('/carrier-signup', signupPayload(['dot_number' => 'ABC']))
        ->assertSessionHasErrors('dot_number');
    $this->post('/carrier-signup', signupPayload(['dot_number' => '123']))
        ->assertSessionHasErrors('dot_number');
    $this->post('/carrier-signup', signupPayload(['dot_number' => '12345678']))
        ->assertSessionHasNoErrors();
});

/* ── Límite por IP ──────────────────────────────────────────────────────── */

it('limita los envíos por IP', function () {
    for ($i = 0; $i < 6; $i++) {
        $this->post('/leads', leadPayload())->assertStatus(302);
    }

    $this->post('/leads', leadPayload())->assertStatus(429);
});

it('con el tope de transportistas lleno se queda el lead y no se crea el carrier', function () {
    // El tope es una decisión comercial ENTRE la casa de despacho y nosotros.
    // Quien rellena este formulario es un tercero —una empresa de transporte que
    // quiere trabajar con ella— y no tiene por qué enterarse de nada: ve el
    // mismo «gracias» de siempre.
    //
    // Lo que NO pasa es el alta automática, que es justo lo que el tope limita.
    // El contacto llega igual a la bandeja de leads, y la casa decide: llamarle,
    // hacer sitio, o mejorar el plan. Un tope que le da un error en la cara a un
    // cliente potencial del cliente es un tope que cuesta más de lo que protege.
    $tenant = Tenant::create([
        'slug' => 'tope-'.Str::random(6),
        'legal_name' => 'Empresa Con Tope LLC',
        'display_name' => 'Con Tope',
        'status' => 'active',
        'custom_domain' => 'tope-'.Str::random(6).'.test',
        'custom_domain_verified_at' => now(),
    ]);

    $planId = (string) Str::uuid();

    app(TenantContext::class)->withoutTenant(function () use ($tenant, $planId): void {
        DB::table('saas_plans')->insert([
            'id' => $planId,
            'code' => 'tope-'.substr($planId, 0, 8),
            'name_en' => 'Capped',
            'name_es' => 'Con tope',
            'monthly_price_cents' => 1000,
            'trial_days' => 0,
            'max_carriers' => 0,
            'features' => '[]',
            'is_public' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('tenant_subscriptions')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenant->id,
            'plan_id' => $planId,
            'status' => 'active',
            'limits_enforced_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    expect(Limits::isFull((string) $tenant->id, Limits::CARRIERS))->toBeTrue();

    $payload = signupPayload();

    $this->post("http://{$tenant->custom_domain}/carrier-signup", $payload)
        ->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($tenant->id, function () use ($payload) {
        expect(Carrier::where('dot_number', '1234567')->count())->toBe(0);

        // El lead sí, y SIN marcar como convertido: no se ha convertido en nada.
        expect(Lead::where('email', $payload['email'])->value('status'))->toBe('new');
    });
});
