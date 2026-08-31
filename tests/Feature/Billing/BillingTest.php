<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Services\Billing\BillingProvider;
use App\Services\Billing\MockBillingProvider;
use App\Support\TenantContext;
use Database\Seeders\SaasPlanSeeder;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    // Los planes son de la CASA, no de una empresa: viven fuera de todo
    // `tenant_id` y los siembra su propio sembrador. Sin ellos no hay
    // suscripción posible, porque `plan_id` es NOT NULL.
    $this->seed(SaasPlanSeeder::class);
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Un suceso del proveedor simulado, firmado como lo firmaría él. */
function sucesoDeCobro(array $datos): array
{
    /** @var MockBillingProvider $provider */
    $provider = app(BillingProvider::class);

    $cuerpo = (string) json_encode($datos);

    return [$cuerpo, $provider->sign($cuerpo)];
}

/** Manda el suceso al webhook como lo mandaría el proveedor. */
function entregarSuceso(array $datos): Illuminate\Testing\TestResponse
{
    [$cuerpo, $firma] = sucesoDeCobro($datos);

    return test()->call(
        'POST',
        '/billing/webhook',
        [],
        [],
        [],
        ['HTTP_X-Billing-Signature' => $firma, 'CONTENT_TYPE' => 'application/json'],
        $cuerpo,
    );
}

/** Deja la suscripción del escenario en un estado concreto. */
function suscripcionEn(Scenario $scenario, string $estado, array $extra = []): void
{
    app(TenantContext::class)->withoutTenant(function () use ($scenario, $estado, $extra): void {
        $planId = DB::table('saas_plans')->value('id');

        DB::table('tenant_subscriptions')->updateOrInsert(
            ['tenant_id' => $scenario->tenant->id],
            array_merge([
                'id' => (string) Str::uuid(),
                'plan_id' => $planId,
                'status' => $estado,
                'created_at' => now(),
                'updated_at' => now(),
            ], $extra),
        );
    });
}

/* ── La firma es la puerta ───────────────────────────────────────────────── */

it('un suceso sin firma válida se rechaza antes de mirar nada', function () {
    // Es el único punto de entrada público que puede cambiar el dinero. Sin
    // esto, cualquiera que conozca la URL manda un «pago recibido» y se activa
    // la suscripción que quiera, gratis.
    suscripcionEn($this->scenario, 'past_due');

    $cuerpo = (string) json_encode(['id' => 'evt_falso', 'type' => 'paid', 'tenant_id' => $this->scenario->tenant->id]);

    $this->call('POST', '/billing/webhook', [], [], [], ['HTTP_X-Billing-Signature' => 'firma-inventada'], $cuerpo)
        ->assertStatus(400);

    // Y no se escribió nada: ni en el libro ni en la suscripción.
    expect(app(TenantContext::class)->withoutTenant(fn () => DB::table('stripe_events')->count()))->toBe(0);

    expect(app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_subscriptions')
        ->where('tenant_id', $this->scenario->tenant->id)->value('status')))->toBe('past_due');
});

it('el webhook no exige token CSRF', function () {
    // Lo manda un servidor de fuera, no un navegador con sesión. Si exigiera
    // token, ningún pago llegaría jamás — y el síntoma sería silencio.
    suscripcionEn($this->scenario, 'trialing');

    entregarSuceso([
        'id' => 'evt_'.Str::random(10),
        'type' => 'paid',
        'tenant_id' => (string) $this->scenario->tenant->id,
    ])->assertOk();
});

/* ── El ciclo ────────────────────────────────────────────────────────────── */

it('un pago activa la suscripción y limpia el impago', function () {
    suscripcionEn($this->scenario, 'past_due', ['past_due_since' => now()->subDays(10)]);

    entregarSuceso([
        'id' => 'evt_'.Str::random(10),
        'type' => 'paid',
        'tenant_id' => (string) $this->scenario->tenant->id,
        'customer_id' => 'cus_prueba',
        'subscription_id' => 'sub_prueba',
        'period_start' => time(),
        'period_end' => strtotime('+1 month'),
    ])->assertOk();

    $s = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_subscriptions')
        ->where('tenant_id', $this->scenario->tenant->id)->first());

    expect((string) $s->status)->toBe('active');
    expect($s->past_due_since)->toBeNull();
    expect((string) $s->stripe_customer_id)->toBe('cus_prueba');
    expect((string) $s->stripe_subscription_id)->toBe('sub_prueba');
    expect($s->current_period_end)->not->toBeNull();
});

