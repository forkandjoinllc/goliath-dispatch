<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Services\Billing\BillingEvent;
use App\Services\Billing\BillingProvider;
use App\Services\Billing\MockBillingProvider;
use App\Services\Billing\StripeBillingProvider;
use App\Support\TenantContext;
use Database\Seeders\SaasPlanSeeder;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->seed(SaasPlanSeeder::class);
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** La suscripción de la empresa del escenario, leída sin frontera. */
function suscripcionDelEscenario(Scenario $scenario): object
{
    return app(TenantContext::class)->withoutTenant(
        fn (): object => DB::table('tenant_subscriptions')
            ->where('tenant_id', $scenario->tenant->id)
            ->first(),
    );
}

/**
 * Los ayudantes son PROPIOS y no los de `BillingTest`.
 *
 * `suscripcionEn()` y `entregarSuceso()` están declaradas allí, en el espacio
 * global de Pest: usarlas desde aquí funciona con la suite entera y revienta
 * con este fichero solo. Un guardián que depende de que otro se haya cargado
 * antes es un guardián que un día no corre y nadie lo nota — está escrito en
 * `docs/testing.md` desde el lote de los diccionarios portados.
 */
function montarSuscripcion(Scenario $scenario, string $estado, array $extra = []): void
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

/** Manda un suceso firmado al webhook, como lo mandaría el proveedor. */
function mandarSucesoDeCobro(array $datos): TestResponse
{
    /** @var MockBillingProvider $provider */
    $provider = app(BillingProvider::class);

    $cuerpo = (string) json_encode($datos);

    return test()->call(
        'POST',
        '/billing/webhook',
        [],
        [],
        [],
        ['HTTP_X-Billing-Signature' => $provider->sign($cuerpo), 'CONTENT_TYPE' => 'application/json'],
        $cuerpo,
    );
}

/**
 * Un suceso de Stripe interpretado por su adaptador de verdad.
 *
 * Se firma como firma Stripe —`t=<hora>,v1=<hmac>`— en vez de saltarse la
 * verificación: el adaptador la exige, y una prueba que la esquivara estaría
 * midiendo un camino que en producción no existe.
 */
function sucesoDeStripe(array $suceso): ?BillingEvent
{
    $secreto = 'whsec_de_prueba';
    $cuerpo = (string) json_encode($suceso);
    $hora = time();

    $provider = new StripeBillingProvider(
        app(Factory::class),
        'sk_de_prueba',
        $secreto,
    );

    return $provider->parseWebhook(
        $cuerpo,
        't='.$hora.',v1='.hash_hmac('sha256', $hora.'.'.$cuerpo, $secreto),
    );
}

/* ── El arco entero, con el simulacro ────────────────────────────────────── */

it('programar la baja escribe la bandera y NO suspende a nadie', function (): void {
    // ESTE ES EL FALLO. La bandera no la escribía nadie: la empresa programaba
    // su baja en el portal del proveedor y la aplicación seguía diciendo «Al
    // día», sin fecha de fin y sin que nadie de la casa se enterara.
    montarSuscripcion($this->scenario, 'active');

    $fin = now()->addDays(20);

    mandarSucesoDeCobro([
        'id' => 'evt_baja_programada',
        'type' => BillingEvent::CANCEL_SCHEDULED,
        'tenant_id' => (string) $this->scenario->tenant->id,
        'period_end' => $fin->getTimestamp(),
    ])->assertOk();

    $s = suscripcionDelEscenario($this->scenario);

    expect((bool) $s->cancel_at_period_end)->toBeTrue();
    expect(substr((string) $s->current_period_end, 0, 10))->toBe($fin->toDateString());

    // Sigue ACTIVA: está pagada hasta esa fecha. Suspenderla hoy por una baja
    // de dentro de tres semanas sería cobrarle un periodo y no dárselo.
    expect((string) $s->status)->toBe('active');

    $t = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('tenants')->where('id', $this->scenario->tenant->id)->value('status'),
    );

    expect((string) $t)->toBe('active');
});

it('retirar la baja la quita', function (): void {
    montarSuscripcion($this->scenario, 'active', ['cancel_at_period_end' => 1]);

    mandarSucesoDeCobro([
        'id' => 'evt_baja_retirada',
        'type' => BillingEvent::CANCEL_REVERSED,
        'tenant_id' => (string) $this->scenario->tenant->id,
    ])->assertOk();

    expect((bool) suscripcionDelEscenario($this->scenario)->cancel_at_period_end)->toBeFalse();
});

