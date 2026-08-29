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
 * Las tarjetas del panel, indexadas por clave.
 *
 * @return array<string, array<string, mixed>>
 */
function tarjetasDelPanel(): array
{
    $salida = [];

    test()->get('/home')->assertOk()->assertInertia(function (Assert $page) use (&$salida) {
        foreach ($page->toArray()['props']['cards'] as $tarjeta) {
            $salida[$tarjeta['key']] = $tarjeta;
        }
    });

    return $salida;
}

/** Deja la carga del escenario entregada y sin facturar. */
function entregadaSinFacturar(Scenario $scenario): void
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
}

/* ── Lo que ve cada rol ─────────────────────────────────────────────────── */

it('el administrador ve las tarjetas de las cuatro áreas', function () {
    signIn($this->scenario, Role::Admin);

    $tarjetas = tarjetasDelPanel();

    expect(array_keys($tarjetas))->toContain(
        'loadsAvailable', 'documentsExpiring', 'invoicesOverdue', 'leadsUnassigned',
    );

    $grupos = array_values(array_unique(array_column($tarjetas, 'group')));
    sort($grupos);

    expect($grupos)->toBe(['commercial', 'compliance', 'finance', 'operations']);
});

it('al conductor solo le salen las tarjetas que su rol alcanza', function () {
    signIn($this->scenario, Role::Driver);

    $tarjetas = tarjetasDelPanel();

    // Un conductor tiene `load:read` con alcance propio y nada de dinero ni de
    // comercial. Que le llegara aunque fuese el CERO de facturas vencidas ya
    // sería contarle que existen facturas.
    expect($tarjetas)->not->toHaveKey('invoicesOverdue');
    expect($tarjetas)->not->toHaveKey('leadsUnassigned');
    expect($tarjetas)->not->toHaveKey('settlementsDraft');
});

it('al despachador no le sale la de facturar, porque no puede facturar', function () {
    signIn($this->scenario, Role::Dispatcher);

    // La tarjeta de «entregadas y sin facturar» pide además `invoice:create`:
    // enseñar «hay dinero sin cobrar» y que el enlace conteste 403 es peor que
    // no enseñarlo.
    expect(tarjetasDelPanel())->not->toHaveKey('loadsUninvoiced');
});

it('cada tarjeta lleva su enlace', function () {
    signIn($this->scenario, Role::Admin);

    foreach (tarjetasDelPanel() as $clave => $tarjeta) {
        expect($tarjeta['href'])->toStartWith('/', "La tarjeta {$clave} no lleva enlace");
        expect($tarjeta['count'])->toBeInt();
    }
});

/* ── Que las cifras sean las de verdad ──────────────────────────────────── */

it('cuenta las cargas entregadas y sin facturar', function () {
    entregadaSinFacturar($this->scenario);

    signIn($this->scenario, Role::Admin);

    expect(tarjetasDelPanel()['loadsUninvoiced']['count'])->toBe(1);

    // Al facturarla deja de contar. Es la misma regla que usa el alta de
    // facturas: si las dos no coincidieran, el panel diría que hay una y la
    // pantalla de alta no ofrecería ninguna.
    $this->post('/invoices', [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'load_ids' => [$this->scenario->load->id],
        'payment_terms_days' => 15,
    ])->assertRedirect()->assertSessionHasNoErrors();

    expect(tarjetasDelPanel()['loadsUninvoiced']['count'])->toBe(0);
});

