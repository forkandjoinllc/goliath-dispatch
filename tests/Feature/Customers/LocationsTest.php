<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use App\Support\Tracking\CustomerLink;
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

/** Los campos mínimos para guardar un cliente por HTTP. */
function clienteCon(array $extra = []): array
{
    return [
        'company_name' => 'Sitios de prueba LLC',
        'status' => 'active',
        'physical_country' => 'US',
        'billing_country' => 'US',
        'billing_same_as_physical' => true,
        'payment_terms_days' => 30,
        'contacts' => [
            ['first_name' => 'A', 'last_name' => 'B', 'email' => 'a@b.test',
             'position' => 'traffic', 'preferred_locale' => 'en'],
        ],
        ...$extra,
    ];
}

it('se dan de alta los sitios de un cliente', function () {
    signIn($this->scenario, Role::Admin);

    // Antes de este lote no había forma de llegar aquí: ocho pantallas leían
    // esta tabla y no la escribía nadie.
    $this->post('/customers', clienteCon([
        'locations' => [
            ['name' => 'Planta Odessa', 'line1' => '1400 North Grandview', 'city' => 'Odessa',
             'state' => 'TX', 'country' => 'US', 'postal_code' => '79761', 'timezone' => 'America/Chicago'],
            ['name' => 'Muelle Laredo', 'city' => 'Laredo', 'state' => 'TX', 'country' => 'US'],
        ],
    ]))->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        $sitios = DB::table('customer_locations')->orderByDesc('is_primary')->get();

        expect($sitios)->toHaveCount(2)
            ->and($sitios[0]->name)->toBe('Planta Odessa')
            // Esta tabla NO tiene índice único sobre el principal: la regla vive
            // entera en el código, y el orden de la lista es el dato.
            ->and((bool) $sitios[0]->is_primary)->toBeTrue()
            ->and((bool) $sitios[1]->is_primary)->toBeFalse();
    });
});

it('un estado que no es del país del sitio no entra', function () {
    signIn($this->scenario, Role::Admin);

    // Cada sitio lleva su país: un cliente puede tener una bodega en Texas y
    // otra en Nuevo León, y el estado se valida contra el país de SU fila.
    $this->post('/customers', clienteCon([
        'locations' => [
            ['name' => 'Imposible', 'country' => 'MX', 'state' => 'TX'],
        ],
    ]))->assertSessionHasErrors('locations.0.state');
});

it('quitar un sitio lo borra en suave', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/customers', clienteCon([
        'locations' => [
            ['name' => 'Uno', 'country' => 'US'],
            ['name' => 'Dos', 'country' => 'US'],
        ],
    ]))->assertSessionHasNoErrors();

    [$clienteId, $unoId] = app(TenantContext::class)->runAs($this->scenario->tenant->id, fn (): array => [
        (string) DB::table('customers')->where('company_name', 'Sitios de prueba LLC')->value('id'),
        (string) DB::table('customer_locations')->where('name', 'Uno')->value('id'),
    ]);

    $this->patch("/customers/{$clienteId}", clienteCon([
        'locations' => [['id' => $unoId, 'name' => 'Uno', 'country' => 'US']],
    ]))->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        // En suave: una carga entregada hace un año tiene que poder seguir
        // diciendo dónde se entregó, y ese nombre está en un papel firmado.
        expect(DB::table('customer_locations')->whereNull('deleted_at')->count())->toBe(1)
            ->and(DB::table('customer_locations')->whereNotNull('deleted_at')->count())->toBe(1);
    });
});

// ─────────────────────────────────────────────────── la frontera de la parada

/** Un sitio del cliente del escenario. */
function sitioDe(Scenario $s, string $nombre, ?string $customerId = null): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $nombre, $customerId): string {
        $id = (string) Str::uuid();

        DB::table('customer_locations')->insert([
            'id' => $id,
            'tenant_id' => $s->tenant->id,
            'customer_id' => $customerId ?? $s->customer->id,
            'name' => $nombre,
            'city' => 'Odessa',
            'state' => 'TX',
            'country' => 'US',
            'timezone' => 'America/Chicago',
            'is_primary' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    });
}