it('cuando la baja llega de verdad, deja de estar «programada»', function (): void {
    // Si no, la pantalla diría a la vez «dada de baja» y «se dará de baja al
    // acabar el periodo».
    montarSuscripcion($this->scenario, 'active', ['cancel_at_period_end' => 1]);

    mandarSucesoDeCobro([
        'id' => 'evt_baja_hecha',
        'type' => BillingEvent::CANCELLED,
        'tenant_id' => (string) $this->scenario->tenant->id,
    ])->assertOk();

    $s = suscripcionDelEscenario($this->scenario);

    expect((string) $s->status)->toBe('cancelled');
    expect((bool) $s->cancel_at_period_end)->toBeFalse();
});

/* ── Lo que la pantalla puede decir por fin ──────────────────────────────── */

it('la pantalla de facturación enseña el aviso que antes no podía', function (): void {
    montarSuscripcion($this->scenario, 'active');

    signIn($this->scenario, Role::Admin);

    // Antes: siempre false, en las dos pantallas, para siempre.
    $this->get('/billing')->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('subscription.cancelAtPeriodEnd', false));

    mandarSucesoDeCobro([
        'id' => 'evt_para_la_pantalla',
        'type' => BillingEvent::CANCEL_SCHEDULED,
        'tenant_id' => (string) $this->scenario->tenant->id,
        'period_end' => now()->addDays(12)->getTimestamp(),
    ])->assertOk();

    signIn($this->scenario, Role::Admin);

    $this->get('/billing')->assertOk()
        ->assertInertia(fn (Assert $p) => $p
            ->where('subscription.cancelAtPeriodEnd', true)
            ->where('subscription.currentPeriodEnd', now()->addDays(12)->toDateString()));
});

it('y Ajustes dice lo mismo, que es la otra pantalla que lo lee', function (): void {
    montarSuscripcion($this->scenario, 'active', ['cancel_at_period_end' => 1]);

    signIn($this->scenario, Role::Admin);

    $this->get('/settings')->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('subscription.cancelAtPeriodEnd', true));
});

/* ── El suceso de Stripe, interpretado ───────────────────────────────────── */

it('Stripe: programar la baja se reconoce por la bandera', function (): void {
    $evento = sucesoDeStripe([
        'id' => 'evt_1',
        'type' => 'customer.subscription.updated',
        'data' => ['object' => ['id' => 'sub_1', 'cancel_at_period_end' => true]],
    ]);

    expect($evento?->type)->toBe(BillingEvent::CANCEL_SCHEDULED);
});

it('Stripe: retirarla se reconoce por lo que CAMBIÓ, no por el valor', function (): void {
    // `customer.subscription.updated` salta por cambiar de plan, de tarjeta o
    // de cualquier cosa, todas con la bandera en false. Si el valor decidiera,
    // cada una de esas anotaría una «baja retirada» que no ha pasado.
    $sinCambio = sucesoDeStripe([
        'id' => 'evt_2',
        'type' => 'customer.subscription.updated',
        'data' => ['object' => ['id' => 'sub_1', 'cancel_at_period_end' => false]],
    ]);

    expect($sinCambio?->type)->toBe(BillingEvent::IGNORED);

    $retirada = sucesoDeStripe([
        'id' => 'evt_3',
        'type' => 'customer.subscription.updated',
        'data' => [
            'object' => ['id' => 'sub_1', 'cancel_at_period_end' => false],
            'previous_attributes' => ['cancel_at_period_end' => true],
        ],
    ]);

    expect($retirada?->type)->toBe(BillingEvent::CANCEL_REVERSED);
});

it('el libro de sucesos no lo anota como ignorado', function (): void {
    // Antes caía en `IGNORED` y el libro decía «ignorado» sobre el único aviso
    // de que una empresa se estaba yendo.
    montarSuscripcion($this->scenario, 'active');

    mandarSucesoDeCobro([
        'id' => 'evt_para_el_libro',
        'type' => BillingEvent::CANCEL_SCHEDULED,
        'tenant_id' => (string) $this->scenario->tenant->id,
    ])->assertOk();

    $fila = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('stripe_events')->where('stripe_event_id', 'evt_para_el_libro')->first(),
    );

    expect($fila)->not->toBeNull();
    expect((string) $fila->processing_status)->not->toBe('ignored');
    expect((string) $fila->event_type)->toBe('mock.'.BillingEvent::CANCEL_SCHEDULED);
});
