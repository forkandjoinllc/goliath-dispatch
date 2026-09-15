<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Finance\DefaultExpenseCategories;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * El conductor ve los gastos que presentó él. Los suyos, y ni uno más.
 *
 * El guardián de `tests/Unit/Suite/DriverExpenseTest.php` sujeta la estructura.
 * Esto mide las dos cosas que importan de un cambio de permisos: que ahora ve
 * lo suyo, y que sigue sin ver lo ajeno. La segunda es la que hay que
 * demostrar, porque ampliar un alcance es el error caro.
 */
function gastoPresentadoPor(Scenario $s, string $userId, string $estado = 'submitted', string $texto = 'Combustible en Laredo'): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $userId, $estado, $texto): string {
        DefaultExpenseCategories::ensureFor((string) $s->tenant->id);

        $categoria = (string) DB::table('expense_categories')
            ->where('tenant_id', $s->tenant->id)
            ->value('id');

        $id = (string) Str::uuid();

        DB::table('expenses')->insert([
            'id' => $id,
            'tenant_id' => $s->tenant->id,
            'load_id' => $s->load->id,
            'carrier_id' => $s->load->carrier_id,
            'category_id' => $categoria,
            'treatment_snapshot' => 'reimbursable_to_carrier',
            'requires_receipt_snapshot' => false,
            'amount_cents' => 9500,
            'description' => $texto,
            'status' => $estado,
            'submitted_by_user_id' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    });
}

/** @return list<object> */
function avisosDelDueno(Scenario $s, string $userId): array
{
    return app(TenantContext::class)->runAs($s->tenant->id, fn (): array => DB::table('notifications')
        ->where('user_id', $userId)
        ->where('event_key', 'expense.rejected')
        ->get(['id', 'body', 'locale'])
        ->all());
}

it('el conductor entra en gastos y ve el suyo, en vez de acabar en el formulario', function () {
    $conductor = $this->scenario->user(Role::Driver);
    gastoPresentadoPor($this->scenario, (string) $conductor->id);

    signIn($this->scenario, Role::Driver);

    // Antes esto era un 302 al formulario: entregar y no volver a saber nada.
    $this->get('/expenses')->assertOk()->assertInertia(fn ($page) => $page
        ->has('expenses.data', 1)
        ->where('expenses.data.0.description', 'Combustible en Laredo'));
});

it('no ve el gasto de otra persona', function () {
    $conductor = $this->scenario->user(Role::Driver);
    $despachador = $this->scenario->user(Role::Dispatcher);

    gastoPresentadoPor($this->scenario, (string) $conductor->id, texto: 'El mío');
    gastoPresentadoPor($this->scenario, (string) $despachador->id, texto: 'El de otro');

    signIn($this->scenario, Role::Driver);

    // La comprobación que de verdad importa: ampliar un alcance sin estrecharlo
    // es cómo se enseñan los gastos de toda la empresa a quien reparte gasóleo.
    $this->get('/expenses')->assertOk()->assertInertia(fn ($page) => $page
        ->has('expenses.data', 1)
        ->where('expenses.data.0.description', 'El mío'));
});

it('tampoco puede abrir el de otro por su enlace', function () {
    $despachador = $this->scenario->user(Role::Dispatcher);
    $ajeno = gastoPresentadoPor($this->scenario, (string) $despachador->id, texto: 'El de otro');

    signIn($this->scenario, Role::Driver);

    // El recibo de un gasto ajeno es un documento ajeno.
    $this->get("/expenses/{$ajeno}/receipt")->assertNotFound();
});

it('el conductor no puede decidir sobre su propio gasto', function () {
    $conductor = $this->scenario->user(Role::Driver);
    $mio = gastoPresentadoPor($this->scenario, (string) $conductor->id);

    signIn($this->scenario, Role::Driver);

    // Verlo no es aprobarlo. Si esto se cayera, el lote habría convertido una
    // ceguera en un agujero.
    //
    // Una ACCIÓN denegada vuelve atrás con el motivo, no da 403: lo decide
    // `bootstrap/app.php`, y el motivo es que quien pulsó un botón que no debía
    // estar ahí no tiene por qué perder la página. El 403 se reserva para las
    // páginas. Escribí `assertForbidden()` por costumbre y la prueba enseñó la
    // convención de la casa.
    $this->post("/expenses/{$mio}/approve")->assertRedirect()->assertSessionHas('error');

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($mio): void {
        expect(DB::table('expenses')->where('id', $mio)->value('status'))->toBe('submitted');
    });
});

