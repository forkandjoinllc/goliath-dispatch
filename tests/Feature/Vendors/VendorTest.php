<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Finance\DefaultExpenseCategories;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\FleetFixtures;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    // `expenses.category_id` es NOT NULL y las categorías no nacen con la
    // empresa: hay que pedirlas.
    DefaultExpenseCategories::ensureFor((string) $this->scenario->tenant->id);
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Los proveedores: la ficha de quien le cobra a un transportista.
 *
 * Lo que aquí se mide es lo que la pantalla AFIRMA: que el identificador
 * fiscal no vuelve nunca, que editar sin tocarlo no lo borra, que un
 * transportista solo ve los proveedores que le sirven a él, que un proveedor
 * con unidades o gastos detrás no se retira, y que «lo que nos arrienda» sale
 * de las unidades que APUNTAN a la ficha y no de un nombre parecido.
 */
function proveedor(Scenario $s, array $extra = []): string
{
    $id = (string) Str::uuid();

    DB::table('vendors')->insert([
        'id' => $id,
        'tenant_id' => (string) $s->tenant->id,
        'company_name' => $extra['company_name'] ?? 'Bravo Fleet Leasing, LLC',
        'company_name_normalized' => $extra['company_name_normalized'] ?? 'bravo fleet leasing llc',
        'vendor_type' => $extra['vendor_type'] ?? 'leasing',
        'status' => $extra['status'] ?? 'active',
        'payment_terms_days' => $extra['payment_terms_days'] ?? 30,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

function sirveA(Scenario $s, string $vendorId, string $carrierId): void
{
    DB::table('vendor_carriers')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => (string) $s->tenant->id,
        'vendor_id' => $vendorId,
        'carrier_id' => $carrierId,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

function pagina(string $url): array
{
    /** @var Assert $p */
    $p = null;

    test()->get($url)->assertOk()->assertInertia(function (Assert $x) use (&$p): void {
        $p = $x;
    });

    return $p->toArray()['props'];
}

/* ── El alta ────────────────────────────────────────────────────────────── */

it('da de alta un proveedor con su contacto y a quién sirve', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/vendors', [
        'company_name' => 'Taller Diésel del Golfo',
        'vendor_type' => 'maintenance',
        'phone' => '+1 713 555 0210',
        'email' => 'ordenes@tallerdelgolfo.test',
        'payment_terms_days' => 15,
        'carrier_ids' => [(string) $this->scenario->assignedCarrier->id],
        'contacts' => [
            ['first_name' => 'Hilda', 'last_name' => 'Vargas', 'position' => 'Jefa de taller'],
        ],
    ])->assertRedirect();

    $v = DB::table('vendors')->where('company_name', 'Taller Diésel del Golfo')->first();

    expect($v)->not->toBeNull();
    expect($v->vendor_type)->toBe('maintenance');
    // Normalizado al guardar: si no, «Taller Diesel» y «Taller Diésel» serían
    // dos fichas y la mitad de las facturas iría a cada una.
    expect($v->company_name_normalized)->not->toBe('Taller Diésel del Golfo');

    expect(DB::table('vendor_contacts')->where('vendor_id', $v->id)->count())->toBe(1);
    // El primero de la lista es el principal, siempre. La base tiene un único
    // que no admite dos vivos a la vez.
    expect((bool) DB::table('vendor_contacts')->where('vendor_id', $v->id)->value('is_primary'))->toBeTrue();
    expect(DB::table('vendor_carriers')->where('vendor_id', $v->id)->count())->toBe(1);
});

it('un tipo que no existe no se guarda', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/vendors', ['company_name' => 'Lo que sea', 'vendor_type' => 'astronautica'])
        ->assertSessionHasErrors('vendor_type');
});

it('no se ata a un transportista de otra empresa', function () {
    signIn($this->scenario, Role::Admin);

    $otra = Scenario::create();
    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Admin);

    $this->post('/vendors', [
        'company_name' => 'Arrendadora Ajena',
        'vendor_type' => 'leasing',
        'carrier_ids' => [(string) $otra->assignedCarrier->id],
    ])->assertRedirect();

    $v = DB::table('vendors')->where('company_name', 'Arrendadora Ajena')->first(['id']);

    // El id pasa `size:36`: el ámbito global impide LEER al transportista
    // ajeno, no impide escribir esta fila. Sin la comprobación, la ficha diría
    // que sirve a una empresa que no es de nadie aquí.
    expect(DB::table('vendor_carriers')->where('vendor_id', $v->id)->count())->toBe(0);
});

