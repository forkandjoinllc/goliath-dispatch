<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Finance\DefaultExpenseCategories;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();

    // El escenario monta la empresa con modelos, no con ProvisionTenant, así
    // que las categorías hay que pedirlas. Que esta llamada esté aquí también
    // prueba lo suyo: sin ella, `expenses.category_id` es NOT NULL y no se
    // podría dar de alta ni un gasto.
    DefaultExpenseCategories::ensureFor((string) $this->scenario->tenant->id);
});

afterEach(fn () => app(TenantContext::class)->forget());

function categoria(Scenario $scenario, string $code): object
{
    return DB::table('expense_categories')
        ->where('tenant_id', $scenario->tenant->id)
        ->where('code', $code)
        ->first();
}

/** Da de alta un gasto y devuelve su id. */
function gasto(Scenario $scenario, string $code, int $cents, ?string $loadId = null): string
{
    // Se apunta lo que había ANTES en vez de ordenar por fecha: `created_at` es
    // datetime(3) y dos gastos del mismo test caen en el mismo milisegundo más
    // veces de las que uno espera. Una prueba que falla una vez de cada treinta
    // es peor que una que no existe.
    $previos = DB::table('expenses')->pluck('id')->all();

    test()->post('/expenses', [
        'load_id' => $loadId ?? $scenario->load->id,
        'category_id' => categoria($scenario, $code)->id,
        'amount_cents' => $cents,
    ])->assertRedirect();

    $id = DB::table('expenses')->whereNotIn('id', $previos === [] ? [''] : $previos)->value('id');

    expect($id)->not->toBeNull();

    /*
     * Y su recibo, si la categoría lo exige.
     *
     * Desde el lote 66 un gasto de una categoría con recibo obligatorio no se
     * puede aprobar sin él, y la mitad de las categorías de serie lo exigen —el
     * combustible, entre ellas—. Se arregla EL AYUDANTE y no las pruebas: lo que
     * comprueban es que un gasto aprobado mueve el dinero, no cómo llegó a
     * aprobarse, y montar un gasto que no puede aprobarse no probaría nada más
     * que la puerta nueva.
     *
     * Es la misma decisión que se tomó en el lote 60, cuando exigir cuatro fotos
     * al equipo rompió veintiuna pruebas ajenas: el escenario tiene que producir
     * cosas que PUEDEN trabajar.
     */
    if ((bool) categoria($scenario, $code)->requires_receipt) {
        test()->post("/expenses/{$id}/receipt", [
            'file' => \Illuminate\Http\UploadedFile::fake()->create('recibo.pdf', 40, 'application/pdf'),
        ])->assertSessionHasNoErrors();
    }

    return (string) $id;
}

/**
 * Nombre propio: Pest carga todos los ficheros de prueba en el MISMO espacio
 * global, así que dos ficheros con una función homónima no chocan al ejecutar
 * uno — chocan al ejecutar la suite entera, con un fatal que impide correr
 * TODAS las pruebas.
 */
function cargaEntregadaConGastos(Scenario $scenario): object
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

    return DB::table('loads')->where('id', $scenario->load->id)->first();
}

/* ── Las categorías ─────────────────────────────────────────────────────── */

it('crea las nueve categorías del catálogo y no las duplica', function () {
    $tenantId = (string) $this->scenario->tenant->id;

    expect(DB::table('expense_categories')->where('tenant_id', $tenantId)->count())
        ->toBe(count(DefaultExpenseCategories::CATALOG));

    // Reanudable: una segunda pasada no crea nada.
    expect(DefaultExpenseCategories::ensureFor($tenantId))->toBe(0);
    expect(DB::table('expense_categories')->where('tenant_id', $tenantId)->count())
        ->toBe(count(DefaultExpenseCategories::CATALOG));
});

it('no revierte el tratamiento que la empresa cambió a mano', function () {
    $tenantId = (string) $this->scenario->tenant->id;

    DB::table('expense_categories')
        ->where('tenant_id', $tenantId)
        ->where('code', 'fuel')
        ->update(['treatment' => 'tenant_absorbed']);

    DefaultExpenseCategories::ensureFor($tenantId);

    expect(categoria($this->scenario, 'fuel')->treatment)->toBe('tenant_absorbed');
});

