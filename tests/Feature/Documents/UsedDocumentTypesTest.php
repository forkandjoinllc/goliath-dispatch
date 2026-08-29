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

it('sin dueño elegido no hay tipos usados', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/documents/upload')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('usedTypes', 0));
});

it('dice qué tipos ya tiene ese transportista', function () {
    signIn($this->scenario, Role::Admin);

    $carrier = $this->scenario->assignedCarrier;
    $docId = (string) Str::uuid();

    DB::table('documents')->insert([
        'id' => $docId,
        'tenant_id' => $this->scenario->tenant->id,
        'owner_type' => 'carrier',
        'owner_id' => $carrier->id,
        'document_type' => 'certificate_of_insurance',
        'title' => 'COI 2026',
        'review_status' => 'pending',
        'is_required' => true,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    // Subir dos veces el mismo tipo no crea dos documentos: crea uno bueno y
    // uno que nadie sabe si mirar.
    $this->get("/documents/upload?owner_type=carrier&owner_id={$carrier->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('usedTypes.0.type', 'certificate_of_insurance')
            ->where('usedTypes.0.documentId', $docId));
});

it('un documento borrado deja el tipo libre otra vez', function () {
    signIn($this->scenario, Role::Admin);

    $carrier = $this->scenario->assignedCarrier;

    DB::table('documents')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'owner_type' => 'carrier',
        'owner_id' => $carrier->id,
        'document_type' => 'certificate_of_insurance',
        'title' => 'COI vieja',
        'review_status' => 'pending',
        'is_required' => true,
        'deleted_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $this->get("/documents/upload?owner_type=carrier&owner_id={$carrier->id}")
        ->assertInertia(fn (Assert $page) => $page->has('usedTypes', 0));
});

it('no se pueden mirar los documentos de otra empresa por la URL', function () {
    $otro = Scenario::create();
    app(TenantContext::class)->forget();

    signIn($this->scenario, Role::Admin);

    DB::table('documents')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $otro->tenant->id,
        'owner_type' => 'carrier',
        'owner_id' => $otro->assignedCarrier->id,
        'document_type' => 'certificate_of_insurance',
        'title' => 'Ajena',
        'review_status' => 'pending',
        'is_required' => true,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    // El ámbito se comprueba igual que en el resto: pedir por la URL el dueño
    // de otra empresa no devuelve nada.
    $this->get("/documents/upload?owner_type=carrier&owner_id={$otro->assignedCarrier->id}")
        ->assertInertia(fn (Assert $page) => $page->has('usedTypes', 0));
});

it('un tipo de dueño inventado no rompe la pantalla', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/documents/upload?owner_type=alcalde&owner_id='.$this->scenario->assignedCarrier->id)
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('usedTypes', 0));
});
