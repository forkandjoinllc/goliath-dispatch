<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Compliance\ExpiryWindow;
use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

/**
 * Las tres pantallas que avisan de una caducidad dicen lo mismo.
 *
 * Documentos ya respetaba el ajuste de la empresa. Conductores y Equipos
 * llevaban `WARN_DAYS = 45` a fuego, así que una empresa que pedía avisar con
 * 20 días veía «Vence pronto» a 45 justo donde viven la CDL, la tarjeta médica,
 * la matrícula y la inspección.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    $this->escenario = Scenario::create();
    $this->tenantId = (string) $this->escenario->tenant->id;
    $this->escenario->crew($this->escenario->load);
});

afterEach(function (): void {
    TenantPolicy::forget();
    app(TenantContext::class)->forget();
});

function avisarCon(string $tenantId, int $dias): void
{
    DB::table('tenant_settings')->where('tenant_id', $tenantId)
        ->update(['document_expiration_warning_days' => $dias]);

    TenantPolicy::forget($tenantId);
}

function conductorConLicenciaEn(string $tenantId, int $dias): string
{
    $id = (string) DB::table('drivers')->where('tenant_id', $tenantId)->value('id');

    DB::table('drivers')->where('id', $id)->update([
        'license_expires_at' => now()->addDays($dias)->toDateString(),
        'medical_card_expires_at' => now()->addYears(2)->toDateString(),
    ]);

    return $id;
}

/**
 * @return array{filas: int, contador: int, etiqueta: ?string}
 */
function porVencer(object $prueba, string $ruta, string $clave, string $etiqueta): array
{
    $p = json_decode((string) json_encode(
        $prueba->get($ruta.'?expiring=1')->viewData('page')['props'] ?? []), true);

    $filas = $p[$clave]['data'] ?? [];

    return [
        'filas' => count($filas),
        'contador' => (int) ($p['facets']['expiring'] ?? -1),
        'etiqueta' => $filas[0]['expiries'][$etiqueta] ?? null,
    ];
}

/* ── Conductores ─────────────────────────────────────────────────────────── */

it('una licencia fuera del plazo que pidió la empresa no sale como por vencer', function (): void {
    // La medida de antes de arreglarlo: la empresa pide 20, la licencia caduca
    // dentro de 30, y Conductores la listaba igual porque usaba 45.
    avisarCon($this->tenantId, 20);
    conductorConLicenciaEn($this->tenantId, 30);

    signIn($this->escenario, Role::Admin);

    expect(porVencer($this, '/drivers', 'drivers', 'license')['filas'])->toBe(0);
});

it('y dentro del plazo sí sale', function (): void {
    avisarCon($this->tenantId, 20);
    conductorConLicenciaEn($this->tenantId, 10);

    signIn($this->escenario, Role::Admin);

    expect(porVencer($this, '/drivers', 'drivers', 'license')['filas'])->toBe(1);
});

it('subir el plazo de la empresa mete a ese conductor en la lista', function (): void {
    // El ajuste tiene que servir para algo en ESTA pantalla, no solo en
    // Documentos.
    conductorConLicenciaEn($this->tenantId, 30);

    signIn($this->escenario, Role::Admin);

    avisarCon($this->tenantId, 20);
    $antes = porVencer($this, '/drivers', 'drivers', 'license')['filas'];

    avisarCon($this->tenantId, 60);
    $despues = porVencer($this, '/drivers', 'drivers', 'license')['filas'];

    expect($antes)->toBe(0)->and($despues)->toBe(1);
});

it('la lista y su contador no se contradicen', function (): void {
    // Es la razón que da el docblock de Documentos para que los cuatro sitios
    // usen el mismo número: un contador que dice 1 sobre una lista vacía manda
    // a buscar algo que no está.
    avisarCon($this->tenantId, 20);
    conductorConLicenciaEn($this->tenantId, 30);

    signIn($this->escenario, Role::Admin);

    $r = porVencer($this, '/drivers', 'drivers', 'license');

    expect($r['contador'])->toBe($r['filas']);
});

it('la etiqueta de la ficha usa el mismo plazo que la lista', function (): void {
    // El filtro y el contador no son lo único que lee un despachador: en la
    // fila hay una insignia. Un sabotaje que dejaba la insignia con su propia
    // regla salió VERDE, porque ninguna prueba la miraba.
    avisarCon($this->tenantId, 20);
    conductorConLicenciaEn($this->tenantId, 10);

    signIn($this->escenario, Role::Admin);

    expect(porVencer($this, '/drivers', 'drivers', 'license')['etiqueta'])->toBe('soon');
});

