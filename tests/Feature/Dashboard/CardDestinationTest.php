<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Dashboard\Panel;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

/**
 * «Púlselo y va a la lista de donde salió» — ahora medido.
 *
 * El subtítulo del panel se lo promete al usuario con todas las letras, y la
 * cabecera de `Panel` lo pone como primera de sus tres reglas. Tres de las once
 * tarjetas no lo cumplían, cada una a su manera:
 *
 *  - `leadsUnassigned` contaba «sin dueño Y todavía vivo» y enlazaba a un
 *    filtro que solo miraba el dueño: la tarjeta decía cuatro y la lista
 *    enseñaba nueve.
 *  - `carriersFmcsaStale` enlazaba a `/carriers` a secas, porque la lista no
 *    tenía ningún filtro capaz de expresar «comprobación vieja».
 *  - `loadsUninvoiced` contaba CARGAS y llevaba a la pantalla de alta de
 *    factura, que enseña TRANSPORTISTAS.
 *
 * Esta prueba recorre las once, pide cada destino y compara. Con datos que
 * DISTINGUEN: para cada tarjeta se planta algo que cuenta y algo que un filtro
 * más flojo colaría. Sin eso, dos consultas distintas dan el mismo número por
 * casualidad y la prueba pasa con el defecto puesto.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Cuántas filas devuelve una pantalla de lista, sea cual sea.
 *
 * Se busca el total dentro de los props en vez de mapear pantalla a clave a
 * mano: un mapa a mano es otra lista que puede quedarse vieja, y aquí lo que se
 * quiere medir es precisamente que dos cosas no se queden viejas la una
 * respecto de la otra.
 */
function filasDelDestino(string $href): int
{
    $props = json_decode((string) json_encode(
        test()->get($href)->assertOk()->viewData('page')['props'] ?? []
    ), true);

    foreach ($props as $valor) {
        if (is_array($valor) && isset($valor['meta']['total'])) {
            return (int) $valor['meta']['total'];
        }
    }

    if (isset($props['totals']['rows'])) {
        return (int) $props['totals']['rows'];
    }

    throw new RuntimeException("El destino {$href} no dice cuántas filas devuelve.");
}

/**
 * Las tarjetas de esta sesión, por clave.
 *
 * @return array<string, array<string, mixed>>
 */
function tarjetasDelDestino(): array
{
    $props = json_decode((string) json_encode(
        test()->get('/home')->assertOk()->viewData('page')['props'] ?? []
    ), true);

    $salida = [];

    foreach ($props['cards'] ?? [] as $tarjeta) {
        $salida[$tarjeta['key']] = $tarjeta;
    }

    return $salida;
}