/* ── Dar de alta ────────────────────────────────────────────────────────── */

it('nace presentado, nunca aprobado', function () {
    signIn($this->scenario, Role::Admin);
    $id = gasto($this->scenario, 'fuel', 12500);

    $e = DB::table('expenses')->where('id', $id)->first();

    expect($e->status)->toBe('submitted')
        ->and((int) $e->amount_cents)->toBe(12500)
        ->and($e->reviewed_at)->toBeNull();
});

it('congela el tratamiento de la categoría en el gasto', function () {
    signIn($this->scenario, Role::Admin);
    $id = gasto($this->scenario, 'fuel', 10000);

    expect(DB::table('expenses')->where('id', $id)->value('treatment_snapshot'))
        ->toBe('reimbursable_to_carrier');

    // Cambiar la categoría DESPUÉS no puede reescribir un gasto ya presentado:
    // si lo hiciera, una liquidación cerrada cambiaría de cifra sola.
    DB::table('expense_categories')
        ->where('id', categoria($this->scenario, 'fuel')->id)
        ->update(['treatment' => 'carrier_deduction']);

    expect(DB::table('expenses')->where('id', $id)->value('treatment_snapshot'))
        ->toBe('reimbursable_to_carrier');
});

it('copia el transportista de la carga al gasto', function () {
    signIn($this->scenario, Role::Admin);
    cargaEntregadaConGastos($this->scenario);
    $id = gasto($this->scenario, 'fuel', 10000);

    expect(DB::table('expenses')->where('id', $id)->value('carrier_id'))
        ->toBe((string) $this->scenario->assignedCarrier->id);
});

it('rechaza una categoría desactivada', function () {
    signIn($this->scenario, Role::Admin);

    DB::table('expense_categories')
        ->where('id', categoria($this->scenario, 'fuel')->id)
        ->update(['active' => false]);

    $this->post('/expenses', [
        'load_id' => $this->scenario->load->id,
        'category_id' => categoria($this->scenario, 'fuel')->id,
        'amount_cents' => 10000,
    ])->assertSessionHasErrors('category_id');
});

it('no acepta un importe de cero', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/expenses', [
        'load_id' => $this->scenario->load->id,
        'category_id' => categoria($this->scenario, 'fuel')->id,
        'amount_cents' => 0,
    ])->assertSessionHasErrors('amount_cents');
});

/* ── Lo que este lote existe para arreglar ──────────────────────────────── */

it('un gasto PRESENTADO no mueve el dinero; uno APROBADO sí', function () {
    signIn($this->scenario, Role::Admin);
    $carga = cargaEntregadaConGastos($this->scenario);

    // Combustible: reembolsable al transportista, 40.000.
    $id = gasto($this->scenario, 'fuel', 40000);

    $this->post('/invoices', [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'load_ids' => [$carga->id],
    ])->assertRedirect();

    // Presentado y sin revisar: los cuatro cubos siguen en cero.
    $primera = DB::table('financial_snapshots')->where('load_id', $carga->id)->first();
    expect((int) $primera->approved_reimbursable_expenses_cents)->toBe(0);

    // Se aprueba y se calcula una carga nueva desde cero: ahora sí cuenta.
    $this->post("/expenses/{$id}/approve")->assertRedirect();

    $financials = app(App\Support\Finance\LoadCalculator::class)
        ->for(App\Models\Load::withoutTenantScope()->findOrFail($carga->id));

    expect($financials->reimbursableExpenses)->toBe(40000);
});

it('reembolsado cuenta igual que aprobado', function () {
    signIn($this->scenario, Role::Admin);
    $carga = cargaEntregadaConGastos($this->scenario);
    $id = gasto($this->scenario, 'fuel', 40000);

    $this->post("/expenses/{$id}/approve")->assertRedirect();
    $this->post("/expenses/{$id}/reimburse")->assertRedirect();

    $financials = app(App\Support\Finance\LoadCalculator::class)
        ->for(App\Models\Load::withoutTenantScope()->findOrFail($carga->id));

    expect($financials->reimbursableExpenses)->toBe(40000);
});

