<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Documents\DocumentTypes;
use App\Support\Loads\Guards;
use App\Support\Onboarding\Readiness;
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

/** Aprueba un documento obligatorio del transportista. */
function documentoAprobadoDeTransportista(Scenario $scenario, string $tipo, mixed $caduca = null): string
{
    $id = (string) Str::uuid();

    DB::table('documents')->insert([
        'id' => $id,
        'tenant_id' => $scenario->tenant->id,
        'document_type' => $tipo,
        'owner_type' => 'carrier',
        'owner_id' => $scenario->assignedCarrier->id,
        'title' => $tipo,
        'review_status' => 'approved',
        'expiration_date' => $caduca,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

/** Pone al transportista del escenario en un estado de incorporación. */
function estadoDeIncorporacion(Scenario $scenario, string $estado): void
{
    DB::table('carriers')->where('id', $scenario->assignedCarrier->id)->update([
        'onboarding_status' => $estado,
        'approved_at' => $estado === 'approved' ? now() : null,
        'updated_at' => now(),
    ]);
}

/* ── Lo que falta, calculado ────────────────────────────────────────────── */

it('la cola y la puerta de despacho contestan lo mismo', function () {
    // Es la razón de que `Readiness` llame a `Guards` en vez de reimplementar:
    // si discreparan, quien lleva cumplimiento confiaría en la que se equivoque.
    estadoDeIncorporacion($this->scenario, 'draft');

    $deLaPuerta = Guards::carrierBlocking((string) $this->scenario->assignedCarrier->id);
    $deLaCola = Readiness::forCarrier(
        (string) $this->scenario->tenant->id,
        (string) $this->scenario->assignedCarrier->id,
    );

    $reconstruido = [
        ...$deLaCola['blocking'],
        ...array_map(static fn (string $d): string => 'missingDocument:'.$d, $deLaCola['missingDocuments']),
    ];

    sort($deLaPuerta);
    sort($reconstruido);

    expect($reconstruido)->toBe($deLaPuerta);
});

it('nombra cada documento que falta, no «faltan documentos»', function () {
    estadoDeIncorporacion($this->scenario, 'approved');

    $estado = Readiness::forCarrier(
        (string) $this->scenario->tenant->id,
        (string) $this->scenario->assignedCarrier->id,
    );

    expect($estado['missingDocuments'])->toContain('certificate_of_insurance');
    expect($estado['missingDocuments'])->toContain('certificate_of_authority');
    expect($estado['missingDocuments'])->toContain('carrier_agreement');
});

it('un documento vencido cuenta como que falta', function () {
    estadoDeIncorporacion($this->scenario, 'approved');

    documentoAprobadoDeTransportista($this->scenario, 'certificate_of_insurance', now()->subDay());

    $estado = Readiness::forCarrier(
        (string) $this->scenario->tenant->id,
        (string) $this->scenario->assignedCarrier->id,
    );

    // Vencido no es «lo tiene». Un seguro caducado es no tener seguro.
    expect($estado['missingDocuments'])->toContain('certificate_of_insurance');
    expect($estado['approvedDocuments'])->not->toContain('certificate_of_insurance');
});

it('un documento pendiente de revisión tampoco cuenta', function () {
    estadoDeIncorporacion($this->scenario, 'approved');

    DB::table('documents')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'document_type' => 'certificate_of_insurance',
        'owner_type' => 'carrier',
        'owner_id' => $this->scenario->assignedCarrier->id,
        'review_status' => 'pending',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $estado = Readiness::forCarrier(
        (string) $this->scenario->tenant->id,
        (string) $this->scenario->assignedCarrier->id,
    );

    // Que alguien haya subido un PDF no significa que nadie lo haya mirado.
    expect($estado['missingDocuments'])->toContain('certificate_of_insurance');
});

it('separa lo que bloquea de lo que solo avisa', function () {
    estadoDeIncorporacion($this->scenario, 'draft');

    $estado = Readiness::forCarrier(
        (string) $this->scenario->tenant->id,
        (string) $this->scenario->assignedCarrier->id,
    );

    // Bloquea: la incorporación no está aprobada.
    expect($estado['blocking'])->toContain('carrierNotApproved');
    // Avisa: nunca se ha comprobado en FMCSA. No es lo mismo y no se mezcla.
    expect($estado['warnings'])->toContain('fmcsaNeverChecked');
});

it('distingue «nunca comprobado» de «comprobado hace mucho»', function () {
    $tenantId = (string) $this->scenario->tenant->id;
    $carrierId = (string) $this->scenario->assignedCarrier->id;

    expect(Readiness::forCarrier($tenantId, $carrierId)['warnings'])->toContain('fmcsaNeverChecked');

    DB::table('fmcsa_verifications')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $tenantId,
        'carrier_id' => $carrierId,
        'dot_number' => '1234567',
        'status' => 'verified',
        'checked_at' => now()->subYears(2),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $estado = Readiness::forCarrier($tenantId, $carrierId);

    // Una tarea que nadie empezó y una que se dejó de hacer no son lo mismo.
    expect($estado['warnings'])->toContain('fmcsaStale');
    expect($estado['warnings'])->not->toContain('fmcsaNeverChecked');
    expect($estado['fmcsaCheckedAt'])->not->toBeNull();
});

it('no guarda ninguna lista de comprobación', function () {
    // `carrier_onboardings.checklist` existe y este servicio NO la escribe:
    // una lista guardada dice «listo» el día que se guardó y sigue diciéndolo
    // el día que caduca el seguro.
    estadoDeIncorporacion($this->scenario, 'approved');

    Readiness::forCarrier(
        (string) $this->scenario->tenant->id,
        (string) $this->scenario->assignedCarrier->id,
    );

    $checklist = DB::table('carrier_onboardings')
        ->where('carrier_id', $this->scenario->assignedCarrier->id)
        ->value('checklist');

    expect($checklist === null || $checklist === '[]')->toBeTrue();
});

/* ── La cola ────────────────────────────────────────────────────────────── */

it('la cola trae a los transportistas de la empresa', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/onboarding')->assertOk()->assertInertia(function (Assert $p) {
        $ids = collect($p->toArray()['props']['carriers'])->pluck('id')->all();

        expect($ids)->toContain((string) $this->scenario->assignedCarrier->id);
    });
});

