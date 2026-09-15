<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Documents\DocumentAudience;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Artisan;
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
 * El aviso de vencimiento le llega a quien tiene que renovar el papel.
 *
 * El guardián de `tests/Unit/Suite/ExpiryAudienceTest.php` sujeta la estructura.
 * Esto corre el barrido de verdad y cuenta filas en `notifications`: quién
 * recibió qué. Es la comprobación que importa porque el defecto era un silencio
 * — y un silencio se parece muchísimo a que no haya pasado nada.
 */
function conductorConUsuario(Scenario $s, ?string $carrierId = null, string $estado = 'active'): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $carrierId, $estado): string {
        $driverId = (string) Str::uuid();

        DB::table('drivers')->insert([
            'id' => $driverId,
            'tenant_id' => $s->tenant->id,
            'first_name' => 'Eduardo',
            'last_name' => 'Salas',
            'license_state' => 'TX',
            'license_number_hash' => hash('sha256', Str::random(16)),
            'license_number_last4' => '0042',
            'cdl_class' => 'A',
            'license_expires_at' => now()->addYear(),
            'medical_card_expires_at' => now()->addYear(),
            'status' => 'available',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // La afiliación al transportista: es por donde `carrierOf()` llega al
        // dueño de un documento de conductor.
        DB::table('driver_carrier_relationships')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $s->tenant->id,
            'driver_id' => $driverId,
            'carrier_id' => $carrierId ?? $s->assignedCarrier->id,
            'is_primary' => true,
            'start_date' => now()->subYear()->toDateString(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('user_tenant_memberships')
            ->where('tenant_id', $s->tenant->id)
            ->where('user_id', $s->user(Role::Driver)->id)
            ->update(['driver_id' => $driverId, 'status' => $estado]);

        return $driverId;
    });
}

/** Un documento con vencimiento, del dueño que se diga. */
function papelQueVence(Scenario $s, string $ownerType, string $ownerId, string $tipo = 'certificate_of_insurance'): string
{
    $id = (string) Str::uuid();

    DB::table('documents')->insert([
        'id' => $id,
        'tenant_id' => $s->tenant->id,
        'document_type' => $tipo,
        'owner_type' => $ownerType,
        'owner_id' => $ownerId,
        'title' => 'Papel que vence',
        'review_status' => 'approved',
        'expiration_date' => now()->addDays(5)->toDateString(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

/**
 * El barrido, con nombre propio de este lote.
 *
 * Los ayudantes de Pest son funciones GLOBALES: `barrer()` ya existía en
 * `SweepTest`, y la suite entera se cayó con «Cannot redeclare». Es la tercera
 * vez que me pasa en este proyecto y por eso los ayudantes llevan apellido.
 */
function barrerCaducidad(): void
{
    Artisan::call('notifications:sweep');
}

/** @return Collection<int, object> */
function avisosDeCaducidad(Scenario $s, string $userId)
{
    return app(TenantContext::class)->runAs($s->tenant->id, fn () => DB::table('notifications')
        ->where('tenant_id', $s->tenant->id)
        ->where('user_id', $userId)
        ->whereIn('event_key', ['document.expiring', 'document.expired'])
        ->where('channel', 'in_app')
        ->get(['id', 'event_key', 'action_url', 'body']));
}

/* ── A quién le llega ──────────────────────────────────────────────────── */

it('al conductor le llega el vencimiento de SU licencia', function () {
    $driverId = conductorConUsuario($this->scenario);
    papelQueVence($this->scenario, 'driver', $driverId, 'medical_card');

    barrerCaducidad();

    $avisos = avisosDeCaducidad($this->scenario, (string) $this->scenario->user(Role::Driver)->id);

    // Esto es lo que no pasaba. El formulario le decía «se le avisará 30 días
    // antes» y no había ningún camino por el que le llegara.
    expect($avisos)->toHaveCount(1);

    // Y al papel, no a la lista filtrada: quien tiene que renovarlo necesita
    // ver ESE documento.
    expect($avisos->first()->action_url)->toStartWith('/documents/');
});

it('al transportista le llega el vencimiento de su seguro', function () {
    papelQueVence($this->scenario, 'carrier', (string) $this->scenario->assignedCarrier->id);

    barrerCaducidad();

    expect(avisosDeCaducidad($this->scenario, (string) $this->scenario->user(Role::Carrier)->id))
        ->toHaveCount(1);
});

it('la licencia de un conductor avisa a los dos: a él y a su transportista', function () {
    $driverId = conductorConUsuario($this->scenario);
    papelQueVence($this->scenario, 'driver', $driverId, 'medical_card');

    barrerCaducidad();

    // Los dos, y por motivos distintos: la renueva él, y el transportista es
    // quien no puede mandarlo a rodar sin ella.
    expect(avisosDeCaducidad($this->scenario, (string) $this->scenario->user(Role::Driver)->id))->toHaveCount(1);
    expect(avisosDeCaducidad($this->scenario, (string) $this->scenario->user(Role::Carrier)->id))->toHaveCount(1);
});

it('la oficina sigue recibiendo el suyo', function () {
    papelQueVence($this->scenario, 'carrier', (string) $this->scenario->assignedCarrier->id);

    barrerCaducidad();

    // El aviso del dueño se AÑADE. Un lote que le da la noticia al dueño y se
    // la quita a quien lleva el cumplimiento cambia un agujero por otro.
    expect(avisosDeCaducidad($this->scenario, (string) $this->scenario->user(Role::Admin)->id))
        ->toHaveCount(1);
    expect(avisosDeCaducidad($this->scenario, (string) $this->scenario->user(Role::Accounting)->id))
        ->toHaveCount(1);
});

it('el papel de una carga no sale de la oficina', function () {
    papelQueVence($this->scenario, 'load', (string) $this->scenario->load->id, 'pod');

    barrerCaducidad();

    // El transportista no ve los documentos de una carga desde la pantalla de
    // documentos —lo dice `DocumentScope`—, así que avisarle de ellos sería una
    // campana que suena para nada.
    expect(avisosDeCaducidad($this->scenario, (string) $this->scenario->user(Role::Carrier)->id))
        ->toHaveCount(0);
    expect(avisosDeCaducidad($this->scenario, (string) $this->scenario->user(Role::Admin)->id))
        ->toHaveCount(1);
});

it('no le llega al transportista de al lado', function () {
    // El seguro del transportista del escenario; el conductor cuelga de OTRO.
    $otro = app(TenantContext::class)->runAs($this->scenario->tenant->id, fn (): string => (string) $this->scenario->otherCarrier->id);

    papelQueVence($this->scenario, 'carrier', $otro);

    barrerCaducidad();

    // La vía del dueño existe para saltarse la regla de «alcance de empresa o
    // más». Saltársela mal es contarle a un transportista lo del vecino.
    expect(avisosDeCaducidad($this->scenario, (string) $this->scenario->user(Role::Carrier)->id))
        ->toHaveCount(0);
});

it('a un conductor con la afiliación suspendida no se le avisa', function () {
    $driverId = conductorConUsuario($this->scenario, null, 'suspended');
    $doc = papelQueVence($this->scenario, 'driver', $driverId, 'medical_card');

    barrerCaducidad();

    // Es el escape que se me ha colado tres veces en este proyecto: la vía
    // nueva mira la afiliación, y a quien ya no trabaja aquí no se le avisa de
    // nada.
    expect(avisosDeCaducidad($this->scenario, (string) $this->scenario->user(Role::Driver)->id))
        ->toHaveCount(0);

    // Y se le pregunta a la pieza directamente. Sin esto la prueba pasaba
    // igual con el filtro quitado, porque `Notifier::toOwner` vuelve a mirar la
    // afiliación y tapaba el agujero: dos mecanismos que se cubren el uno al
    // otro dan un resultado correcto por accidente, y el accidente se acaba.
    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($doc): void {
        $fila = DB::table('documents')->where('id', $doc)->first(['owner_type', 'owner_id', 'tenant_id']);

        expect(DocumentAudience::personaDe($fila))->toBeNull();
    });
});

it('la licencia del conductor del vecino no avisa a mi transportista', function () {
    // PRIMERO un conductor del transportista del escenario, para que la tabla
    // puente tenga DOS filas. Con una sola, una consulta sin `where` devuelve
    // igualmente la correcta y el sabotaje pasa desapercibido — que es
    // exactamente lo que me pasó.
    conductorConUsuario($this->scenario);

    // Y ahora el conductor del OTRO transportista, cuyo papel vence.
    $driverId = conductorConUsuario($this->scenario, (string) $this->scenario->otherCarrier->id);
    papelQueVence($this->scenario, 'driver', $driverId, 'medical_card');

    barrerCaducidad();

    // `carrierOf()` resuelve el conductor por la tabla puente. Un sabotaje que
    // le quitó el `where('driver_id', …)` devolvía el primer transportista de
    // la tabla y ninguna de mis pruebas se puso roja: todas plantaban un solo
    // puente.
    expect(avisosDeCaducidad($this->scenario, (string) $this->scenario->user(Role::Carrier)->id))
        ->toHaveCount(0);

    // Y el conductor sí se entera: es su licencia, cuelgue de quien cuelgue.
    expect(avisosDeCaducidad($this->scenario, (string) $this->scenario->user(Role::Driver)->id))
        ->toHaveCount(1);
});

it('dos barridos seguidos no avisan dos veces', function () {
    $driverId = conductorConUsuario($this->scenario);
    papelQueVence($this->scenario, 'driver', $driverId, 'medical_card');

    barrerCaducidad();
    barrerCaducidad();

    // La clave de deduplicación es la misma para los dos lados, y el índice
    // único es (clave, usuario, canal).
    expect(avisosDeCaducidad($this->scenario, (string) $this->scenario->user(Role::Driver)->id))
        ->toHaveCount(1);
});

/* ── Lo que promete la pantalla ────────────────────────────────────────── */

it('al transportista el formulario le promete el aviso de los cuatro', function () {
    signIn($this->scenario, Role::Carrier);

    $this->get('/documents/upload')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('notifiedOwners', ['carrier', 'driver', 'truck', 'trailer']));
});

it('al despachador el formulario no le promete nada', function () {
    signIn($this->scenario, Role::Dispatcher);

    // Alcance ASIGNADO: no entra en `recipients()`, y meterlo exigiría resolver
    // por documento si ese transportista es de los suyos. Queda declarado en
    // `DocumentAudience::SIN_AVISO_HOY` — y la pantalla lo respeta, que es lo
    // que separa una deuda de una mentira.
    $this->get('/documents/upload')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('notifiedOwners', []));
});

it('al conductor el formulario le promete solo lo suyo', function () {
    conductorConUsuario($this->scenario);
    signIn($this->scenario, Role::Driver);

    $this->get('/documents/upload')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('notifiedOwners', ['driver']));
});
