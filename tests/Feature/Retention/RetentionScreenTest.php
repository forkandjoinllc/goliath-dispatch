<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    config(['retention.purge_enabled' => false]);
});

afterEach(fn () => app(TenantContext::class)->forget());

it('la pantalla dibuja la política y dice si la purga está apagada', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/retention')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Retention/Index')
            ->where('policy.purgeEnabled', false)
            ->where('holds', [])
            ->has('entities')
        );
});

it('dice cuando la purga permanente está encendida', function () {
    // Cambia por completo lo que significa la lista de abajo: apagada es una
    // previsión, encendida es lo que va a pasar el domingo.
    config(['retention.purge_enabled' => true]);
    signIn($this->scenario, Role::Admin);

    $this->get('/retention')
        ->assertInertia(fn (Assert $page) => $page->where('policy.purgeEnabled', true));
});

it('quien no gestiona retención no entra', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/retention')->assertForbidden();
});

it('aplicar un bloqueo desde la pantalla', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/retention/holds', [
        'name' => 'Reclamación GD-24007',
        'reason' => 'El cliente reclama una detención de seis horas y pide el expediente.',
        'scope_type' => 'tenant',
    ])->assertRedirect();

    $this->get('/retention')->assertInertia(fn (Assert $page) => $page
        ->has('holds', 1)
        ->where('holds.0.name', 'Reclamación GD-24007'));
});

it('un bloqueo sin motivo suficiente no se acepta', function () {
    // Un bloqueo sin motivo es un bloqueo que dentro de tres años nadie sabe si
    // puede levantar, y entonces no se levanta nunca: la retención deja de
    // funcionar por acumulación de bloqueos que nadie se atreve a tocar.
    signIn($this->scenario, Role::Admin);

    $this->post('/retention/holds', [
        'name' => 'X',
        'reason' => 'porque sí',
        'scope_type' => 'tenant',
    ])->assertSessionHasErrors('reason');
});

it('un bloqueo por tipo sin decir de qué tipo no se acepta', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/retention/holds', [
        'name' => 'Documentos',
        'reason' => 'Hay que conservar todos los documentos de esta empresa.',
        'scope_type' => 'entity_type',
    ])->assertSessionHasErrors('entity_type');
});

it('levantar exige explicación', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/retention/holds', [
        'name' => 'Citación',
        'reason' => 'Citación amplia del juzgado del condado, alcance por determinar.',
        'scope_type' => 'tenant',
    ])->assertRedirect();

    $id = app(TenantContext::class)->withoutTenant(fn () => DB::table('legal_holds')->value('id'));

    $this->post("/retention/holds/{$id}/release", ['release_reason' => 'ya'])
        ->assertSessionHasErrors('release_reason');

    $this->post("/retention/holds/{$id}/release", [
        'release_reason' => 'El juzgado cerró el expediente y lo comunicó por escrito.',
    ])->assertRedirect();

    $this->get('/retention')->assertInertia(fn (Assert $page) => $page->has('holds', 0));
});

it('distingue «no ha corrido» de «corrió y no había nada que hacer»', function () {
    // Un barrido sin trabajo no escribe filas en `retention_jobs` —no hay nada
    // que contar—, así que la lista de ejecuciones queda vacía. La pantalla
    // decía entonces «todavía no ha corrido», que es falso, y para una empresa
    // nueva ese es el estado normal durante dos años: dos años diciéndole que su
    // retención no funciona.
    signIn($this->scenario, Role::Admin);

    $this->get('/retention')->assertInertia(fn (Assert $page) => $page
        ->where('lastSweep.hasEverRun', false)
        ->where('runs', []));

    $this->artisan('retention:sweep')->assertSuccessful();

    $this->get('/retention')->assertInertia(fn (Assert $page) => $page
        ->where('lastSweep.hasEverRun', true)
        // Sigue sin haber filas: no había nada que archivar. Es justo el caso.
        ->where('runs', []));
});

it('no existe ninguna ruta para purgar a mano', function () {
    // Deliberado. Purgar es un DELETE que no se deshace, y un botón así en una
    // pantalla web es un botón que alguien pulsa por curiosidad un viernes.
    $rutas = collect(app('router')->getRoutes())
        ->map(fn ($r): string => $r->uri())
        ->filter(fn (string $uri): bool => str_contains($uri, 'retention'))
        ->values()
        ->all();

    expect($rutas)->not->toContain('retention/purge');

    foreach ($rutas as $uri) {
        expect($uri)->not->toContain('purge');
    }
});
