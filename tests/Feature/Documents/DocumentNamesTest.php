<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Documents\DocumentOwners;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
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
 * Que la pantalla sepa nombrar lo que enseña, pidiéndola de verdad.
 *
 * El guardián de `tests/Unit/Suite` compara catálogos con el esquema leyendo
 * ficheros. Esto comprueba lo otro: que una petición con datos reales devuelva,
 * para cada fila, un tipo con rótulo y un dueño con NOMBRE. Un catálogo puede
 * estar completo y `ownerNames()` seguir sin saber buscar en `expenses`, y
 * entonces la celda enseña un guion — que es la mitad del defecto original.
 */

/** Cuelga un documento del sistema, como lo hace la aplicación. */
function documentoDeSistema(Scenario $s, string $tipo, string $dueño, string $dueñoId): string
{
    $id = (string) Str::uuid();

    DB::table('documents')->insert([
        'id' => $id,
        'tenant_id' => $s->tenant->id,
        'owner_type' => $dueño,
        'owner_id' => $dueñoId,
        'document_type' => $tipo,
        'title' => 'Papel de prueba',
        'review_status' => 'approved',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

/* ── Cada fila sabe decir qué es y de quién ──────────────────────────────── */

it('un documento de una carga se nombra y dice de qué carga es', function () {
    $carga = $this->scenario->load;

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($carga) {
        documentoDeSistema($this->scenario, 'rate_confirmation', 'load', (string) $carga->id);
    });

    signIn($this->scenario, Role::Admin);

    $this->get('/documents?owner=load')
        ->assertOk()
        ->assertInertia(function (Assert $p) use ($carga) {
            $props = $p->toArray()['props'];
            $fila = collect($props['documents']['data'])->firstWhere('documentType', 'rate_confirmation');

            expect($fila)->not->toBeNull()
                ->and($fila['ownerType'])->toBe('load')
                // El nombre de la carga, no un guion: es lo que la celda pinta.
                ->and($props['owners'][$fila['ownerKey']] ?? null)->toBe((string) $carga->load_number);
        });
});

it('el recibo de un gasto también', function () {
    $gastoId = (string) Str::uuid();

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($gastoId) {
        $categoria = DB::table('expense_categories')->where('tenant_id', $this->scenario->tenant->id)->value('id')
            ?? (function () {
                $id = (string) Str::uuid();
                DB::table('expense_categories')->insert([
                    'id' => $id,
                    'tenant_id' => $this->scenario->tenant->id,
                    'code' => 'tolls',
                    'label_en' => 'Tolls',
                    'label_es' => 'Peajes',
                    'treatment' => 'carrier_deduction',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                return $id;
            })();

        DB::table('expenses')->insert([
            'id' => $gastoId,
            'tenant_id' => $this->scenario->tenant->id,
            'load_id' => $this->scenario->load->id,
            'category_id' => $categoria,
            'description' => 'Peaje del corredor de Illinois',
            'amount_cents' => 4500,
            // La instantánea del trato es NOT NULL sin defecto: el gasto la
            // congela al presentarse para que cambiar la categoría después no
            // reescriba la liquidación.
            'treatment_snapshot' => 'carrier_deduction',
            'status' => 'submitted',
            'submitted_by_user_id' => $this->scenario->user(Role::Dispatcher)->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        documentoDeSistema($this->scenario, 'receipt', 'expense', $gastoId);
    });

    signIn($this->scenario, Role::Admin);

    $this->get('/documents?owner=expense')
        ->assertOk()
        ->assertInertia(function (Assert $p) use ($gastoId) {
            $props = $p->toArray()['props'];

            expect($props['owners']["expense:{$gastoId}"] ?? null)
                ->toBe('Peaje del corredor de Illinois');
        });
});

it('ninguna fila de la lista se queda sin rótulo ni sin nombre', function () {
    $carga = $this->scenario->load;

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($carga) {
        // Uno de cada dueño que la aplicación escribe por su cuenta.
        documentoDeSistema($this->scenario, 'rate_confirmation', 'load', (string) $carga->id);
        documentoDeSistema($this->scenario, 'certificate_of_insurance', 'carrier', (string) $this->scenario->assignedCarrier->id);
    });

    signIn($this->scenario, Role::Admin);

    $this->get('/documents')
        ->assertOk()
        ->assertInertia(function (Assert $p) {
            $props = $p->toArray()['props'];

            $tipos = json_decode((string) file_get_contents(base_path('lang/es/documents.json')), true);

            foreach ($props['documents']['data'] as $fila) {
                expect($tipos['types'][$fila['documentType']] ?? null)->toBeString(
                    "El tipo «{$fila['documentType']}» saldría en pantalla como documents.types.{$fila['documentType']}.",
                );

                expect($tipos['owners'][$fila['ownerType']] ?? null)->toBeString(
                    "El dueño «{$fila['ownerType']}» saldría como documents.owners.{$fila['ownerType']}.",
                );

                expect($props['owners'][$fila['ownerKey']] ?? null)->toBeString(
                    "El dueño de {$fila['ownerKey']} no tiene nombre: la celda enseña un guion.",
                );
            }
        });
});

/* ── El filtro alcanza lo que la lista enseña ────────────────────────────── */

it('el desplegable de dueño ofrece los nueve, no cuatro', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/documents')
        ->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('ownerTypes', DocumentOwners::all()));
});

it('filtrar por carga devuelve solo los de carga', function () {
    $carga = $this->scenario->load;

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($carga) {
        documentoDeSistema($this->scenario, 'rate_confirmation', 'load', (string) $carga->id);
        documentoDeSistema($this->scenario, 'certificate_of_insurance', 'carrier', (string) $this->scenario->assignedCarrier->id);
    });

    signIn($this->scenario, Role::Admin);

    // El filtro se descartaba en silencio para todo lo que no fuera uno de los
    // cuatro de siempre: se elegía «Carga» y salía la lista entera.
    $this->get('/documents?owner=load')
        ->assertOk()
        ->assertInertia(function (Assert $p) {
            $filas = $p->toArray()['props']['documents']['data'];

            expect($filas)->not->toBeEmpty();

            foreach ($filas as $fila) {
                expect($fila['ownerType'])->toBe('load');
            }
        });
});

/* ── La puerta que este arreglo NO abre ──────────────────────────────────── */

it('nadie puede subir a mano una confirmación de tarifa', function () {
    // Los cinco tipos nuevos son del SISTEMA. Si se hubieran añadido como
    // PERSONA, este POST pasaría y RateConfirmation::estado() —que busca por
    // document_type— daría por aceptada una tarifa contra un fichero cualquiera.
    signIn($this->scenario, Role::Dispatcher);

    $this->post("/loads/{$this->scenario->load->id}/documents", [
        'document_type' => 'rate_confirmation',
        'file' => UploadedFile::fake()->create('trampa.pdf', 10, 'application/pdf'),
    ])->assertSessionHasErrors('document_type');
});

it('tampoco por el formulario genérico', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/documents', [
        'owner_type' => 'load',
        'owner_id' => (string) $this->scenario->load->id,
        'document_type' => 'permit',
        'file' => UploadedFile::fake()->create('trampa.pdf', 10, 'application/pdf'),
    ])->assertSessionHasErrors('document_type');
});

it('ni un tipo que no es de ese dueño', function () {
    // La puerta vieja preguntaba solo «¿existe el tipo?», así que se podía
    // colgar la licencia de un conductor de un camión. Cerrarlo salió gratis al
    // cambiar la pregunta por «¿puede elegirlo una persona para ESTE dueño?».
    // crew() es quien pone camión y conductor: el escenario base no trae
    // equipos porque no todas las pruebas llegan a despachar.
    $this->scenario->crew($this->scenario->load);

    $camion = app(TenantContext::class)->runAs(
        (string) $this->scenario->tenant->id,
        fn () => DB::table('trucks')->where('tenant_id', $this->scenario->tenant->id)->value('id'),
    );

    expect($camion)->not->toBeNull();

    signIn($this->scenario, Role::Admin);

    $this->post('/documents', [
        'owner_type' => 'truck',
        'owner_id' => (string) $camion,
        'document_type' => 'cdl_front',
        'file' => UploadedFile::fake()->create('licencia.pdf', 10, 'application/pdf'),
    ])->assertSessionHasErrors('document_type');
});