/* ── El identificador fiscal ────────────────────────────────────────────── */

it('el identificador fiscal se guarda cifrado y solo vuelven los cuatro últimos', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/vendors', [
        'company_name' => 'Con EIN',
        'vendor_type' => 'insurance',
        'tax_id' => '99-1234567',
        'contacts' => [],
    ])->assertRedirect();

    $v = DB::table('vendors')->where('company_name', 'Con EIN')->first();

    // En la base NO está en claro.
    expect($v->tax_id_encrypted)->not->toBe('99-1234567');
    expect(Crypt::decryptString($v->tax_id_encrypted))->toBe('99-1234567');
    expect($v->tax_id_last4)->toBe('4567');

    // Y a la pantalla solo viajan los cuatro últimos.
    $props = pagina('/vendors/'.$v->id);

    expect($props['vendor'])->not->toHaveKey('taxId');
    expect($props['vendor']['taxIdLast4'])->toBe('4567');
    expect(json_encode($props))->not->toContain('99-1234567');
});

it('editar sin tocar el identificador fiscal no lo borra', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/vendors', [
        'company_name' => 'Con EIN',
        'vendor_type' => 'insurance',
        'tax_id' => '99-1234567',
    ])->assertRedirect();

    $id = (string) DB::table('vendors')->where('company_name', 'Con EIN')->value('id');

    // La pantalla no lo puede devolver —no se enseña nunca— así que tratar su
    // ausencia como «bórralo» haría que cambiar el teléfono borrara el EIN.
    $this->patch('/vendors/'.$id, [
        'company_name' => 'Con EIN',
        'vendor_type' => 'insurance',
        'phone' => '+1 555 0100',
    ])->assertRedirect();

    expect(DB::table('vendors')->where('id', $id)->value('tax_id_last4'))->toBe('4567');

    // Y una cadena vacía SÍ lo borra: es cómo se quita.
    $this->patch('/vendors/'.$id, [
        'company_name' => 'Con EIN',
        'vendor_type' => 'insurance',
        'tax_id' => '',
    ])->assertRedirect();

    expect(DB::table('vendors')->where('id', $id)->value('tax_id_last4'))->toBeNull();
});

/* ── El W-9 ─────────────────────────────────────────────────────────────── */

it('sin W-9 no se guarda la fecha de recepción', function () {
    signIn($this->scenario, Role::Admin);

    // «No tenemos su W-9, recibido el 3 de marzo» es una fila que se lee de dos
    // formas y ninguna es verdad. La base tiene la misma regla.
    $this->post('/vendors', [
        'company_name' => 'Sin W9',
        'vendor_type' => 'fuel',
        'w9_on_file' => false,
        'w9_received_on' => '2026-03-03',
    ])->assertRedirect();

    $v = DB::table('vendors')->where('company_name', 'Sin W9')->first();

    expect((bool) $v->w9_on_file)->toBeFalse();
    expect($v->w9_received_on)->toBeNull();
});

/* ── El alcance ─────────────────────────────────────────────────────────── */

it('un transportista solo ve los proveedores que le sirven a él', function () {
    $suyo = proveedor($this->scenario, ['company_name' => 'El suyo', 'company_name_normalized' => 'el suyo']);
    $ajeno = proveedor($this->scenario, ['company_name' => 'El del otro', 'company_name_normalized' => 'el del otro']);

    sirveA($this->scenario, $suyo, (string) $this->scenario->assignedCarrier->id);
    sirveA($this->scenario, $ajeno, (string) $this->scenario->otherCarrier->id);

    signIn($this->scenario, Role::Carrier);

    // La lista de proveedores de una empresa de despacho es la lista de con
    // quién trabaja toda su flota: un transportista no se lleva de paso los
    // talleres de sus competidores.
    $ids = collect(pagina('/vendors')['vendors']['data'])->pluck('id');

    expect($ids)->toContain($suyo);
    expect($ids)->not->toContain($ajeno);
});