it('avisa cuando la carga ya está facturada y no toca la factura', function () {
    signIn($this->scenario, Role::Admin);
    $carga = cargaEntregadaConGastos($this->scenario);

    $this->post('/invoices', [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'load_ids' => [$carga->id],
    ])->assertRedirect();

    $antes = DB::table('financial_snapshots')->where('load_id', $carga->id)->count();

    $id = gasto($this->scenario, 'fuel', 40000);
    $this->post("/expenses/{$id}/approve")
        ->assertRedirect()
        ->assertSessionHas('success', __('expenses.flash.decidedButFrozen'));

    // La instantánea es de solo añadir y nadie la reescribió.
    expect(DB::table('financial_snapshots')->where('load_id', $carga->id)->count())->toBe($antes);
    expect((int) DB::table('financial_snapshots')->where('load_id', $carga->id)
        ->value('approved_reimbursable_expenses_cents'))->toBe(0);
});

/* ── Estados ────────────────────────────────────────────────────────────── */

it('rechazar exige un motivo', function () {
    signIn($this->scenario, Role::Admin);
    $id = gasto($this->scenario, 'fuel', 10000);

    $this->post("/expenses/{$id}/reject", ['reason' => ''])->assertSessionHasErrors('reason');

    $this->post("/expenses/{$id}/reject", ['reason' => 'El recibo es de otra carga.'])
        ->assertRedirect();

    $e = DB::table('expenses')->where('id', $id)->first();
    expect($e->status)->toBe('rejected')
        ->and($e->rejection_reason)->toBe('El recibo es de otra carga.');
});

it('un gasto rechazado ya no se aprueba', function () {
    signIn($this->scenario, Role::Admin);
    $id = gasto($this->scenario, 'fuel', 10000);

    $this->post("/expenses/{$id}/reject", ['reason' => 'Duplicado del de ayer.'])->assertRedirect();
    $this->post("/expenses/{$id}/approve")->assertSessionHasErrors('status');

    expect(DB::table('expenses')->where('id', $id)->value('status'))->toBe('rejected');
});

it('no se reembolsa lo que nadie aprobó', function () {
    signIn($this->scenario, Role::Admin);
    $id = gasto($this->scenario, 'fuel', 10000);

    $this->post("/expenses/{$id}/reimburse")->assertSessionHasErrors('status');
});

/* ── Quién ve qué ───────────────────────────────────────────────────────── */

it('el transportista ve sus gastos y no los de otro', function () {
    signIn($this->scenario, Role::Admin);
    cargaEntregadaConGastos($this->scenario);
    gasto($this->scenario, 'fuel', 10000);
    // Uno de la carga del transportista que el escenario NO asigna.
    gasto($this->scenario, 'tolls', 5000, (string) $this->scenario->otherLoad->id);

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Carrier);

    $this->get('/expenses')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('expenses.data', 1));
});

it('el transportista no puede aprobar sus propios gastos', function () {
    signIn($this->scenario, Role::Admin);
    cargaEntregadaConGastos($this->scenario);
    $id = gasto($this->scenario, 'fuel', 10000);

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Carrier);

    // Ver bootstrap/app.php: una acción denegada vuelve atrás con el motivo.
    $this->post("/expenses/{$id}/approve")->assertRedirect()->assertSessionHas('error');

    expect(DB::table('expenses')->where('id', $id)->value('status'))->toBe('submitted');
});

it('no se le cuelga un gasto a una carga fuera del ámbito', function () {
    signIn($this->scenario, Role::Dispatcher);

    // El despachador del escenario lleva UN transportista. La otra carga es del
    // que no lleva: el formulario no se la ofrece, y la petición directa
    // tampoco vale.
    $this->post('/expenses', [
        'load_id' => $this->scenario->otherLoad->id,
        'category_id' => categoria($this->scenario, 'fuel')->id,
        'amount_cents' => 10000,
    ])->assertSessionHasErrors('load_id');

    expect(DB::table('expenses')->where('load_id', $this->scenario->otherLoad->id)->count())->toBe(0);
});

it('el desplegable de cargas del despachador solo trae las suyas', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/expenses/create')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('loads', 1));
});

it('el conductor llega al formulario en vez de a un 403', function () {
    signIn($this->scenario, Role::Driver);

    // Tiene `expense:submit` pero no `expense:read`: el menú le enseña la
    // entrada, así que el listado tiene que llevarle a algún sitio.
    $this->get('/expenses')->assertRedirect('/expenses/create');
});