/** Una carga suelta de esta empresa, en el estado que se pida. */
function cargaDelDestino(Scenario $s, string $estado, ?string $carrierId = null): string
{
    $id = (string) Str::uuid();

    DB::table('loads')->insert([
        'id' => $id,
        'tenant_id' => $s->tenant->id,
        'load_number' => 'L-'.Str::upper(Str::random(6)),
        'customer_id' => $s->customer->id,
        'carrier_id' => $carrierId ?? $s->assignedCarrier->id,
        'status' => $estado,
        'customer_charge_cents' => 300000,
        'carrier_gross_rate_cents' => 250000,
        'carrier_dispatch_fee_bps' => 1000,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

/** Un prospecto de esta empresa. */
function prospectoDelDestino(Scenario $s, string $estado, ?string $responsable = null): void
{
    DB::table('leads')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $s->tenant->id,
        'first_name' => 'Ana',
        'last_name' => 'Ruiz',
        'email' => Str::random(10).'@ejemplo.test',
        'locale' => 'es',
        'source' => 'contact_form',
        'status' => $estado,
        'assigned_to_user_id' => $responsable,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

/**
 * Datos que DISTINGUEN: de cada cosa, una que cuenta y una que casi.
 *
 * La «casi» es la que destapa el defecto. Un prospecto perdido sin dueño lo
 * colaba el filtro viejo de la lista; un transportista verificado hace mucho lo
 * colaba el filtro por estado; una carga ya facturada la colaría un filtro que
 * solo mirase el estado de la carga.
 */
function plantarLoQueDistingueDestino(Scenario $s): void
{
    // ── Prospectos: uno vivo sin dueño (cuenta), uno perdido sin dueño (no).
    prospectoDelDestino($s, 'new');
    prospectoDelDestino($s, 'lost');

    // ── Transportistas: el del escenario se comprueba hoy (no cuenta); el
    //    otro se queda sin comprobar nunca (cuenta).
    DB::table('fmcsa_verifications')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $s->tenant->id,
        'carrier_id' => $s->assignedCarrier->id,
        'provider' => 'mock',
        'dot_number' => '1234567',
        'status' => 'verified',
        'checked_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    // ── Cargas: una entregada y sin facturar (cuenta) y una entregada YA
    //    facturada (no). La segunda es la que separa `Billable` de un simple
    //    filtro por estado.
    cargaDelDestino($s, 'delivered');
    $facturada = cargaDelDestino($s, 'delivered');

    $facturaId = (string) Str::uuid();

    DB::table('invoices')->insert([
        'id' => $facturaId,
        'tenant_id' => $s->tenant->id,
        'invoice_number' => 'INV-'.Str::upper(Str::random(6)),
        'carrier_id' => $s->assignedCarrier->id,
        'status' => 'sent',
        'subtotal_cents' => 25000,
        'total_cents' => 25000,
        'balance_cents' => 25000,
        'issue_date' => now(),
        'due_date' => now()->addDays(30),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    DB::table('invoice_line_items')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $s->tenant->id,
        'invoice_id' => $facturaId,
        'load_id' => $facturada,
        'description_en' => 'Dispatch fee',
        'description_es' => 'Tarifa de despacho',
        'unit_amount_cents' => 25000,
        'amount_cents' => 25000,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

/* ── La regla, sobre las once ──────────────────────────────────────────── */

it('cada tarjeta lleva a una lista que devuelve exactamente su número', function (): void {
    $this->scenario->approveCarrierDocuments();
    plantarLoQueDistingueDestino($this->scenario);

    signIn($this->scenario, Role::Admin);

    $tarjetas = tarjetasDelDestino();

    expect($tarjetas)->not->toBe([]);

    foreach ($tarjetas as $clave => $tarjeta) {
        expect(filasDelDestino($tarjeta['href']))->toBe(
            $tarjeta['count'],
            "La tarjeta «{$clave}» dice {$tarjeta['count']} y su destino {$tarjeta['href']} devuelve otra cosa.",
        );
    }
});

it('el destino de cada tarjeta está declarado en un solo sitio', function (): void {
    // Con el destino dentro de cada constructor, comprobar los once obligaba a
    // leer once métodos — y tres no cumplían la regla de la cabecera.
    $this->scenario->approveCarrierDocuments();
    signIn($this->scenario, Role::Admin);

    foreach (tarjetasDelDestino() as $clave => $tarjeta) {
        expect(Panel::DESTINOS)->toHaveKey($clave);
        expect($tarjeta['href'])->toBe(Panel::DESTINOS[$clave]);
    }
});

/* ── Y cada arreglo, medido por su cuenta ──────────────────────────────── */

it('prospectos: la lista deja fuera los cerrados, igual que la tarjeta', function (): void {
    prospectoDelDestino($this->scenario, 'new');
    prospectoDelDestino($this->scenario, 'lost');
    prospectoDelDestino($this->scenario, 'converted');

    signIn($this->scenario, Role::Admin);

    // Antes: la tarjeta decía 1 y la lista devolvía 3.
    expect(tarjetasDelDestino()['leadsUnassigned']['count'])->toBe(1);
    expect(filasDelDestino('/leads?assigned=unassigned'))->toBe(1);

    // Y sin el filtro se siguen viendo todos: esto estrecha una cola de
    // trabajo, no esconde prospectos.
    expect(filasDelDestino('/leads'))->toBe(3);
});

it('transportistas: la lista sabe preguntar por antigüedad, no solo por estado', function (): void {
    // El del escenario se comprueba hoy; el otro no se ha comprobado nunca.
    DB::table('fmcsa_verifications')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'provider' => 'mock',
        'dot_number' => '1234567',
        'status' => 'verified',
        'checked_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    signIn($this->scenario, Role::Admin);

    $tarjeta = tarjetasDelDestino()['carriersFmcsaStale'];

    expect($tarjeta['href'])->toBe('/carriers?revalidation=due');
    expect(filasDelDestino($tarjeta['href']))->toBe($tarjeta['count']);

    // Y la pregunta no es la del filtro de al lado: sin el filtro salen todos.
    expect(filasDelDestino('/carriers'))->toBeGreaterThan($tarjeta['count']);
});

it('cargas sin facturar: el destino enseña las cargas contadas, no otra cosa', function (): void {
    $this->scenario->approveCarrierDocuments();
    plantarLoQueDistingueDestino($this->scenario);

    signIn($this->scenario, Role::Admin);

    $tarjeta = tarjetasDelDestino()['loadsUninvoiced'];

    expect($tarjeta['href'])->toBe('/loads?uninvoiced=1');
    expect(filasDelDestino($tarjeta['href']))->toBe($tarjeta['count']);

    // La ya facturada no está: separa `Billable` de un filtro por estado.
    expect(filasDelDestino('/loads?status=delivered'))->toBeGreaterThan($tarjeta['count']);
});

it('el filtro de sin facturar no se cuela en la lista sin pedirlo', function (): void {
    $this->scenario->approveCarrierDocuments();
    plantarLoQueDistingueDestino($this->scenario);

    signIn($this->scenario, Role::Admin);

    // Un filtro que se aplica sin que nadie lo pida esconde filas en silencio,
    // que es el mismo defecto por el otro lado.
    expect(filasDelDestino('/loads'))->toBeGreaterThan(filasDelDestino('/loads?uninvoiced=1'));
    expect(filasDelDestino('/loads?uninvoiced=0'))->toBe(filasDelDestino('/loads'));
});