it('y fuera del plazo la ficha no lleva insignia', function (): void {
    avisarCon($this->tenantId, 20);
    $id = conductorConLicenciaEn($this->tenantId, 30);

    signIn($this->escenario, Role::Admin);

    $p = json_decode((string) json_encode(
        $this->get('/drivers')->viewData('page')['props'] ?? []), true);

    $fila = collect($p['drivers']['data'] ?? [])->firstWhere('id', $id);

    // `?? 'ausente'` no valdría: dispara también con null, que es el valor
    // correcto. La clave tiene que estar y valer null.
    expect($fila)->not->toBeNull('No sale el conductor que acabo de preparar.');
    test()->assertArrayHasKey('license', $fila['expiries']);
    expect($fila['expiries']['license'])->toBeNull();
});

/* ── Equipos ─────────────────────────────────────────────────────────────── */

it('una inspección fuera del plazo tampoco sale como por vencer', function (): void {
    avisarCon($this->tenantId, 20);

    $id = (string) DB::table('trucks')->where('tenant_id', $this->tenantId)->value('id');
    DB::table('trucks')->where('id', $id)->update([
        'next_inspection_due_at' => now()->addDays(30)->toDateString(),
        'registration_expires_at' => now()->addYears(2)->toDateString(),
    ]);

    signIn($this->escenario, Role::Admin);

    expect(porVencer($this, '/equipment/trucks', 'units', 'inspection')['filas'])->toBe(0);
});

/* ── Documentos ──────────────────────────────────────────────────────────── */

it('documentos sigue respetando el plazo después de mudarse al sitio común', function (): void {
    // Era la única de las tres que ya estaba bien, y este lote la cambia de
    // sitio: es la que más fácil se rompe sin que nadie lo note. Un sabotaje
    // que la descolgaba salió VERDE porque ninguna prueba la tocaba.
    avisarCon($this->tenantId, 20);

    $doc = [
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->tenantId,
        'owner_type' => 'carrier',
        'owner_id' => (string) $this->escenario->assignedCarrier->id,
        'document_type' => 'certificate_of_insurance',
        'title' => 'Póliza de prueba',
        'review_status' => 'approved',
        'is_required' => 1,
        'uploaded_by_user_id' => (string) $this->escenario->user(Role::Admin)->id,
        'created_at' => now(),
        'updated_at' => now(),
    ];

    DB::table('documents')->insert([...$doc, 'expiration_date' => now()->addDays(30)->toDateString()]);

    signIn($this->escenario, Role::Admin);

    $lejos = json_decode((string) json_encode(
        $this->get('/documents?expiring=1')->viewData('page')['props'] ?? []), true);

    expect(collect($lejos['documents']['data'] ?? [])->pluck('title'))->not->toContain('Póliza de prueba');

    avisarCon($this->tenantId, 60);

    $cerca = json_decode((string) json_encode(
        $this->get('/documents?expiring=1')->viewData('page')['props'] ?? []), true);

    expect(collect($cerca['documents']['data'] ?? [])->pluck('title'))->toContain('Póliza de prueba');
});

/* ── Las tres a la vez ───────────────────────────────────────────────────── */

it('el mismo plazo rige en las tres pantallas', function (): void {
    // Lo que el ajuste promete: «Con cuánta antelación un documento cuenta como
    // caduca pronto». Una empresa no tiene por qué saber que hay tres plazos.
    avisarCon($this->tenantId, 20);

    // `ExpiryWindow` lee la empresa ACTIVA. Fuera de una petición no hay
    // ninguna, y la política cae a sus valores por defecto —30 días—, así que
    // la llamada directa va dentro de `runAs`. Que devuelva 30 en vez de 20 al
    // llamarla suelta no es un fallo del cálculo: es que no había empresa.
    app(TenantContext::class)->runAs($this->tenantId, function (): void {
        expect(ExpiryWindow::days())->toBe(20);

        // A 30 días vista, ninguna de las tres cosas cuenta como próxima.
        expect(ExpiryWindow::flag(now()->addDays(30)->toDateString()))->toBeNull()
            ->and(ExpiryWindow::flag(now()->addDays(10)->toDateString()))->toBe('soon')
            ->and(ExpiryWindow::flag(now()->subDay()->toDateString()))->toBe('expired');
    });
});

it('lo que caduca hoy no está caducado todavía', function (): void {
    // Se comparan DÍAS y no marcas de tiempo: decirle a un despachador a las
    // nueve de la mañana que una licencia que vence hoy ya no vale le hace
    // rechazar una carga que sí podía salir.
    avisarCon($this->tenantId, 20);

    app(TenantContext::class)->runAs($this->tenantId, function (): void {
        expect(ExpiryWindow::flag(now()->toDateString()))->toBe('soon');
    });
});

it('sin fecha no hay aviso', function (): void {
    expect(ExpiryWindow::flag(null))->toBeNull()
        ->and(ExpiryWindow::flag(''))->toBeNull();
});