it('un proveedor fuera de alcance da 404 y no 403', function () {
    $ajeno = proveedor($this->scenario, ['company_name' => 'El del otro', 'company_name_normalized' => 'el del otro']);
    sirveA($this->scenario, $ajeno, (string) $this->scenario->otherCarrier->id);

    signIn($this->scenario, Role::Carrier);

    // Un 403 confirmaría que ese proveedor existe en esta empresa, y con eso
    // se enumeran las fichas de una en una.
    $this->get('/vendors/'.$ajeno)->assertNotFound();
});

it('contabilidad da de alta proveedores pero no los retira', function () {
    signIn($this->scenario, Role::Accounting);

    $this->post('/vendors', ['company_name' => 'De contabilidad', 'vendor_type' => 'fuel'])
        ->assertRedirect();

    $id = (string) DB::table('vendors')->where('company_name', 'De contabilidad')->value('id');

    // Se mide el EFECTO y no el código: la aplicación contesta a un permiso
    // denegado con una redirección a una pantalla que lo explica, no con un
    // 403 pelado. Lo que importa es que el proveedor sigue ahí.
    $this->delete('/vendors/'.$id);

    expect(DB::table('vendors')->where('id', $id)->whereNull('deleted_at')->exists())->toBeTrue();
});

/* ── Lo que arrienda, y lo que impide retirarlo ─────────────────────────── */

it('la ficha enseña las unidades que APUNTAN a ella', function () {
    signIn($this->scenario, Role::Admin);

    $v = proveedor($this->scenario);
    $camion = FleetFixtures::camion($this->scenario, 'C-900');

    DB::table('trucks')->where('id', $camion)->update([
        'ownership' => 'leased',
        'lessor_name' => 'Bravo Fleet Leasing, LLC',
        'lessor_vendor_id' => $v,
        'lease_ends_on' => now()->addYear()->toDateString(),
    ]);

    // Otra unidad con el MISMO nombre tecleado y SIN ficha: es el estado en el
    // que está cualquier flota el día que estrena esta pantalla, y la lista
    // tiene que dejarla fuera. Sin esta mitad, «enseña las que apuntan» lo
    // cumpliría igual de bien una lista que busca por nombre.
    $suelto = FleetFixtures::camion($this->scenario, 'C-901');
    DB::table('trucks')->where('id', $suelto)->update([
        'ownership' => 'leased',
        'lessor_name' => 'Bravo Fleet Leasing, LLC',
    ]);

    $arrendadas = collect(pagina('/vendors/'.$v)['leased'])->pluck('unitNumber');

    expect($arrendadas)->toContain('C-900');
    expect($arrendadas)->not->toContain('C-901');
});

it('no se retira un proveedor con unidades apuntando a él', function () {
    signIn($this->scenario, Role::Admin);

    $v = proveedor($this->scenario);
    $camion = FleetFixtures::camion($this->scenario, 'C-900');
    DB::table('trucks')->where('id', $camion)->update(['lessor_vendor_id' => $v]);

    $this->delete('/vendors/'.$v)->assertRedirect();

    // Sigue vivo: la unidad se habría quedado con un arrendador que no existe.
    expect(DB::table('vendors')->where('id', $v)->whereNull('deleted_at')->exists())->toBeTrue();

    // Y sin nada apuntando, sí se retira — sin esta mitad, «no se retira» lo
    // cumpliría un botón que no hace nada nunca.
    DB::table('trucks')->where('id', $camion)->update(['lessor_vendor_id' => null]);

    $this->delete('/vendors/'.$v)->assertRedirect();

    expect(DB::table('vendors')->where('id', $v)->whereNull('deleted_at')->exists())->toBeFalse();
});

it('no se retira un proveedor con gastos imputados', function () {
    signIn($this->scenario, Role::Admin);

    $v = proveedor($this->scenario);

    DB::table('expenses')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => (string) $this->scenario->tenant->id,
        'load_id' => (string) $this->scenario->load->id,
        'carrier_id' => (string) $this->scenario->assignedCarrier->id,
        'vendor_id' => $v,
        'category_id' => (string) DB::table('expense_categories')
            ->where('tenant_id', $this->scenario->tenant->id)
            ->value('id'),
        'treatment_snapshot' => 'reimbursable_to_carrier',
        'amount_cents' => 45000,
        'status' => 'submitted',
        'submitted_by_user_id' => (string) $this->scenario->user(Role::Admin)->id,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $this->delete('/vendors/'.$v)->assertRedirect();

    // Un gasto cuyo proveedor desapareció es un gasto que ya no se puede
    // explicar.
    expect(DB::table('vendors')->where('id', $v)->whereNull('deleted_at')->exists())->toBeTrue();
});

