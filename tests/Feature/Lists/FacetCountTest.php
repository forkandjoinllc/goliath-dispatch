<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

/**
 * El número de un atajo es el número que sale al pulsarlo.
 *
 * Cinco pantallas llevan una fila de atajos con su recuento al lado. Ese
 * recuento se calculaba sin los demás filtros activos, y pulsarlo los conserva.
 * Medido sobre los datos de demostración, con un cliente elegido en cargas:
 *
 *     la lista enseñaba 3 filas
 *     encima ponía  «Todas (11)»
 *     «Pagadas (3)» llevaba a CERO filas
 *
 * Estas pruebas ponen SIEMPRE un segundo filtro —sin él no hay defecto que
 * medir— y comparan cada atajo con lo que devuelve al pulsarlo.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Las filas que devuelve una pantalla de lista, sea cual sea. */
function filasDeLaLista(string $href): int
{
    $props = json_decode((string) json_encode(
        test()->get($href)->assertOk()->viewData('page')['props'] ?? []
    ), true);

    foreach ($props as $valor) {
        if (is_array($valor) && isset($valor['meta']['total'])) {
            return (int) $valor['meta']['total'];
        }
    }

    throw new RuntimeException("El destino {$href} no dice cuántas filas devuelve.");
}

/** @return array<string, int> */
function atajosDe(string $href): array
{
    $props = json_decode((string) json_encode(
        test()->get($href)->assertOk()->viewData('page')['props'] ?? []
    ), true);

    return $props['facets'] ?? [];
}

/**
 * Comprueba una fila de atajos entera contra sus clics.
 *
 * @param  array<string, string>  $clics  atajo => la cadena de consulta que pone
 */
function atajosCuadran(string $base, array $clics): void
{
    $atajos = atajosDe($base);

    expect($atajos)->not->toBe([], "La pantalla {$base} no manda atajos.");

    foreach ($clics as $atajo => $extra) {
        $destino = $extra === '' ? $base : $base.'&'.$extra;

        test()->assertSame(
            $atajos[$atajo] ?? -1,
            filasDeLaLista($destino),
            "El atajo «{$atajo}» de {$base} dice una cosa y {$destino} devuelve otra.",
        );
    }
}