it('no trae los de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    signIn($this->scenario, Role::Admin);

    $this->get('/onboarding')->assertInertia(function (Assert $p) use ($otra) {
        $ids = collect($p->toArray()['props']['carriers'])->pluck('id')->all();

        expect($ids)->not->toContain((string) $otra->assignedCarrier->id);
    });
});

it('encuentra al aprobado que ya no puede llevar carga', function () {
    // El caso que esta pantalla existe para encontrar: aprobado en marzo, se le
    // venció el seguro en julio, sigue en `approved` y ninguna lista por estado
    // lo enseña — y sin embargo su camión no sale.
    estadoDeIncorporacion($this->scenario, 'approved');

    documentoAprobadoDeTransportista($this->scenario, 'certificate_of_authority');
    documentoAprobadoDeTransportista($this->scenario, 'carrier_agreement');
    documentoAprobadoDeTransportista($this->scenario, 'certificate_of_insurance', now()->subMonth());

    signIn($this->scenario, Role::Admin);

    $this->get('/onboarding')->assertOk()->assertInertia(function (Assert $p) {
        $bloqueados = $p->toArray()['props']['blockedApproved'];

        expect($bloqueados)->toHaveCount(1);
        expect($bloqueados[0]['id'])->toBe((string) $this->scenario->assignedCarrier->id);
        expect($bloqueados[0]['status'])->toBe('approved');
        expect($bloqueados[0]['canHaul'])->toBeFalse();
        expect($bloqueados[0]['missingDocuments'])->toContain('certificate_of_insurance');
    });
});

it('un aprobado con todo al día no sale como bloqueado', function () {
    estadoDeIncorporacion($this->scenario, 'approved');

    foreach (['certificate_of_authority', 'carrier_agreement', 'certificate_of_insurance'] as $tipo) {
        documentoAprobadoDeTransportista($this->scenario, $tipo, now()->addYear());
    }

    signIn($this->scenario, Role::Admin);

    $this->get('/onboarding')->assertInertia(function (Assert $p) {
        expect($p->toArray()['props']['blockedApproved'])->toBe([]);

        $fila = collect($p->toArray()['props']['carriers'])
            ->firstWhere('id', (string) $this->scenario->assignedCarrier->id);

        expect($fila['canHaul'])->toBeTrue();
    });
});

