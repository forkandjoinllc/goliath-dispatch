<?php

declare(strict_types=1);

use App\Enums\Role;
use Illuminate\Support\Collection;
use App\Support\Screens\Reachable;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Support\Scenario;

/**
 * Las pantallas ofrecen los estados que pueden encontrar, y solo esos.
 *
 * Comisiones ofrecía «Aprobado» y «Anulado», mensajes ofrecía «Directo» y
 * «Aviso general», facturas `due` e `uncollectable`, cobros `processing` y
 * `cancelled`. Ocho opciones que devuelven siempre cero porque nada las
 * escribe.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

it('la pantalla de comisiones ofrece dos estados, no cuatro', function (): void {
    signIn($this->scenario, Role::Admin);

    $this->get('/commissions')->assertInertia(fn ($page) => $page
        ->where('statuses', ['accrued', 'paid']));
});

it('la pantalla de mensajes no ofrece clases de hilo que no existen', function (): void {
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/messages')->assertInertia(fn ($page) => $page
        ->where('kinds', ['load']));
});

it('facturas y cobros tampoco ofrecen los suyos', function (): void {
    signIn($this->scenario, Role::Admin);

    $this->get('/invoices')->assertInertia(fn ($page) => $page
        ->where('statuses', fn ($s) => ! collect($s)->contains('due') && ! collect($s)->contains('uncollectable')));

    $this->get('/payments')->assertInertia(fn ($page) => $page
        ->where('statuses', fn ($s) => ! collect($s)->contains('processing') && ! collect($s)->contains('cancelled')));
});

it('gastos y liquidaciones siguen ofreciéndolo todo', function (): void {
    // El contraste que demuestra que esto mide algo: dos listas donde TODO es
    // alcanzable no pierden ninguna opción.
    signIn($this->scenario, Role::Admin);

    $this->get('/expenses')->assertInertia(fn ($page) => $page
        ->where('statuses', ['submitted', 'approved', 'rejected', 'reimbursed']));

    $this->get('/settlements')->assertInertia(fn ($page) => $page
        ->where('statuses', ['draft', 'issued', 'paid', 'voided']));
});

it('pedir un estado imposible por la URL no filtra a escondidas', function (): void {
    // Lo que NO debe pasar: que `?status=cancelled` se cuele en el `where` y
    // deje la lista vacía. Se ignora, como cualquier otro valor que no es de la
    // lista, y la pantalla lo dice devolviendo el filtro en blanco.
    signIn($this->scenario, Role::Admin);

    $this->get('/payments?status=cancelled')->assertInertia(fn ($page) => $page
        ->where('filters.status', ''));

    $this->get('/commissions?status=approved')->assertInertia(fn ($page) => $page
        ->where('filters.status', 'accrued'));
});

it('los documentos tampoco ofrecen los suyos', function (): void {
    // `expired` y `superseded` están en el enum y no los escribe nadie:
    // vencido es una fecha, no una decisión de revisión. La demostración
    // sembraba uno y por eso la opción muerta devolvía una fila.
    signIn($this->scenario, Role::Admin);

    // Las claves EXACTAS y no «no contiene»: al cerrar con un closure, Inertia
    // entrega una Collection, y `(array)` sobre ella devuelve sus propiedades
    // internas —nunca las claves de las facetas—, así que la comprobación
    // pasaba siempre. Un sabotaje lo enseñó: se puede escribir un guardián que
    // no puede fallar.
    $this->get('/documents')->assertInertia(fn ($page) => $page
        ->where('facets', fn (Collection $f): bool => $f->keys()->all() === [
            'all', 'pending', 'in_review', 'approved', 'rejected', 'expiring',
        ]));
});

it('pedir un documento «vencido» por la URL no deja el filtro mintiendo', function (): void {
    // Lo que NO debe pasar: que la pantalla diga «Vencido» en el filtro y
    // enseñe la lista entera porque ese valor ya no entra en el `where`.
    signIn($this->scenario, Role::Admin);

    $this->get('/documents?status=expired')->assertInertia(fn ($page) => $page
        ->where('filters.status', ''));

    $this->get('/documents?status=rejected')->assertInertia(fn ($page) => $page
        ->where('filters.status', 'rejected'));
});

it('pagar comisiones «aprobadas» ya no se acepta', function (): void {
    // Se podía pedir. No se pagaba nada, y el mensaje de éxito decía
    // «0 comisiones marcadas como pagadas».
    signIn($this->scenario, Role::Admin);

    $this->post('/commissions/pay', [
        'dispatcher_user_id' => (string) $this->scenario->user(Role::Dispatcher)->id,
        'status' => 'approved',
    ])->assertSessionHasErrors('status');
});

it('una comisión devengada se sigue pagando', function (): void {
    // Lo que no puede romperse: quitar `approved` del `whereIn` de `markPaid()`
    // no puede dejar de pagar lo que sí existe.
    $despachador = (string) $this->scenario->user(Role::Dispatcher)->id;

    $id = app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($despachador): string {
        $tenant = (string) $this->scenario->tenant->id;
        $carga = (string) $this->scenario->load->id;

        // La comisión cuelga de una instantánea financiera: el esquema lo
        // impone, y es lo que hace que la cifra no se recalcule nunca.
        $instantanea = (string) Illuminate\Support\Str::uuid();

        DB::table('financial_snapshots')->insert([
            'id' => $instantanea,
            'tenant_id' => $tenant,
            'load_id' => $carga,
            'version' => 1,
            'customer_charge_cents' => 200000,
            'carrier_gross_rate_cents' => 160000,
            'carrier_dispatch_fee_bps' => 1000,
            'dispatcher_commission_bps' => 2500,
            'dispatcher_commission_basis' => 'dispatch_fee_amount',
            'commissionable_base_cents' => 100000,
            'dispatch_fee_amount_cents' => 40000,
            'net_carrier_settlement_cents' => 120000,
            'gross_margin_cents' => 40000,
            'dispatcher_commission_amount_cents' => 10000,
            'computed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $id = (string) Illuminate\Support\Str::uuid();

        DB::table('dispatcher_commissions')->insert([
            'id' => $id,
            'tenant_id' => $tenant,
            'load_id' => $carga,
            'financial_snapshot_id' => $instantanea,
            'dispatcher_user_id' => $despachador,
            'basis' => 'dispatch_fee_amount',
            'basis_amount_cents' => 100000,
            'percentage_bps' => 1000,
            'amount_cents' => 10000,
            'status' => 'accrued',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    });

    signIn($this->scenario, Role::Admin);

    $this->post('/commissions/pay', [
        'dispatcher_user_id' => $despachador,
        'status' => 'accrued',
    ])->assertSessionHasNoErrors();

    expect((string) DB::table('dispatcher_commissions')->where('id', $id)->value('status'))->toBe('paid');
});

it('el registro no ofrece nada que la lista no pueda encontrar', function (): void {
    // La comprobación de arriba, sobre las ocho listas de una vez.
    foreach (array_keys(Reachable::CATALOGO) as $lista) {
        [$tabla, $campo] = Reachable::TABLAS[$lista];

        foreach (array_keys(Reachable::NO_SE_PRODUCEN[$lista] ?? []) as $imposible) {
            expect(Reachable::admite($lista, $imposible))->toBeFalse(
                "«{$lista}» todavía admite «{$imposible}»",
            );
        }

        expect($tabla)->not->toBe('');
        expect($campo)->not->toBe('');
    }
});