it('una parada no acepta el sitio de otro cliente', function () {
    // Otro cliente de la misma empresa. Ocho lectores hacen `leftJoin` con esta
    // tabla: sin la frontera, el nombre y la dirección de la instalación ajena
    // saldrían en el papel que firma el transportista y en la página pública.
    $otro = app(TenantContext::class)->runAs($this->scenario->tenant->id, fn (): string => (string) DB::table('customers')->insertGetId([
        'id' => $id = (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'company_name' => 'Ajena LLC',
        'company_name_normalized' => 'ajena llc',
        'status' => 'active',
        'payment_terms_days' => 30,
        'created_at' => now(),
        'updated_at' => now(),
    ]) === 0 ? $id : $id);

    $ajeno = sitioDe($this->scenario, 'Planta ajena', $otro);

    signIn($this->scenario, Role::Admin);

    $this->patch("/loads/{$this->scenario->load->id}", [
        'customer_id' => (string) $this->scenario->customer->id,
        'commodity' => 'Acero',
        'weight_pounds' => 42000,
        'customer_charge_cents' => 500000,
        'stops' => [
            ['stop_type' => 'pickup', 'customer_location_id' => $ajeno, 'city' => 'Laredo', 'state' => 'TX', 'country' => 'US'],
            ['stop_type' => 'delivery', 'city' => 'Dallas', 'state' => 'TX', 'country' => 'US'],
        ],
    ])->assertSessionHasErrors('stops.0.customer_location_id');
});

it('una parada acepta un sitio de su propio cliente', function () {
    $propio = sitioDe($this->scenario, 'Planta propia');

    signIn($this->scenario, Role::Admin);

    $this->patch("/loads/{$this->scenario->load->id}", [
        'customer_id' => (string) $this->scenario->customer->id,
        'commodity' => 'Acero',
        'weight_pounds' => 42000,
        'customer_charge_cents' => 500000,
        'stops' => [
            ['stop_type' => 'pickup', 'customer_location_id' => $propio, 'city' => 'Laredo', 'state' => 'TX', 'country' => 'US'],
            ['stop_type' => 'delivery', 'city' => 'Dallas', 'state' => 'TX', 'country' => 'US'],
        ],
    ])->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($propio): void {
        expect(DB::table('load_stops')
            ->where('load_id', $this->scenario->load->id)
            ->where('sequence', 1)
            ->value('customer_location_id'))->toBe($propio);
    });
});

// ──────────────────────────────────────────── a quién avisa el sitio de destino

it('el aviso va al del sitio donde se entrega, no al de tráfico', function () {
    $destino = sitioDe($this->scenario, 'Planta destino');

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($destino): void {
        // Quien lleva el tráfico de toda la empresa...
        $trafico = (string) Str::uuid();
        // ...y quien lleva ESA planta.
        $planta = (string) Str::uuid();

        foreach ([[$trafico, 'trafico@cliente.test', 'traffic', 1], [$planta, 'planta@cliente.test', 'dock', 0]] as [$id, $email, $cargo, $principal]) {
            DB::table('customer_contacts')->insert([
                'id' => $id,
                'tenant_id' => $this->scenario->tenant->id,
                'customer_id' => $this->scenario->customer->id,
                'first_name' => 'C', 'last_name' => 'X',
                'email' => $email, 'position' => $cargo, 'preferred_locale' => 'es',
                'is_primary' => $principal,
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        DB::table('customer_contact_locations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'contact_id' => $planta,
            'location_id' => $destino,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        // La entrega va a esa planta.
        DB::table('load_stops')
            ->where('load_id', $this->scenario->load->id)
            ->where('stop_type', 'delivery')
            ->update(['customer_location_id' => $destino, 'updated_at' => now()]);

        expect(CustomerLink::sendForLoad(
            (string) $this->scenario->tenant->id,
            (string) $this->scenario->load->id,
            null,
        ))->toBe('sent');

        // Sin la preferencia por sitio esto sería `trafico@cliente.test`: el de
        // tráfico gana por cargo en toda la empresa.
        expect(DB::table('public_tracking_links')
            ->where('load_id', $this->scenario->load->id)
            ->value('recipient_email'))->toBe('planta@cliente.test');
    });
});

it('sin nadie atado al sitio se cae al de tráfico', function () {
    $destino = sitioDe($this->scenario, 'Planta sin dueño');

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($destino): void {
        DB::table('customer_contacts')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'customer_id' => $this->scenario->customer->id,
            'first_name' => 'C', 'last_name' => 'X',
            'email' => 'trafico@cliente.test', 'position' => 'traffic', 'preferred_locale' => 'es',
            'is_primary' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        DB::table('load_stops')
            ->where('load_id', $this->scenario->load->id)
            ->where('stop_type', 'delivery')
            ->update(['customer_location_id' => $destino, 'updated_at' => now()]);

        // El respaldo tiene que seguir funcionando: la mayoría de los clientes
        // no van a atar a nadie a ningún sitio.
        expect(CustomerLink::sendForLoad(
            (string) $this->scenario->tenant->id,
            (string) $this->scenario->load->id,
            null,
        ))->toBe('sent');

        expect(DB::table('public_tracking_links')
            ->where('load_id', $this->scenario->load->id)
            ->value('recipient_email'))->toBe('trafico@cliente.test');
    });
});
