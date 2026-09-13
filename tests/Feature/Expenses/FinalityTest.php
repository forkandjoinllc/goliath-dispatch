<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Finance\DefaultExpenseCategories;
use App\Support\Finance\ExpenseTransitions;
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
 * Decidir sobre un gasto no se deshace, y ahora la aplicación lo dice.
 *
 * ## El defecto
 *
 * Al rechazar un gasto ya aprobado se contestaba —en el diccionario— que un
 * administrador podía revertirlo. No hay administrador que pueda: `approve` y
 * `reject` solo aceptan `submitted`, `reimburse` solo `approved`, y no existe
 * ruta, acción ni permiso de vuelta. Y como un gasto aprobado entra en la base
 * de comisión, el clic equivocado se queda dentro del dinero mientras el
 * producto asegura que alguien lo deshace.
 *
 * Estas pruebas MIDEN esa imposibilidad rol por rol, incluido el
 * administrador, que es a quien mandaba el mensaje. El guardián de estructura
 * es `tests/Unit/Suite/ExpenseFinalityTest.php`.
 *
 * ## Lo que estas pruebas NO dicen
 *
 * Que esté bien que no haya vuelta. Puede que deba haberla —con su permiso, su
 * motivo obligatorio y su rastro—, y eso es una decisión de producto que sigue
 * abierta. Ver `docs/expense-finality.md`.
 */
function gastoFinalidad(Scenario $s, string $estado): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $estado): string {
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
            // Sin recibo obligatorio: lo que se mide aquí es la finalidad, no
            // la puerta del recibo, que tiene sus propias pruebas.
            'requires_receipt_snapshot' => false,
            'amount_cents' => 12500,
            'description' => 'Peaje',
            'status' => $estado,
            'submitted_by_user_id' => $s->user(Role::Admin)->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    });
}

function estadoFinalidad(Scenario $s, string $gasto): string
{
    return app(TenantContext::class)->runAs(
        $s->tenant->id,
        fn (): string => (string) DB::table('expenses')->where('id', $gasto)->value('status'),
    );
}

it('ningún rol devuelve un gasto aprobado, tampoco el administrador', function () {
    // El administrador va el PRIMERO a propósito: es a quien mandaba el
    // mensaje falso, y es el rol con el que cualquiera habría probado.
    foreach ([Role::Admin, Role::Accounting, Role::Dispatcher, Role::Carrier, Role::Driver] as $rol) {
        $gasto = gastoFinalidad($this->scenario, 'approved');

        signIn($this->scenario, $rol);

        // Las tres rutas que existen, incluidas las dos que serían la vuelta.
        $this->post("/expenses/{$gasto}/reject", ['reason' => 'Me equivoqué al aprobarlo']);
        $this->post("/expenses/{$gasto}/approve");

        expect(estadoFinalidad($this->scenario, $gasto))->toBe(
            'approved',
            "el rol {$rol->value} movió un gasto aprobado",
        );
    }
});

it('un gasto rechazado tampoco vuelve', function () {
    $gasto = gastoFinalidad($this->scenario, 'rejected');

    signIn($this->scenario, Role::Admin);

    $this->post("/expenses/{$gasto}/approve")->assertSessionHasErrors('status');

    expect(estadoFinalidad($this->scenario, $gasto))->toBe('rejected');
});

it('el mensaje dice lo que queda, y no promete una reversión', function () {
    $gasto = gastoFinalidad($this->scenario, 'approved');

    signIn($this->scenario, Role::Admin);

    $respuesta = $this->post("/expenses/{$gasto}/reject", ['reason' => 'Me equivoqué']);

    $respuesta->assertSessionHasErrors('status');

    $errores = session('errors')->getBag('default')->get('status');
    $mensaje = (string) ($errores[0] ?? '');

    // Un gasto aprobado SÍ tiene salida —a reembolsado—, así que el mensaje
    // honesto es el que la nombra. El falso mandaba a un administrador.
    expect($mensaje)->toBe(__('expenses.errors.onlyThese', [
        'status' => __('expenses.status.approved'),
        'options' => __('expenses.status.reimbursed'),
    ]));

    expect($mensaje)->not->toContain('administrador');
    expect($mensaje)->not->toContain('revert');

    // Y no es la frase antigua, que decía «recargue la página» —como si el
    // problema fuese una vista vieja y no que la decisión es permanente.
    expect($mensaje)->not->toContain('Recargue');
});

it('un gasto reembolsado dice que ahí se acabó', function () {
    $gasto = gastoFinalidad($this->scenario, 'reimbursed');

    signIn($this->scenario, Role::Admin);

    $this->post("/expenses/{$gasto}/reject", ['reason' => 'Tarde'])->assertSessionHasErrors('status');

    $mensaje = (string) (session('errors')->getBag('default')->get('status')[0] ?? '');

    expect($mensaje)->toBe(__('expenses.errors.noWayOut', [
        'status' => __('expenses.status.reimbursed'),
    ]));

    expect(ExpenseTransitions::esFinal('reimbursed'))->toBeTrue();
});

it('lo que la tabla sí permite sigue funcionando', function () {
    // Una puerta que se cierra de más deja el gasto atascado, que es el otro
    // modo de mentir: prometer un recorrido que tampoco se puede andar.
    $gasto = gastoFinalidad($this->scenario, 'submitted');

    signIn($this->scenario, Role::Admin);

    $this->post("/expenses/{$gasto}/approve")->assertSessionHasNoErrors();
    expect(estadoFinalidad($this->scenario, $gasto))->toBe('approved');

    $this->post("/expenses/{$gasto}/reimburse")->assertSessionHasNoErrors();
    expect(estadoFinalidad($this->scenario, $gasto))->toBe('reimbursed');
});
