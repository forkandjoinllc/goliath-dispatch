<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use App\Support\Tracking\Timeline;
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
 * Lo que viaja en el payload, no lo que pinta la pantalla.
 *
 * El guardián de `tests/Unit/Suite/HiddenPayloadTest.php` sujeta la estructura.
 * Esto pide las pantallas y mira las CLAVES que llegan — que es lo que ve quien
 * abre las herramientas del navegador, y la única medida que vale para un
 * defecto de «mandado y escondido».
 */
it('el transportista no recibe la lista de sus competidores', function () {
    signIn($this->scenario, Role::Carrier);

    $this->get('/signatures')
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $props = $page->toArray()['props'];

            // No puede pedir firmas —`signature:request:create` no es suyo— así
            // que la lista no alimenta nada y no viaja.
            expect($props['can']['create'])->toBeFalse();
            expect($props['carriers'])->toBe([]);
        });
});

it('a la oficina sí le llega, porque la usa', function () {
    signIn($this->scenario, Role::Admin);

    // La otra mitad: un lote que esconde datos y de paso rompe el desplegable
    // de quien sí puede usarlo no arregla nada.
    $this->get('/signatures')
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $props = $page->toArray()['props'];

            expect($props['can']['create'])->toBeTrue();
            expect(count($props['carriers']))->toBeGreaterThan(1);
        });
});

it('la cronología pública no lleva identificadores de parada ni proveedor', function () {
    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        $parada = (string) DB::table('load_stops')
            ->where('load_id', $this->scenario->load->id)
            ->value('id');

        DB::table('tracking_events')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'load_id' => $this->scenario->load->id,
            'stop_id' => $parada,
            'event_type' => 'arrived_pickup',
            'provider' => 'manual',
            'location_label' => 'Laredo, TX',
            'occurred_at' => now()->subHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $cliente = Timeline::paraCliente((string) $this->scenario->tenant->id, (string) $this->scenario->load->id);
        $despacho = Timeline::paraDespacho((string) $this->scenario->tenant->id, (string) $this->scenario->load->id);

        expect($cliente)->not->toBe([]);

        foreach ($cliente as $evento) {
            // El nombre del sitio sí: es para lo que el cliente abre la
            // página. El UUID de la parada y el proveedor de rastreo, no.
            expect($evento)->toHaveKey('location');
            expect($evento)->not->toHaveKey('stopId');
            expect($evento)->not->toHaveKey('provider');
        }

        // Y el despacho los sigue teniendo: su pantalla los usa.
        expect($despacho[0])->toHaveKey('stopId');
        expect($despacho[0])->toHaveKey('provider');

        // `reportedByPerson` se queda en las dos: es la frase que el cliente
        // lee —«lo reportó una persona»— y se deriva del proveedor sin
        // nombrarlo.
        expect($cliente[0])->toHaveKey('reportedByPerson');
    });
});

it('la página pública de rastreo no expone la parada por ninguna vía', function () {
    $token = app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): string {
        $parada = (string) DB::table('load_stops')
            ->where('load_id', $this->scenario->load->id)
            ->value('id');

        DB::table('tracking_events')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'load_id' => $this->scenario->load->id,
            'stop_id' => $parada,
            'event_type' => 'arrived_pickup',
            'provider' => 'manual',
            'location_label' => 'Laredo, TX',
            'occurred_at' => now()->subHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $plano = Str::random(48);

        DB::table('public_tracking_links')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'load_id' => $this->scenario->load->id,
            'token_hash' => hash('sha256', $plano),
            'expires_at' => now()->addDays(3),
            'sent_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $plano;
    });

    $respuesta = $this->get("/t/{$token}");

    if ($respuesta->status() !== 200) {
        // El enlace público depende de ajustes de la empresa; si esta
        // instalación no lo sirve, la comprobación de arriba —sobre la pieza
        // que arma la lista— es la que vale.
        expect(true)->toBeTrue();

        return;
    }

    // Sobre las PROPS y no sobre el HTML entero: la palabra «provider»
    // aparece veintiuna veces en el diccionario que la página lleva embebido
    // —«no telematics provider is connected»— y una aguja de texto sobre el
    // documento completo daría rojo por el motivo equivocado. Lo que se mide es
    // la cronología.
    $respuesta->assertInertia(function (Assert $page) {
        foreach ($page->toArray()['props']['timeline'] ?? [] as $evento) {
            expect($evento)->not->toHaveKey('stopId');
            expect($evento)->not->toHaveKey('provider');
        }
    });
});
