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
 * Las cuatro ramas del estado vacío, pidiendo la página de verdad.
 *
 * El guardián de `tests/Unit/Suite` lee el componente y comprueba que las ramas
 * están y en qué orden. Esto comprueba lo otro: que el servidor mande el
 * alcance y el permiso CORRECTOS para cada persona, que es de donde salen las
 * ramas. Un componente perfecto con `scope` mal calculado dice la misma mentira
 * que antes.
 */

/** Deja sin transportistas vivos a esta empresa. */
function vaciarTransportistas(Scenario $s): void
{
    app(TenantContext::class)->runAs((string) $s->tenant->id, function () use ($s): void {
        // Borrado suave, como lo hace la aplicación: lo que se prueba es una
        // lista vacía, no una tabla vacía.
        DB::table('carriers')
            ->where('tenant_id', $s->tenant->id)
            ->whereNull('deleted_at')
            ->update(['deleted_at' => now(), 'deletion_reason' => 'prueba']);
    });
}

/* ── El servidor manda el alcance de cada persona ────────────────────────── */

it('el alcance que llega a la pantalla es el de quien mira', function (Role $rol, string $esperado) {
    signIn($this->scenario, $rol);

    $this->get('/documents')
        ->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('scope', $esperado));
})->with([
    'el administrador ve la empresa' => [Role::Admin, 'tenant'],
    'contabilidad también' => [Role::Accounting, 'tenant'],
    'el despachador, su cartera' => [Role::Dispatcher, 'assigned'],
    'el transportista, el suyo' => [Role::Carrier, 'carrier'],
    'el conductor, solo lo propio' => [Role::Driver, 'own'],
]);

it('el conductor no tiene documentos y su alcance lo explica', function () {
    // Es el caso medido: la empresa tiene documentos, él no, y la pantalla
    // decía «Todavía no hay documentos» — una frase sobre la empresa dicha a
    // quien no ve la empresa.
    //
    // El documento se crea ANTES de mirar: sin él, la prueba pasaría también
    // con la base de datos vacía y no mediría «la empresa tiene y él no», que
    // es lo único que hace falsa la frase.
    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () {
        DB::table('documents')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'owner_type' => 'carrier',
            'owner_id' => $this->scenario->assignedCarrier->id,
            'document_type' => 'certificate_of_insurance',
            'title' => 'Póliza',
            'review_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        expect(DB::table('documents')->where('tenant_id', $this->scenario->tenant->id)->count())
            ->toBeGreaterThan(0);
    });

    signIn($this->scenario, Role::Driver);

    $this->get('/documents')
        ->assertOk()
        ->assertInertia(function (Assert $p) {
            $props = $p->toArray()['props'];

            expect($props['scope'])->toBe('own')
                ->and($props['documents']['data'])->toBeEmpty();
        });

});

/* ── El permiso que llega es el de quien mira ────────────────────────────── */

it('contabilidad lee transportistas y no puede crearlos', function () {
    // La rama del consejo: con esto en falso, «Agregue el primero» es una
    // instrucción que no se puede seguir.
    signIn($this->scenario, Role::Accounting);

    $this->get('/carriers')
        ->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('scope', 'tenant')->where('can.create', false));
});

it('el administrador sí puede, y por eso a él sí se le pide', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/carriers')
        ->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('scope', 'tenant')->where('can.create', true));
});

it('con la empresa vacía, contabilidad recibe lo que hace falta para no mentirle', function () {
    vaciarTransportistas($this->scenario);

    signIn($this->scenario, Role::Accounting);

    $this->get('/carriers')
        ->assertOk()
        ->assertInertia(function (Assert $p) {
            $props = $p->toArray()['props'];

            // Las tres cosas que decide el texto: lista vacía, sin filtros,
            // alcance de empresa y sin permiso de crear.
            expect($props['carriers']['data'])->toBeEmpty()
                ->and($props['scope'])->toBe('tenant')
                ->and($props['can']['create'])->toBeFalse()
                // Solo los que SON filtros: en `filters` viaja también el
                // orden, con valor por omisión, y contarlo daría «hay filtros
                // puestos» en una pantalla recién abierta.
                ->and(array_filter(
                    array_intersect_key($props['filters'], array_flip(['search', 'onboarding', 'fmcsa'])),
                    static fn ($v): bool => $v !== '' && $v !== null,
                ))->toBe([]);
        });
});

/* ── Las seis pantallas mandan las tres cosas ────────────────────────────── */

it('cada pantalla del lote manda alcance, filtros y permiso', function (string $ruta, string $clave, string $permiso) {
    signIn($this->scenario, Role::Admin);

    $this->get($ruta)
        ->assertOk()
        ->assertInertia(function (Assert $p) use ($clave, $permiso) {
            $props = $p->toArray()['props'];

            expect($props['scope'] ?? null)->toBeString("{$clave}: sin alcance el estado vacío no puede ser honesto.")
                ->and($props['filters'] ?? null)->toBeArray()
                ->and($props['can'][$permiso] ?? null)->toBeBool("{$clave}: falta can.{$permiso}.");
        });
})->with([
    'transportistas' => ['/carriers', 'carriers', 'create'],
    'clientes' => ['/customers', 'customers', 'create'],
    'conductores' => ['/drivers', 'drivers', 'create'],
    'equipos' => ['/equipment/trucks', 'equipment', 'create'],
    'documentos' => ['/documents', 'documents', 'upload'],
    'cargas' => ['/loads', 'loads', 'create'],
]);
