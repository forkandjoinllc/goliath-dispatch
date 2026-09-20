<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Lo pendiente cambia de lado según quién mire.
 *
 * `/informes` le decía al transportista «Pendiente de cobro — qué le siguen
 * debiendo» sobre las facturas de la tarifa de despacho, que son las que ÉL
 * paga: `invoices.carrier_id` es a quién se le cobra, y `PeriodReport` estrecha
 * por esa columna cuando el alcance es de transportista.
 *
 * Lo que este fichero mide es que el NÚMERO no cambie y el NOMBRE sí.
 */
function facturaAbierta(Scenario $scenario): string
{
    DB::table('loads')->where('id', $scenario->load->id)->update([
        'carrier_id' => $scenario->assignedCarrier->id,
        'status' => 'delivered',
        'actual_delivery_at' => now()->subDay(),
        'customer_charge_cents' => 300000,
        'carrier_gross_rate_cents' => 250000,
        'carrier_dispatch_fee_bps' => 1000,
        'updated_at' => now(),
    ]);

    test()->post('/invoices', [
        'carrier_id' => $scenario->assignedCarrier->id,
        'load_ids' => [$scenario->load->id],
    ])->assertRedirect()->assertSessionHasNoErrors();

    $id = (string) DB::table('invoices')->orderByDesc('created_at')->value('id');

    test()->post("/invoices/{$id}/send")->assertRedirect();

    return $id;
}

it('la casa recibe «casa» y el transportista «transportista»', function (): void {
    signIn($this->scenario, Role::Admin);
    $this->get('/reports')->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('audience', 'casa'));

    signIn($this->scenario, Role::Carrier);
    $this->get('/reports')->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('audience', 'transportista'));
});

it('es la MISMA cifra para los dos, no otra', function (): void {
    // Si el arreglo hubiera tocado el número en vez del rótulo, esto lo dice.
    // Y con una factura abierta de verdad: con cero pendiente, «igual» y
    // «ambas mal» se ven idénticos.
    signIn($this->scenario, Role::Admin);
    facturaAbierta($this->scenario);

    $deLaCasa = null;
    $this->get('/reports')->assertOk()->assertInertia(function (Assert $p) use (&$deLaCasa) {
        $deLaCasa = $p->toArray()['props']['summary']['outstandingCents'];
    });

    expect($deLaCasa)->toBeGreaterThan(0);

    signIn($this->scenario, Role::Carrier);

    $this->get('/reports')->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('summary.outstandingCents', $deLaCasa));
});

it('al transportista se le sigue escondiendo el margen', function (): void {
    // La mitad que ya estaba bien. Si el arreglo del rótulo hubiera abierto la
    // mano con las cifras, aquí se ve.
    signIn($this->scenario, Role::Admin);
    facturaAbierta($this->scenario);

    signIn($this->scenario, Role::Carrier);

    $this->get('/reports')->assertOk()
        ->assertInertia(fn (Assert $p) => $p->missing('summary.marginCents'));
});

it('los dos rótulos llegan al diccionario que viaja a la pantalla', function (): void {
    // El componente compone la clave por audiencia; si la clave no viaja, la
    // pantalla enseña «reports.summary.owed» donde iba una cantidad.
    signIn($this->scenario, Role::Carrier);

    $this->get('/reports')->assertOk()
        ->assertInertia(fn (Assert $p) => $p
            ->has('dictionary.reports.summary.owed')
            ->has('dictionary.reports.aging.titleOwed')
            ->has('dictionary.reports.aging.noteOwed')
            ->has('dictionary.reports.index.subtitleCarrier'));
});

it('la casa y el transportista no leen la misma frase', function (): void {
    // Medido sobre el diccionario que de verdad recibe cada uno, no sobre el
    // fichero: es lo que separa «está escrito» de «se enseña».
    signIn($this->scenario, Role::Admin);
    $casa = null;
    $this->get('/reports')->assertOk()->assertInertia(function (Assert $p) use (&$casa) {
        $casa = $p->toArray()['props']['dictionary']['reports']['summary']['outstanding'];
    });

    signIn($this->scenario, Role::Carrier);
    $suyo = null;
    $this->get('/reports')->assertOk()->assertInertia(function (Assert $p) use (&$suyo) {
        $suyo = $p->toArray()['props']['dictionary']['reports']['summary']['owed'];
    });

    expect($casa)->toBeString()->and($suyo)->toBeString();
    expect($suyo)->not->toBe($casa);
});

it('un despachador es de la casa: para él sigue siendo cartera', function (): void {
    // El alcance de un despachador también estrecha el informe —a su
    // cartera— y eso NO le cambia el lado de la mesa: el dinero se le debe a
    // la empresa para la que trabaja. Acotado no es lo mismo que de fuera.
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/reports')->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('audience', 'casa'));
});