it('un pago fallido deja past_due y NO suspende', function () {
    // Cortarle el acceso a una empresa porque su tarjeta caducó un martes es una
    // decisión de negocio y no le toca tomarla a un webhook. Suspender sigue
    // siendo un acto humano desde la pantalla de plataforma.
    suscripcionEn($this->scenario, 'active');

    entregarSuceso([
        'id' => 'evt_'.Str::random(10),
        'type' => 'payment_failed',
        'tenant_id' => (string) $this->scenario->tenant->id,
        'failure_message' => 'Tarjeta rechazada',
    ])->assertOk();

    $s = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_subscriptions')
        ->where('tenant_id', $this->scenario->tenant->id)->first());

    expect((string) $s->status)->toBe('past_due');
    expect($s->past_due_since)->not->toBeNull();

    $t = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenants')
        ->where('id', $this->scenario->tenant->id)->value('status'));

    expect((string) $t)->toBe('past_due');
    expect((string) $t)->not->toBe('suspended');
});

it('la fecha del impago es la del PRIMERO, no la del último', function () {
    // Es lo que contesta «¿cuánto lleva debiendo?», que es la pregunta con la
    // que alguien decide suspender. Sobreescribirla en cada reintento la
    // volvería «desde ayer» para siempre.
    $primerImpago = now()->subDays(20);
    suscripcionEn($this->scenario, 'past_due', ['past_due_since' => $primerImpago]);

    entregarSuceso([
        'id' => 'evt_'.Str::random(10),
        'type' => 'payment_failed',
        'tenant_id' => (string) $this->scenario->tenant->id,
    ])->assertOk();

    $s = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_subscriptions')
        ->where('tenant_id', $this->scenario->tenant->id)->first(['past_due_since']));

    expect(substr((string) $s->past_due_since, 0, 10))->toBe($primerImpago->toDateString());
});

it('una empresa suspendida a mano no se desuspende sola al cobrar', function () {
    // `tenants.status` y el estado de la suscripción dicen cosas parecidas y no
    // son lo mismo: se puede estar suspendida por un motivo que no tenga nada
    // que ver con el dinero. Lo pone una persona y solo una persona lo quita.
    suscripcionEn($this->scenario, 'past_due');

    app(TenantContext::class)->withoutTenant(fn () => DB::table('tenants')
        ->where('id', $this->scenario->tenant->id)
        ->update(['status' => 'suspended', 'updated_at' => now()]));

    entregarSuceso([
        'id' => 'evt_'.Str::random(10),
        'type' => 'paid',
        'tenant_id' => (string) $this->scenario->tenant->id,
    ])->assertOk();

    expect(app(TenantContext::class)->withoutTenant(fn () => DB::table('tenants')
        ->where('id', $this->scenario->tenant->id)->value('status')))->toBe('suspended');
});

/* ── Idempotencia ────────────────────────────────────────────────────────── */

it('el mismo suceso entregado dos veces solo se aplica una', function () {
    // Un proveedor de pagos reenvía por diseño. La forma ingenua —«mira si ya
    // está y si no insértalo»— falla justo cuando importa: dos entregas
    // simultáneas ven las dos que no está. Aquí decide el índice único.
    suscripcionEn($this->scenario, 'trialing');

    $suceso = [
        'id' => 'evt_repetido',
        'type' => 'paid',
        'tenant_id' => (string) $this->scenario->tenant->id,
        'subscription_id' => 'sub_repetido',
    ];

    entregarSuceso($suceso)->assertOk();
    entregarSuceso($suceso)->assertOk();
    entregarSuceso($suceso)->assertOk();

    $filas = app(TenantContext::class)->withoutTenant(fn () => DB::table('stripe_events')
        ->where('stripe_event_id', 'evt_repetido')->get());

    expect($filas)->toHaveCount(1);
    // Y se cuentan los reenvíos: un suceso que llega catorce veces significa que
    // algo nuestro contestó mal catorce veces.
    expect((int) $filas[0]->attempts)->toBe(3);
});

it('un suceso que no interesa se guarda y se marca como no aplicable', function () {
    // El libro es completo a propósito: es la única prueba de qué dijo el
    // proveedor y cuándo.
    suscripcionEn($this->scenario, 'active');

    entregarSuceso([
        'id' => 'evt_'.Str::random(10),
        'type' => 'algo_que_no_conocemos',
        'tenant_id' => (string) $this->scenario->tenant->id,
    ])->assertOk();

    $fila = app(TenantContext::class)->withoutTenant(fn () => DB::table('stripe_events')->first());

    expect((string) $fila->processing_status)->toBe('ignored');
});