it('filtra por si puede llevar carga, no por estado', function () {
    // El filtro por estado se fue con el tablero: las columnas SON los estados,
    // así que filtrar por estado era enseñar una sola columna. Lo que el tablero
    // no contesta de un vistazo es quién está atascado.
    estadoDeIncorporacion($this->scenario, 'submitted');

    signIn($this->scenario, Role::Admin);

    $este = (string) $this->scenario->assignedCarrier->id;

    // Sin papeles aprobados no puede llevar carga.
    $this->get('/onboarding?ready=blocked')->assertInertia(function (Assert $p) use ($este) {
        $ids = collect($p->toArray()['props']['carriers'])->pluck('id')->all();
        expect(in_array($este, $ids, true))->toBeTrue();
    });

    $this->get('/onboarding?ready=ready')->assertInertia(function (Assert $p) use ($este) {
        $ids = collect($p->toArray()['props']['carriers'])->pluck('id')->all();
        expect(in_array($este, $ids, true))->toBeFalse();
    });
});

it('un parámetro de filtro inventado no esconde a nadie', function () {
    estadoDeIncorporacion($this->scenario, 'submitted');

    signIn($this->scenario, Role::Admin);

    // Un valor que no está en la lista se ignora y se ve todo. Tratarlo como
    // «no coincide con nada» dejaría el tablero vacío ante una URL vieja, y
    // quien lo mire creerá que no hay transportistas.
    $this->get('/onboarding?ready=loquesea')->assertInertia(function (Assert $p) {
        $ids = collect($p->toArray()['props']['carriers'])->pluck('id')->all();
        expect(in_array((string) $this->scenario->assignedCarrier->id, $ids, true))->toBeTrue();
    });
});

it('dice desde cuándo espera, según su estado', function () {
    DB::table('carriers')->where('id', $this->scenario->assignedCarrier->id)->update([
        'onboarding_status' => 'submitted',
    ]);

    DB::table('carrier_onboardings')->updateOrInsert(
        ['carrier_id' => $this->scenario->assignedCarrier->id],
        [
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'status' => 'submitted',
            'submitted_at' => now()->subDays(4),
            'created_at' => now(),
            'updated_at' => now(),
        ],
    );

    signIn($this->scenario, Role::Admin);

    $this->get('/onboarding')->assertInertia(function (Assert $p) {
        $fila = collect($p->toArray()['props']['carriers'])
            ->firstWhere('id', (string) $this->scenario->assignedCarrier->id);

        // La marca que corresponde a SU estado, no la fecha de alta.
        expect($fila['waitingSince'])->toBe(now()->subDays(4)->format('Y-m-d H:i'));
    });
});

it('cada documento requerido tiene su etiqueta en los dos idiomas', function () {
    // El catálogo portado traía cinco tipos y el catálogo de documentos exige
    // tres, uno de los cuales —`carrier_agreement`— no estaba: la pantalla
    // enseñaba la clave cruda. Esto lo cierra para los que vengan.
    $requeridos = DocumentTypes::forOwner('carrier');

    foreach (['es', 'en'] as $idioma) {
        $diccionario = json_decode(
            (string) file_get_contents(lang_path($idioma.'/onboarding.json')),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        $sinEtiqueta = array_values(array_filter(
            $requeridos,
            static fn (string $tipo): bool => ! isset($diccionario['checklist'][$tipo]),
        ));

        // `other` no es un tipo de incorporación: es el cajón de sastre.
        $sinEtiqueta = array_values(array_diff($sinEtiqueta, ['other']));

        expect($sinEtiqueta)->toBe([]);
    }
});

it('el conductor no entra en la cola', function () {
    signIn($this->scenario, Role::Driver);

    $this->get('/onboarding')->assertForbidden();
});

it('la pantalla se renderiza sin claves crudas', function () {
    estadoDeIncorporacion($this->scenario, 'submitted');

    signIn($this->scenario, Role::Admin);

    $cuerpo = $this->get('/onboarding')->assertOk()->getContent();

    expect($cuerpo)->not->toContain('onboarding.queue.');
    expect($cuerpo)->not->toContain('onboarding.blocking.');
    expect($cuerpo)->not->toContain('onboarding.checklist.');
});
