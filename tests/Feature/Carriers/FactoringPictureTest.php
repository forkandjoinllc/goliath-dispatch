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

function fichaFactoring(string $tenantId, string $nombre, bool $activa = true): string
{
    $id = (string) Str::uuid();

    DB::table('factoring_companies')->insert([
        'id' => $id,
        'tenant_id' => $tenantId,
        'name' => $nombre,
        'active' => $activa,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

function asignaFactoring(string $tenantId, string $carrierId, string $fichaId): void
{
    DB::table('factoring_assignments')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $tenantId,
        'carrier_id' => $carrierId,
        'factoring_company_id' => $fichaId,
        'verification_status' => 'not_started',
        'effective_from' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

/* ── Las tres respuestas, distinguidas ──────────────────────────────────── */

it('con asignación la ficha dice el nombre de la empresa', function (): void {
    $sc = $this->scenario;
    $carrier = $sc->assignedCarrier;

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc, $carrier): void {
        $ficha = fichaFactoring($sc->tenant->id, 'Asignada Formal LLC');
        asignaFactoring($sc->tenant->id, (string) $carrier->id, $ficha);
        DB::table('carriers')->where('id', $carrier->id)->update(['uses_factoring' => 1]);
    });

    signIn($sc, Role::Admin);

    $this->get("/carriers/{$carrier->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('carrier.factoring.assignedName', 'Asignada Formal LLC')
            ->where('carrier.factoring.declaredName', null));
});

it('sin asignación pero con lo declarado, la ficha dice que está declarado', function (): void {
    $sc = $this->scenario;
    $carrier = $sc->assignedCarrier;

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc, $carrier): void {
        $ficha = fichaFactoring($sc->tenant->id, 'Declarada Con Ficha LLC');

        DB::table('carriers')->where('id', $carrier->id)->update([
            'uses_factoring' => 1,
            'factoring_declared_company_id' => $ficha,
        ]);
    });

    signIn($sc, Role::Admin);

    $this->get("/carriers/{$carrier->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('carrier.factoring.assignedName', null)
            ->where('carrier.factoring.declaredName', 'Declarada Con Ficha LLC')
            ->where('carrier.factoring.declaredHasRecord', true));
});

it('un nombre escrito a mano se marca como sin ficha', function (): void {
    $sc = $this->scenario;
    $carrier = $sc->assignedCarrier;

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($carrier): void {
        DB::table('carriers')->where('id', $carrier->id)->update([
            'uses_factoring' => 1,
            'factoring_declared_name' => 'Escrita A Mano LLC',
        ]);
    });

    signIn($sc, Role::Admin);

    $this->get("/carriers/{$carrier->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('carrier.factoring.declaredName', 'Escrita A Mano LLC')
            ->where('carrier.factoring.declaredHasRecord', false));
});

it('«sí» sin nada deja las dos vacías, y la pantalla lo dirá', function (): void {
    $sc = $this->scenario;
    $carrier = $sc->assignedCarrier;

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($carrier): void {
        DB::table('carriers')->where('id', $carrier->id)->update(['uses_factoring' => 1]);
    });

    signIn($sc, Role::Admin);

    $this->get("/carriers/{$carrier->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('carrier.usesFactoring', true)
            ->where('carrier.factoring.assignedName', null)
            ->where('carrier.factoring.declaredName', null));
});

/* ── El formulario y la preselección ────────────────────────────────────── */

it('el formulario preselecciona lo declarado cuando no hay asignación', function (): void {
    $sc = $this->scenario;
    $carrier = $sc->assignedCarrier;
    $ficha = null;

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc, $carrier, &$ficha): void {
        $ficha = fichaFactoring($sc->tenant->id, 'Para Preseleccionar LLC');

        DB::table('carriers')->where('id', $carrier->id)->update([
            'uses_factoring' => 1,
            'factoring_declared_company_id' => $ficha,
        ]);
    });

    signIn($sc, Role::Admin);

    $this->get("/carriers/{$carrier->id}/edit")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('factoringCompanyId', null)
            ->where('factoringDeclared.id', $ficha)
            ->where('factoringDeclared.name', 'Para Preseleccionar LLC'));
});

it('una ficha desactivada después del alta no se preselecciona', function (): void {
    /*
    | El desplegable solo lleva las activas. Preseleccionar un valor que no está
    | entre las opciones deja el desplegable enseñando otra cosa de la que dice
    | tener — y guardando sin querer una empresa distinta.
    */
    $sc = $this->scenario;
    $carrier = $sc->assignedCarrier;

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc, $carrier): void {
        $ficha = fichaFactoring($sc->tenant->id, 'Desactivada Luego LLC', activa: false);

        DB::table('carriers')->where('id', $carrier->id)->update([
            'uses_factoring' => 1,
            'factoring_declared_company_id' => $ficha,
        ]);
    });

    signIn($sc, Role::Admin);

    $this->get("/carriers/{$carrier->id}/edit")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('factoringDeclared.id', null)
            // …y el nombre SÍ viaja, para poder decirlo en pantalla.
            ->where('factoringDeclared.name', 'Desactivada Luego LLC'));
});

it('guardar la ficha convierte la declaración en asignación', function (): void {
    // Es lo que hace útil el alta: el transportista ya dijo con quién, y la
    // casa lo establece en un guardado. Con el aviso en pantalla delante.
    $sc = $this->scenario;
    $carrier = $sc->assignedCarrier;
    $ficha = null;

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($sc, $carrier, &$ficha): void {
        $ficha = fichaFactoring($sc->tenant->id, 'Se Vuelve Asignada LLC');

        DB::table('carriers')->where('id', $carrier->id)->update([
            'uses_factoring' => 1,
            'factoring_declared_company_id' => $ficha,
        ]);
    });

    signIn($sc, Role::Admin);

    $this->patch("/carriers/{$carrier->id}", [
        'legal_name' => $carrier->legal_name,
        'dot_number' => $carrier->dot_number,
        'contact_first_name' => 'Ana',
        'contact_last_name' => 'Díaz',
        'email' => 'ana@x.test',
        'phone' => '+1 555 0100',
        'physical_line1' => '1 Main',
        'physical_city' => 'Laredo',
        'physical_state' => 'TX',
        'physical_postal_code' => '78040',
        'mailing_same_as_physical' => true,
        'preferred_locale' => 'en',
        'uses_factoring' => true,
        'factoring_company_id' => $ficha,
    ])->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($carrier, $ficha): void {
        $asignada = DB::table('factoring_assignments')
            ->where('carrier_id', $carrier->id)
            ->whereNull('deleted_at')
            ->value('factoring_company_id');

        expect((string) $asignada)->toBe($ficha);
    });
});

/* ── Nada de otra empresa ───────────────────────────────────────────────── */

it('la asignación de otra empresa no aparece en esta ficha', function (): void {
    $sc = $this->scenario;
    $carrier = $sc->assignedCarrier;

    // Una fila de `factoring_assignments` con el MISMO carrier_id y otro
    // tenant_id. No debería existir, y si existiera no debe leerse.
    $vecina = (string) Str::uuid();

    app(TenantContext::class)->runAs($sc->tenant->id, function () use ($carrier): void {
        DB::table('carriers')->where('id', $carrier->id)->update(['uses_factoring' => 1]);
    });

    signIn($sc, Role::Admin);

    $this->get("/carriers/{$carrier->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('carrier.factoring.assignedName', null));

    expect($vecina)->not->toBe('');
});