/** Una carga suelta, con su estado y su cliente. */
function cargaDelAtajo(Scenario $s, string $estado, string $customerId): void
{
    DB::table('loads')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $s->tenant->id,
        'load_number' => 'L-'.Str::upper(Str::random(6)),
        'customer_id' => $customerId,
        'carrier_id' => $s->assignedCarrier->id,
        'status' => $estado,
        'customer_charge_cents' => 300000,
        'carrier_gross_rate_cents' => 250000,
        'carrier_dispatch_fee_bps' => 1000,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

/* ── Cargas ────────────────────────────────────────────────────────────── */

it('cargas: los atajos cuentan con el cliente elegido puesto', function (): void {
    // Los datos TIENEN que distinguir: dos clientes y estados cruzados. Con un
    // solo cliente, contar con el filtro y sin él da lo mismo y la prueba pasa
    // con el defecto puesto.
    $mio = (string) $this->scenario->customer->id;

    $otro = (string) Str::uuid();
    DB::table('customers')->insert([
        'id' => $otro,
        'tenant_id' => $this->scenario->tenant->id,
        'company_name' => 'Otro Cliente LLC',
        'company_name_normalized' => 'otro cliente llc '.Str::random(6),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    cargaDelAtajo($this->scenario, 'delivered', $mio);
    cargaDelAtajo($this->scenario, 'delivered', $otro);
    cargaDelAtajo($this->scenario, 'delivered', $otro);
    cargaDelAtajo($this->scenario, 'cancelled', $otro);

    signIn($this->scenario, Role::Admin);

    // Antes: «Entregadas» decía 3 con el cliente puesto y la lista daba 1.
    atajosCuadran("/loads?customer={$mio}", [
        'all' => '',
        'delivered' => 'status=delivered',
        'cancelled' => 'status=cancelled',
        'draft' => 'status=draft',
    ]);
});

it('cargas: y con el filtro de sin facturar puesto', function (): void {
    $mio = (string) $this->scenario->customer->id;

    cargaDelAtajo($this->scenario, 'delivered', $mio);
    cargaDelAtajo($this->scenario, 'cancelled', $mio);

    signIn($this->scenario, Role::Admin);

    atajosCuadran('/loads?uninvoiced=1', [
        'all' => '',
        'delivered' => 'status=delivered',
        'cancelled' => 'status=cancelled',
    ]);
});

it('cargas: sin ningún otro filtro también cuadran', function (): void {
    // El caso que ya funcionaba. Se fija para que arreglar el otro no lo rompa.
    cargaDelAtajo($this->scenario, 'delivered', (string) $this->scenario->customer->id);

    signIn($this->scenario, Role::Admin);

    atajosCuadran('/loads?sort=planned_pickup_at', [
        'all' => '',
        'delivered' => 'status=delivered',
    ]);
});

/* ── Documentos: la fila controla DOS claves ───────────────────────────── */

it('documentos: los atajos cuentan con el dueño elegido puesto', function (): void {
    $this->scenario->approveCarrierDocuments();

    // Un documento de conductor, para que filtrar por dueño mueva la cifra.
    DB::table('documents')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'document_type' => 'cdl_front',
        'owner_type' => 'driver',
        'owner_id' => (string) Str::uuid(),
        'title' => 'Licencia',
        'review_status' => 'pending',
        'expiration_date' => now()->addDays(3),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    signIn($this->scenario, Role::Admin);

    atajosCuadran('/documents?owner=carrier', [
        'all' => '',
        'approved' => 'status=approved',
        'pending' => 'status=pending',
        'expiring' => 'expiring=1',
    ]);
});

it('documentos: «vence pronto» apaga el estado, y se cuenta igual que se pulsa', function (): void {
    // La fila controla `status` Y `expiring`: pulsar uno apaga el otro. Contar
    // «vence pronto» SIN apagar el estado daría la intersección, que no es lo
    // que sale al pulsarlo.
    $this->scenario->approveCarrierDocuments();

    DB::table('documents')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'document_type' => 'w9',
        'owner_type' => 'carrier',
        'owner_id' => (string) $this->scenario->assignedCarrier->id,
        'title' => 'W-9 pendiente y a punto de vencer',
        'review_status' => 'pending',
        'expiration_date' => now()->addDays(2),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    signIn($this->scenario, Role::Admin);

    // Estando en «Aprobados», el atajo «Vence pronto» tiene que contar los que
    // vencen pronto de CUALQUIER estado — porque eso es lo que enseña al
    // pulsarlo.
    $atajos = atajosDe('/documents?status=approved');

    expect($atajos['expiring'])->toBe(filasDeLaLista('/documents?expiring=1'));
    expect($atajos['expiring'])->toBeGreaterThan(0);
});

/* ── Conductores y equipo ──────────────────────────────────────────────── */

it('conductores: los atajos cuentan con la búsqueda puesta', function (): void {
    // La búsqueda tiene que DEJAR FUERA a alguien. La primera versión de esta
    // prueba buscaba el nombre del único conductor del escenario: con y sin el
    // filtro salía lo mismo, así que seguía en verde con el defecto puesto. Lo
    // destapó el sabotaje. Ver `docs/testing.md`.
    foreach ([['Zenobia', 'Quirós', 'inactive'], ['Zenobia', 'Ramos', 'off_duty']] as [$nombre, $apellido, $estado]) {
        DB::table('drivers')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'first_name' => $nombre,
            'last_name' => $apellido,
            'status' => $estado,
            'license_expires_at' => now()->addYear(),
            'medical_card_expires_at' => now()->addYear(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    signIn($this->scenario, Role::Admin);

    // «Zenobia» deja fuera a los del escenario: el filtro estrecha de verdad.
    atajosCuadran('/drivers?search=Zenobia', [
        'all' => '',
        'available' => 'status=available',
        'inactive' => 'status=inactive',
        'off_duty' => 'status=off_duty',
        'expiring' => 'expiring=1',
    ]);
});

it('equipo: los atajos cuentan con la búsqueda puesta', function (): void {
    foreach ([['ZEN-001', 'active'], ['ZEN-002', 'out_of_service']] as [$unidad, $estado]) {
        DB::table('trucks')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'carrier_id' => $this->scenario->assignedCarrier->id,
            'unit_number' => $unidad,
            'vin' => Str::upper(Str::random(17)),
            'vin_normalized' => Str::upper(Str::random(17)),
            'status' => $estado,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    signIn($this->scenario, Role::Admin);

    atajosCuadran('/equipment/trucks?search=ZEN-', [
        'all' => '',
        'active' => 'status=active',
        'out_of_service' => 'status=out_of_service',
        'pending_verification' => 'status=pending_verification',
        'expiring' => 'expiring=1',
    ]);
});

/* ── Transportistas: los recuentos van dentro del desplegable ──────────── */

it('transportistas: los recuentos cuentan con la búsqueda puesta', function (): void {
    foreach ([['Zenobia Transport LLC', 'draft'], ['Zenobia Logistics LLC', 'approved']] as [$razonSocial, $alta]) {
        DB::table('carriers')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'legal_name' => $razonSocial,
            'dot_number' => (string) random_int(1000000, 9999999),
            'contact_first_name' => 'Zenobia',
            'contact_last_name' => 'Quirós',
            'email' => Str::random(9).'@zenobia.test',
            'phone' => '+15550001111',
            'onboarding_status' => $alta,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    signIn($this->scenario, Role::Admin);

    $base = '/carriers?search=Zenobia';
    $atajos = atajosDe($base);

    expect($atajos)->not->toBe([]);

    foreach ($atajos as $estado => $cuenta) {
        if ($estado === 'all') {
            continue;
        }

        test()->assertSame(
            $cuenta,
            filasDeLaLista($base.'&onboarding='.$estado),
            "«{$estado}» dice {$cuenta} y la lista filtrada devuelve otra cosa.",
        );
    }
});

/* ── La frontera que ya existía sigue en pie ───────────────────────────── */

it('los atajos siguen contando solo dentro del ámbito del actor', function (): void {
    // El arreglo añade filtros a la consulta; no puede quitarle el ámbito.
    // Un despachador que viera el recuento de la empresa sabría cuántas cargas
    // hay aunque solo pueda abrir las suyas.
    signIn($this->scenario, Role::Dispatcher);

    $suyas = filasDeLaLista('/loads');

    expect(atajosDe('/loads')['all'])->toBe($suyas);
});