it('el libro guarda la huella del cuerpo que llegó', function () {
    suscripcionEn($this->scenario, 'active');

    entregarSuceso([
        'id' => 'evt_huella',
        'type' => 'paid',
        'tenant_id' => (string) $this->scenario->tenant->id,
    ])->assertOk();

    $fila = app(TenantContext::class)->withoutTenant(fn () => DB::table('stripe_events')
        ->where('stripe_event_id', 'evt_huella')->first());

    expect((string) $fila->payload_digest)->toHaveLength(64);
});

it('el libro no se puede borrar ni falsear', function () {
    // Los disparadores del esquema, que existían desde el primer día sin que
    // nadie escribiera una fila que protegieran.
    suscripcionEn($this->scenario, 'active');

    entregarSuceso([
        'id' => 'evt_intocable',
        'type' => 'paid',
        'tenant_id' => (string) $this->scenario->tenant->id,
    ])->assertOk();

    app(TenantContext::class)->withoutTenant(function (): void {
        expect(fn () => DB::table('stripe_events')->where('stripe_event_id', 'evt_intocable')->delete())
            ->toThrow(Illuminate\Database\QueryException::class);

        expect(fn () => DB::table('stripe_events')->where('stripe_event_id', 'evt_intocable')
            ->update(['event_type' => 'otra_cosa']))
            ->toThrow(Illuminate\Database\QueryException::class);
    });
});

/* ── La pantalla ─────────────────────────────────────────────────────────── */

it('la pantalla dice que el cobro está simulado', function () {
    // Quien abre esto quiere saber si al pulsar «Pagar» se le va a cobrar, y esa
    // pregunta no se contesta en la salud de la plataforma ni en un `.env`.
    suscripcionEn($this->scenario, 'trialing');
    signIn($this->scenario, Role::Admin);

    $this->get('/billing')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Billing/Index')
            ->where('provider.live', false)
            ->where('provider.name', 'mock')
            ->has('plans')
        );
});

it('volver de pagar NO activa nada', function () {
    // Si activara aquí, quien pagara y cerrara la pestaña —se le va el móvil, se
    // le cae la conexión— habría pagado y se quedaría sin sistema.
    suscripcionEn($this->scenario, 'past_due');
    signIn($this->scenario, Role::Admin);

    $this->get('/billing/done')->assertOk();

    expect(app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_subscriptions')
        ->where('tenant_id', $this->scenario->tenant->id)->value('status')))->toBe('past_due');
});

it('no se puede comprar un plan que no está a la venta', function () {
    suscripcionEn($this->scenario, 'trialing');

    app(TenantContext::class)->withoutTenant(fn () => DB::table('saas_plans')
        ->where('code', 'starter')->update(['is_public' => 0]));

    signIn($this->scenario, Role::Admin);

    $this->post('/billing/checkout', ['plan_code' => 'starter'])
        ->assertSessionHasErrors('plan_code');
});

it('un despachador no ve la facturación', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/billing')->assertForbidden();
});

it('el checkout lleva a la página del proveedor', function () {
    suscripcionEn($this->scenario, 'trialing');
    signIn($this->scenario, Role::Admin);

    $plan = app(TenantContext::class)->withoutTenant(fn () => DB::table('saas_plans')
        ->where('is_public', 1)->value('code'));

    $this->post('/billing/checkout', ['plan_code' => $plan])
        ->assertRedirectContains('billing/mock-checkout');
});

/* ── El simulacro no se llama a sí mismo por red ─────────────────────────── */

it('la página de pago simulada no hace peticiones HTTP a esta aplicación', function () {
    // Lo encontró el navegador. La primera versión hacía
    // `Http::post(url('/billing/webhook'))`, que es lo que haría el proveedor de
    // verdad y parecía lo más fiel. El servidor se quedaba TREINTA SEGUNDOS
    // colgado: una petición que llama por red a su propio servidor espera a un
    // trabajador que está ocupado siendo ella misma, y con un solo proceso PHP
    // eso es un abrazo mortal.
    //
    // No es un problema del servidor de desarrollo: un servidor pequeño en
    // producción tiene exactamente un proceso libre menos de los que cree.
    $fuente = (string) file_get_contents(
        dirname(__DIR__, 3).'/app/Http/Controllers/Public/MockCheckoutController.php'
    );

    // Sin los comentarios: el de arriba de este mismo fichero explica el fallo
    // y NOMBRA la llamada que ya no está. Un guardián que se dispara con la
    // explicación de por qué existe es un guardián con falsos positivos, y uno
    // con falsos positivos se acaba desactivando.
    $codigo = implode("\n", array_filter(
        explode("\n", $fuente),
        static fn (string $linea): bool => ! str_starts_with(ltrim($linea), '//')
            && ! str_starts_with(ltrim($linea), '*')
            && ! str_starts_with(ltrim($linea), '/*'),
    ));

    expect($codigo)->not->toContain('Http::');
    expect($codigo)->not->toContain("url('/billing/webhook')");
});