/* ── La unidad apunta a la ficha ────────────────────────────────────────── */

it('la unidad no se ata a un proveedor de otra empresa', function () {
    signIn($this->scenario, Role::Admin);

    $otra = Scenario::create();
    app(TenantContext::class)->forget();
    $ajeno = proveedor($otra, ['company_name' => 'Ajena', 'company_name_normalized' => 'ajena']);

    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'C-900');

    $fila = DB::table('trucks')->where('id', $camion)->first(['vin', 'equipment_type_id']);

    $this->patch('/equipment/trucks/'.$camion, [
        'carrier_id' => (string) $this->scenario->assignedCarrier->id,
        'unit_number' => 'C-900',
        'vin' => $fila->vin,
        'equipment_type_id' => $fila->equipment_type_id,
        'ownership' => 'leased',
        'lessor_vendor_id' => $ajeno,
    ])->assertSessionHasErrors('lessor_vendor_id');
});

it('pasar la unidad a propia suelta el proveedor y el nombre', function () {
    signIn($this->scenario, Role::Admin);

    $v = proveedor($this->scenario);
    $camion = FleetFixtures::camion($this->scenario, 'C-900');

    DB::table('trucks')->where('id', $camion)->update([
        'ownership' => 'leased',
        'lessor_name' => 'Bravo Fleet Leasing, LLC',
        'lessor_vendor_id' => $v,
    ]);

    // El guardado del equipo NO es un parche: reescribe la ficha con lo que le
    // llega, así que la prueba manda lo que la pantalla manda.
    $fila = DB::table('trucks')->where('id', $camion)->first(['vin', 'equipment_type_id']);

    // Es la regla que ya existía para el nombre, extendida a la ficha: en una
    // unidad propia no hay arrendador, y dejar el enlace puesto dejaría un
    // dato que contradice al de al lado.
    /*
     * Y se manda el arrendador PUESTO, que es lo que hace el formulario de
     * verdad: la pantalla cambia el desplegable de propiedad y las dos
     * casillas del arrendador siguen con lo que había en el estado. Sin
     * mandarlo, la prueba pasaba con y sin la regla —el valor llegaba nulo de
     * todas formas— y no medía nada.
     */
    $this->patch('/equipment/trucks/'.$camion, [
        'carrier_id' => (string) $this->scenario->assignedCarrier->id,
        'unit_number' => 'C-900',
        'vin' => $fila->vin,
        'equipment_type_id' => $fila->equipment_type_id,
        'ownership' => 'owned',
        'lessor_name' => 'Bravo Fleet Leasing, LLC',
        'lessor_vendor_id' => $v,
    ])->assertRedirect();

    $t = DB::table('trucks')->where('id', $camion)->first(['lessor_name', 'lessor_vendor_id']);

    expect($t->lessor_name)->toBeNull();
    expect($t->lessor_vendor_id)->toBeNull();
});

/* ── El gasto apunta al proveedor ───────────────────────────────────────── */

it('un gasto puede imputarse a un proveedor de esta empresa', function () {
    signIn($this->scenario, Role::Admin);

    $v = proveedor($this->scenario, ['vendor_type' => 'maintenance']);

    $this->post('/expenses', [
        'load_id' => (string) $this->scenario->load->id,
        'category_id' => (string) DB::table('expense_categories')
            ->where('tenant_id', $this->scenario->tenant->id)
            ->value('id'),
        'amount_cents' => 45000,
        'vendor_id' => $v,
    ])->assertRedirect();

    expect(DB::table('expenses')->where('vendor_id', $v)->count())->toBe(1);
});

it('un gasto no se imputa a un proveedor de otra empresa', function () {
    signIn($this->scenario, Role::Admin);

    $otra = Scenario::create();
    app(TenantContext::class)->forget();
    $ajeno = proveedor($otra, ['company_name' => 'Ajena', 'company_name_normalized' => 'ajena']);

    signIn($this->scenario, Role::Admin);

    $this->post('/expenses', [
        'load_id' => (string) $this->scenario->load->id,
        'category_id' => (string) DB::table('expense_categories')
            ->where('tenant_id', $this->scenario->tenant->id)
            ->value('id'),
        'amount_cents' => 45000,
        'vendor_id' => $ajeno,
    ])->assertSessionHasErrors('vendor_id');
});
