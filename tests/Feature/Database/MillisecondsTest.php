<?php

declare(strict_types=1);

use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(function () {
    Carbon::setTestNow();
    app(TenantContext::class)->forget();
});

it('la gramática de consultas escribe la fracción de segundo', function () {
    // Los modelos ya la conservaban por su $dateFormat. Esto fija lo otro: que
    // los INSERT en crudo, que no pasan por el modelo, tampoco la pierdan.
    expect(DB::connection()->getQueryGrammar()->getDateFormat())->toBe('Y-m-d H:i:s.v');
});

it('un insert en crudo conserva los milisegundos', function () {
    $instante = Carbon::create(2026, 3, 4, 10, 30, 15)->addMilliseconds(456);
    Carbon::setTestNow($instante);

    $id = (string) Str::uuid();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($id) {
        DB::table('audit_events')->insert([
            'id' => $id,
            'tenant_id' => $this->scenario->tenant->id,
            'action' => 'load.created',
            'entity_type' => 'load',
            'entity_id' => (string) $this->scenario->load->id,
            'occurred_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    Carbon::setTestNow();

    $guardado = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('audit_events')->where('id', $id)->value('occurred_at')
    );

    // Sin la gramática propia esto guardaba '2026-03-04 10:30:15.000', y dos
    // eventos del mismo segundo quedaban sin orden recuperable.
    expect((string) $guardado)->toBe('2026-03-04 10:30:15.456');
});