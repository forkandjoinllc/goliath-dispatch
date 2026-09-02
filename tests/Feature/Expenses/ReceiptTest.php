<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Finance\DefaultExpenseCategories;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
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
 * Un gasto presentado sobre la carga del escenario.
 *
 * `$exigeRecibo` decide la copia CONGELADA, que es lo que mira la puerta — no
 * la categoría de hoy.
 */
function gastoDe(Scenario $s, bool $exigeRecibo): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $exigeRecibo): string {
        // El escenario no siembra categorías: se crean las de serie, que es lo
        // que hace la aplicación la primera vez que una empresa entra a gastos.
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
            'requires_receipt_snapshot' => $exigeRecibo,
            'amount_cents' => 12500,
            'description' => 'Peaje',
            'status' => 'submitted',
            'submitted_by_user_id' => $s->user(Role::Admin)->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    });
}

function reciboFalso(): UploadedFile
{
    return UploadedFile::fake()->create('recibo.pdf', 120, 'application/pdf');
}

it('un gasto que exige recibo no se aprueba sin él', function () {
    $gasto = gastoDe($this->scenario, exigeRecibo: true);

    signIn($this->scenario, Role::Admin);

    // Lo que se rebota al cliente o se descuenta de la liquidación no se firma
    // sin papel.
    $this->post("/expenses/{$gasto}/approve")
        ->assertSessionHasErrors('status');

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($gasto): void {
        expect(DB::table('expenses')->where('id', $gasto)->value('status'))->toBe('submitted');
    });
});

it('con recibo sí se aprueba', function () {
    $gasto = gastoDe($this->scenario, exigeRecibo: true);

    signIn($this->scenario, Role::Admin);

    $this->post("/expenses/{$gasto}/receipt", ['file' => reciboFalso()])
        ->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($gasto): void {
        // La columna que existía desde el primer día y no escribía nadie.
        expect(DB::table('expenses')->where('id', $gasto)->value('receipt_document_id'))->not->toBeNull();
    });

    $this->post("/expenses/{$gasto}/approve")->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($gasto): void {
        expect(DB::table('expenses')->where('id', $gasto)->value('status'))->toBe('approved');
    });
});

it('un gasto que no exige recibo se aprueba sin él', function () {
    $gasto = gastoDe($this->scenario, exigeRecibo: false);

    signIn($this->scenario, Role::Admin);

    // La mayoría de los gastos no exigen recibo, y eso tiene que seguir siendo
    // igual de rápido que antes.
    $this->post("/expenses/{$gasto}/approve")->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($gasto): void {
        expect(DB::table('expenses')->where('id', $gasto)->value('status'))->toBe('approved');
    });
});

it('un gasto sin recibo sí se puede rechazar', function () {
    $gasto = gastoDe($this->scenario, exigeRecibo: true);

    signIn($this->scenario, Role::Admin);

    // Es exactamente lo que hay que hacer con él. Una puerta que también
    // cerrara el rechazo dejaría el gasto atascado para siempre.
    $this->post("/expenses/{$gasto}/reject", ['reason' => 'Sin recibo'])
        ->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($gasto): void {
        expect(DB::table('expenses')->where('id', $gasto)->value('status'))->toBe('rejected');
    });
});

it('sustituir el recibo deja uno solo vivo', function () {
    $gasto = gastoDe($this->scenario, exigeRecibo: true);

    signIn($this->scenario, Role::Admin);

    $this->post("/expenses/{$gasto}/receipt", ['file' => reciboFalso()])->assertSessionHasNoErrors();
    $this->post("/expenses/{$gasto}/receipt", ['file' => reciboFalso()])->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($gasto): void {
        // Un gasto tiene UN recibo. El anterior se borra en suave: alguien pudo
        // haberlo visto antes de decidir.
        expect(DB::table('documents')->where('owner_id', $gasto)->whereNull('deleted_at')->count())->toBe(1)
            ->and(DB::table('documents')->where('owner_id', $gasto)->whereNotNull('deleted_at')->count())->toBe(1);
    });
});

it('quitar el recibo no desaprueba lo ya aprobado', function () {
    $gasto = gastoDe($this->scenario, exigeRecibo: true);

    signIn($this->scenario, Role::Admin);

    $this->post("/expenses/{$gasto}/receipt", ['file' => reciboFalso()]);
    $this->post("/expenses/{$gasto}/approve")->assertSessionHasNoErrors();
    $this->delete("/expenses/{$gasto}/receipt")->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($gasto): void {
        // Reescribir una decisión que alguien tomó con el papel delante sería
        // peor que dejar constancia de que el papel ya no está.
        expect(DB::table('expenses')->where('id', $gasto)->value('status'))->toBe('approved')
            ->and(DB::table('expenses')->where('id', $gasto)->value('receipt_document_id'))->toBeNull();
    });
});

it('no se puede colgar un recibo en el gasto de otra empresa', function () {
    $otra = Scenario::create();
    $ajeno = gastoDe($otra, exigeRecibo: true);

    signIn($this->scenario, Role::Admin);

    // El estrechamiento por ámbito es lo que lo impide, no el formulario.
    $this->post("/expenses/{$ajeno}/receipt", ['file' => reciboFalso()])
        ->assertNotFound();

    app(TenantContext::class)->runAs($otra->tenant->id, function () use ($ajeno): void {
        expect(DB::table('expenses')->where('id', $ajeno)->value('receipt_document_id'))->toBeNull();
    });
});

it('un fichero que no es recibo no entra', function () {
    $gasto = gastoDe($this->scenario, exigeRecibo: true);

    signIn($this->scenario, Role::Admin);

    // Por MIME real y no por la extensión del nombre.
    $this->post("/expenses/{$gasto}/receipt", [
        'file' => UploadedFile::fake()->create('recibo.pdf', 10, 'application/zip'),
    ])->assertSessionHasErrors('file');
});
