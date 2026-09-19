<?php

declare(strict_types=1);

use App\Enums\Role;
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
 * Lo que dice /cobros cuando no sale nada.
 *
 * La pantalla decía «Ningún cobro coincide» — una sola frase para los cuatro
 * casos. Con alcance de transportista la lista viene recortada a sus propias
 * facturas, y esa frase culpa a un filtro que no hay puesto.
 *
 * El listado acotaba con un `whereExists` escrito a mano, que es por lo que el
 * guardián de `tests/Unit/Suite/EmptyStateTest.php` no lo vio: buscaba cuatro
 * formas concretas de acotar y esta no es ninguna de ellas.
 */
/** Un cobro de OTRO transportista, que la empresa ve y este transportista no. */
function cobroDeOtro(Scenario $scenario): void
{
    $facturaId = (string) Str::uuid();

    DB::table('invoices')->insert([
        'id' => $facturaId,
        'tenant_id' => $scenario->tenant->id,
        'carrier_id' => $scenario->otherCarrier->id,
        'invoice_number' => 'GD-OTRO-1',
        'status' => 'sent',
        'issue_date' => now()->toDateString(),
        'due_date' => now()->addDays(30)->toDateString(),
        'subtotal_cents' => 50000,
        'total_cents' => 50000,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    DB::table('payments')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $scenario->tenant->id,
        'invoice_id' => $facturaId,
        'amount_cents' => 50000,
        'method' => 'ach',
        'status' => 'succeeded',
        'received_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

it('el transportista sin cobros sabe que la lista está acotada a él', function (): void {
    // Con la empresa VACÍA, «no hay ninguno» y «los suyos no están» se ven
    // igual y la prueba pasaría sin que nada acotara. El cobro de otro
    // transportista es lo que separa los dos casos.
    cobroDeOtro($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->get('/payments')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('payments.data', 1));

    signIn($this->scenario, Role::Carrier);
    $this->get('/payments')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Payments/Index')
            ->where('scope', 'carrier')
            ->where('payments.data', []));
});

it('la empresa sin cobros no lee que se los pida a un administrador', function (): void {
    // Con alcance de empresa y sin permiso de crear, el componente caía en
    // `common.states.emptyNoPermission` — «su empresa no ha dado de alta
    // ninguno, pídaselo a un administrador»—, y un cobro no se da de alta:
    // aparece cuando el cliente paga. Por eso esta pantalla declara que sus
    // filas no nacen aquí y usa la pista de su propio diccionario.
    signIn($this->scenario, Role::Admin);

    DB::table('payments')->where('tenant_id', $this->scenario->tenant->id)->delete();

    $this->get('/payments')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('scope', 'tenant')
            ->where('payments.data', []));

    $pantalla = (string) file_get_contents(base_path('resources/js/pages/App/Payments/Index.tsx'));

    expect($pantalla)->toContain('createdElsewhere');
});

it('el alcance que manda es el de verdad, no uno fijo', function (): void {
    // Un `'scope' => 'tenant'` escrito a mano pasaría las dos pruebas de
    // arriba por separado. Lo que lo descarta es ver los dos valores.
    signIn($this->scenario, Role::Admin);
    $deEmpresa = $this->get('/payments')->assertOk();

    signIn($this->scenario, Role::Carrier);
    $deTransportista = $this->get('/payments')->assertOk();

    $deEmpresa->assertInertia(fn (Assert $p) => $p->where('scope', 'tenant'));
    $deTransportista->assertInertia(fn (Assert $p) => $p->where('scope', 'carrier'));
});

it('con un filtro puesto la pantalla sí puede culpar al filtro', function (): void {
    signIn($this->scenario, Role::Admin);

    $this->get('/payments?status=disputed')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.status', 'disputed')
            ->where('payments.data', []));
});

it('las cuatro claves del estado vacío de cobros existen en los dos idiomas', function (): void {
    // El componente compone la clave; si falta, la pantalla enseña la clave
    // cruda y nadie se entera hasta verla.
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode((string) file_get_contents(base_path("lang/{$idioma}/payments.json")), true);

        foreach (['empty', 'emptyHint', 'noResults', 'noResultsHint'] as $clave) {
            expect($d['index'][$clave] ?? null)->toBeString("Falta payments.index.{$clave} en {$idioma}.");
        }

        // Y que la pista diga de dónde vienen los cobros: es lo que sustituye
        // al consejo imposible de pedírselo a un administrador.
        expect(strlen((string) $d['index']['emptyHint']))->toBeGreaterThan(40);
    }
});

it('el diccionario de cobros viaja a la pantalla junto con common', function (): void {
    // El componente usa `common.states.*` para el caso acotado. Si esta
    // pantalla dejara de pedir `common`, el transportista vería la clave.
    signIn($this->scenario, Role::Carrier);

    $this->get('/payments')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('dictionary.payments.index.empty')
            ->has('dictionary.common.states.scoped.carrier')
            ->has('dictionary.common.states.scoped.carrierHint'));
});