it('el pago simulado aplica el suceso de verdad', function () {
    // Y sin embargo recorre el mismo camino: firma, libro, ciclo. Lo único que
    // no se ejerce es el enrutado, que lo prueban las otras.
    suscripcionEn($this->scenario, 'trialing');
    signIn($this->scenario, Role::Admin);

    $plan = app(TenantContext::class)->withoutTenant(fn () => DB::table('saas_plans')
        ->where('is_public', 1)->value('code'));

    $respuesta = $this->post('/billing/checkout', ['plan_code' => $plan]);
    $urlPago = $respuesta->headers->get('Location');

    // La página firmada, tal cual la devolvió el proveedor simulado.
    $this->get($urlPago)->assertOk();

    parse_str((string) parse_url($urlPago, PHP_URL_QUERY), $query);

    $this->post($urlPago, [
        'decision' => 'pay',
        'reference' => $query['reference'],
        'tenant' => $query['tenant'],
        'plan' => $query['plan'],
        'return' => $query['return'],
        'cancel' => $query['cancel'],
    ])->assertRedirect();

    expect(app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_subscriptions')
        ->where('tenant_id', $this->scenario->tenant->id)->value('status')))->toBe('active');

    // Y quedó en el libro, como cualquier suceso.
    expect(app(TenantContext::class)->withoutTenant(fn () => DB::table('stripe_events')->count()))->toBe(1);
});

it('el pago rechazado simulado deja la suscripción en impago', function () {
    // El camino que casi nadie prueba, y el que más se sufre.
    suscripcionEn($this->scenario, 'active');
    signIn($this->scenario, Role::Admin);

    $plan = app(TenantContext::class)->withoutTenant(fn () => DB::table('saas_plans')
        ->where('is_public', 1)->value('code'));

    $urlPago = $this->post('/billing/checkout', ['plan_code' => $plan])->headers->get('Location');
    parse_str((string) parse_url($urlPago, PHP_URL_QUERY), $query);

    $this->post($urlPago, [
        'decision' => 'fail',
        'reference' => $query['reference'],
        'tenant' => $query['tenant'],
        'plan' => $query['plan'],
        'return' => $query['return'],
        'cancel' => $query['cancel'],
    ])->assertRedirect();

    expect(app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_subscriptions')
        ->where('tenant_id', $this->scenario->tenant->id)->value('status')))->toBe('past_due');
});

it('la página de pago simulada exige firma', function () {
    // Sin ella, cualquiera abriría la página de pago de otra empresa y le
    // activaría la suscripción — que es justo lo que este módulo existe para
    // que no pase.
    signIn($this->scenario, Role::Admin);

    $this->get('/billing/mock-checkout?reference=x&tenant='.$this->scenario->tenant->id.'&plan=starter&return=Lw==&cancel=Lw==')
        ->assertForbidden();
});

/* ── No hay tarjetas por aquí ────────────────────────────────────────────── */

it('ninguna ruta ni pantalla de cobro pide un número de tarjeta', function () {
    // El pago ocurre en una página alojada por el proveedor. Meter un formulario
    // de tarjeta aquí —aunque «solo» reenviara los datos— convertiría esta
    // aplicación, sus registros y sus copias de seguridad en asunto del
    // cumplimiento de tarjetas. No lo son porque no lo tocan.
    $raiz = dirname(__DIR__, 3);

    $sospechosos = ['card_number', 'cardNumber', 'cvc', 'cvv', 'autocomplete="cc-'];

    foreach (['app/Http/Controllers/App/BillingController.php',
        'app/Http/Controllers/Public/MockCheckoutController.php',
        'resources/js/pages/App/Billing/Index.tsx',
        'resources/js/pages/Public/MockCheckout.tsx'] as $fichero) {
        $codigo = (string) file_get_contents($raiz.'/'.$fichero);

        foreach ($sospechosos as $termino) {
            expect($codigo)->not->toContain($termino, "{$fichero} menciona {$termino}");
        }
    }
});