it('al rechazarle el gasto se le avisa, con el motivo', function () {
    $conductor = $this->scenario->user(Role::Driver);
    $mio = gastoPresentadoPor($this->scenario, (string) $conductor->id);

    signIn($this->scenario, Role::Admin);

    $this->post("/expenses/{$mio}/reject", ['reason' => 'Ese tramo lo paga el cliente aparte.'])
        ->assertSessionHasNoErrors();

    $avisos = avisosDelDueno($this->scenario, (string) $conductor->id);

    expect($avisos)->not->toBe([], 'el conductor no se enteró de que le rechazaron el gasto');
    expect($avisos[0]->body)->toContain('lo paga el cliente aparte');
});

it('aprobar no le manda nada', function () {
    $conductor = $this->scenario->user(Role::Driver);
    $mio = gastoPresentadoPor($this->scenario, (string) $conductor->id);

    signIn($this->scenario, Role::Admin);

    $this->post("/expenses/{$mio}/approve")->assertSessionHasNoErrors();

    expect(avisosDelDueno($this->scenario, (string) $conductor->id))->toBe([]);
});

it('el aviso va solo a quien lo presentó', function () {
    $conductor = $this->scenario->user(Role::Driver);
    $despachador = $this->scenario->user(Role::Dispatcher);
    $mio = gastoPresentadoPor($this->scenario, (string) $conductor->id);

    signIn($this->scenario, Role::Admin);

    $this->post("/expenses/{$mio}/reject", ['reason' => 'Falta el recibo del peaje.'])
        ->assertSessionHasNoErrors();

    expect(avisosDelDueno($this->scenario, (string) $despachador->id))->toBe([]);
});

it('el aviso sale en el idioma de quien lo recibe', function () {
    $conductor = $this->scenario->user(Role::Driver);

    app(TenantContext::class)->withoutTenant(function () use ($conductor): void {
        DB::table('users')->where('id', $conductor->id)->update(['locale' => 'en']);
    });

    $mio = gastoPresentadoPor($this->scenario, (string) $conductor->id);

    signIn($this->scenario, Role::Admin);

    $this->post("/expenses/{$mio}/reject", ['reason' => 'Wrong load.'])->assertSessionHasNoErrors();

    $avisos = avisosDelDueno($this->scenario, (string) $conductor->id);

    expect($avisos)->not->toBe([]);
    expect($avisos[0]->locale)->toBe('en');
    expect($avisos[0]->body)->toContain('not approved');
});

it('el conductor puede apagar sus avisos, y solo los suyos', function () {
    signIn($this->scenario, Role::Driver);

    // Los dos del vencimiento entraron con el lote del aviso de caducidad: la
    // licencia y la tarjeta médica son SUYAS, y el formulario de subida ya le
    // prometía el aviso cuando no le llegaba por ningún camino. Ver
    // `docs/expiry-audience.md`. Sigue sin ver ni uno de la oficina.
    $this->get('/notifications')->assertOk()->assertInertia(fn ($page) => $page
        ->where('events', ['document.expiring', 'document.expired', 'expense.rejected']));
});

it('a un conductor suspendido no se le avisa', function () {
    $conductor = $this->scenario->user(Role::Driver);
    $mio = gastoPresentadoPor($this->scenario, (string) $conductor->id);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($conductor): void {
        DB::table('user_tenant_memberships')
            ->where('user_id', $conductor->id)
            ->update(['status' => 'suspended']);
    });

    signIn($this->scenario, Role::Admin);

    $this->post("/expenses/{$mio}/reject", ['reason' => 'Ya no trabaja aquí.'])
        ->assertSessionHasNoErrors();

    // Suspender a alguien es quitarle el acceso. Mandarle el correo de algo que
    // ya no puede abrir es la mitad peor de las dos. En el lote anterior esta
    // misma comprobación se me escapó en la otra vía y la enseñó un sabotaje;
    // aquí va escrita desde el principio... y el sabotaje volvió a enseñarla,
    // porque escribirla en una vía no la escribe en la otra.
    expect(avisosDelDueno($this->scenario, (string) $conductor->id))->toBe([]);
});