it('cuenta como vencida una factura pasada de fecha aunque su estado no lo diga', function () {
    entregadaSinFacturar($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post('/invoices', [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'load_ids' => [$this->scenario->load->id],
        'payment_terms_days' => 15,
    ])->assertRedirect()->assertSessionHasNoErrors();

    $id = (string) DB::table('invoices')->orderByDesc('created_at')->value('id');
    $this->post("/invoices/{$id}/send")->assertRedirect()->assertSessionHasNoErrors();

    // Se le pone fecha pasada SIN tocar el estado, que es exactamente lo que
    // ocurre en producción: `invoices.status` solo pasa a `overdue` cuando
    // PaymentLedger corre, y eso solo pasa al anotar un cobro. Una factura que
    // cruza su vencimiento sin que nadie la toque se queda en `sent`.
    DB::table('invoices')->where('id', $id)->update(['due_date' => now()->subDays(10)]);

    expect(DB::table('invoices')->where('id', $id)->value('status'))->toBe('sent');
    expect(tarjetasDelPanel()['invoicesOverdue']['count'])->toBe(1);
});

it('la pantalla de facturas sabe filtrar por vencidas', function () {
    entregadaSinFacturar($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post('/invoices', [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'load_ids' => [$this->scenario->load->id],
        'payment_terms_days' => 15,
    ])->assertRedirect()->assertSessionHasNoErrors();

    $id = (string) DB::table('invoices')->orderByDesc('created_at')->value('id');
    $this->post("/invoices/{$id}/send")->assertRedirect();

    // Sin el filtro, la tarjeta del panel llevaría a una lista que no enseña lo
    // que la tarjeta contó.
    $this->get('/invoices?overdue=1')->assertInertia(function (Assert $page) {
        expect($page->toArray()['props']['invoices']['data'])->toBeEmpty();
    });

    DB::table('invoices')->where('id', $id)->update(['due_date' => now()->subDays(10)]);

    $this->get('/invoices?overdue=1')->assertInertia(function (Assert $page) use ($id) {
        $ids = collect($page->toArray()['props']['invoices']['data'])->pluck('id')->all();

        expect($ids)->toContain($id);
    });
});

it('cuenta los documentos dentro del plazo de aviso de la empresa', function () {
    // El plazo por defecto es de 30 días. Uno a 10 días cuenta; uno a 200, no.
    foreach ([10, 200] as $dias) {
        DB::table('documents')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'document_type' => 'certificate_of_insurance',
            'owner_type' => 'carrier',
            'owner_id' => $this->scenario->assignedCarrier->id,
            'title' => "Caduca en {$dias} días",
            'review_status' => 'approved',
            'expiration_date' => now()->addDays($dias)->toDateString(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    signIn($this->scenario, Role::Admin);

    expect(tarjetasDelPanel()['documentsExpiring']['count'])->toBe(1);
});

it('cuenta los gastos presentados', function () {
    entregadaSinFacturar($this->scenario);

    signIn($this->scenario, Role::Admin);

    $antes = tarjetasDelPanel()['expensesPending']['count'];

    // El gasto se da de alta por la RUTA, no metiendo una fila: así la
    // categoría, el tratamiento congelado y el estado inicial son los que pone
    // la aplicación, no los que yo suponga.
    \App\Support\Finance\DefaultExpenseCategories::ensureFor($this->scenario->tenant->id);

    $categoria = DB::table('expense_categories')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->first(['id', 'code']);

    expect($categoria)->not->toBeNull();

    $this->post('/expenses', [
        'load_id' => $this->scenario->load->id,
        'category_id' => $categoria->id,
        'amount_cents' => 12500,
        'description' => 'Peaje de la autopista',
        'incurred_on' => now()->toDateString(),
    ])->assertRedirect()->assertSessionHasNoErrors();

    expect(tarjetasDelPanel()['expensesPending']['count'])->toBe($antes + 1);
});

it('cuenta los prospectos sin responsable, y no los ya cerrados', function () {
    foreach ([['new', null], ['lost', null], ['new', $this->scenario->user(Role::Admin)->id]] as [$estado, $responsable]) {
        DB::table('leads')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'first_name' => 'Ana',
            'last_name' => 'Ruiz',
            'email' => Str::random(8).'@ejemplo.test',
            'locale' => 'es',
            'source' => 'contact_form',
            'status' => $estado,
            'assigned_to_user_id' => $responsable,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    signIn($this->scenario, Role::Admin);

    // Solo el primero: el perdido está cerrado y el tercero tiene dueño.
    expect(tarjetasDelPanel()['leadsUnassigned']['count'])->toBe(1);
});

/* ── La frontera de empresa y el alcance ────────────────────────────────── */

it('no cuenta nada de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    // Prospecto y carga entregada en la OTRA empresa.
    DB::table('leads')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $otra->tenant->id,
        'first_name' => 'Ajena',
        'last_name' => 'Ajena',
        'email' => Str::random(8).'@ajena.test',
        'locale' => 'es',
        'source' => 'contact_form',
        'status' => 'new',
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    entregadaSinFacturar($otra);

    signIn($this->scenario, Role::Admin);

    $tarjetas = tarjetasDelPanel();

    expect($tarjetas['leadsUnassigned']['count'])->toBe(0);
    expect($tarjetas['loadsUninvoiced']['count'])->toBe(0);
});

it('el despachador cuenta solo las cargas que lleva', function () {
    // El escenario le asigna UNO de los dos transportistas a propósito.
    DB::table('loads')->whereIn('id', [$this->scenario->load->id, $this->scenario->otherLoad->id])
        ->update(['status' => 'available', 'updated_at' => now()]);

    signIn($this->scenario, Role::Admin);
    $delAdmin = tarjetasDelPanel()['loadsAvailable']['count'];

    signIn($this->scenario, Role::Dispatcher);
    $delDespachador = tarjetasDelPanel()['loadsAvailable']['count'];

    // Si el panel contara por su cuenta en vez de usar LoadScope, el
    // despachador vería en el número las cargas que la lista le esconde — una
    // fuga de información con forma de dígito.
    expect($delAdmin)->toBeGreaterThan($delDespachador);
    expect($delDespachador)->toBe(1);
});

it('el despachador ve sus comisiones y no las de sus compañeros', function () {
    // Las comisiones NO se meten a mano: `financial_snapshot_id` es obligatorio
    // y lo pone el devengo al facturar. Se factura de verdad y luego se clona
    // la fila para un segundo despachador, reutilizando esa misma instantánea.
    entregadaSinFacturar($this->scenario);

    DB::table('loads')->where('id', $this->scenario->load->id)->update([
        'dispatcher_user_id' => $this->scenario->user(Role::Dispatcher)->id,
        'dispatcher_commission_bps' => 2000,
        'dispatcher_commission_basis' => 'dispatch_fee_amount',
    ]);

    signIn($this->scenario, Role::Admin);

    $this->post('/invoices', [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'load_ids' => [$this->scenario->load->id],
        'payment_terms_days' => 15,
    ])->assertRedirect()->assertSessionHasNoErrors();

    $suya = DB::table('dispatcher_commissions')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('dispatcher_user_id', $this->scenario->user(Role::Dispatcher)->id)
        ->first();

    expect($suya)->not->toBeNull('El devengo no creó la comisión del despachador');

    DB::table('dispatcher_commissions')->insert([
        ...(array) $suya,
        'id' => (string) Str::uuid(),
        'dispatcher_user_id' => $this->scenario->user(Role::Accounting)->id,
    ]);

    signIn($this->scenario, Role::Dispatcher);

    expect(tarjetasDelPanel()['commissionsAccrued']['count'])->toBe(1);

    signIn($this->scenario, Role::Admin);

    expect(tarjetasDelPanel()['commissionsAccrued']['count'])->toBe(2);
});

/* ── Lo que no se ha perdido por el camino ──────────────────────────────── */

it('sigue enseñando la matriz de permisos', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/home')->assertInertia(function (Assert $page) {
        $props = $page->toArray()['props'];

        expect($props['permissions'])->not->toBeEmpty();
        expect($props['totals']['catalog'])->toBeGreaterThan(50);
    });
});
