<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Notifications\Notifier;
use App\Support\TenantContext;
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

/**
 * Al transportista le llega lo suyo, y solo lo suyo.
 *
 * El guardián de `tests/Unit/Suite/CarrierNoticeTest.php` sujeta la estructura.
 * Esto MIDE: planta un segundo transportista con su propio usuario y comprueba
 * que no le llega el aviso del primero. Es la comprobación que importa, porque
 * la vía nueva existe precisamente para saltarse la regla —«alcance de empresa
 * o más»— que hasta ahora impedía que un transportista recibiera nada.
 */
function otroTransportistaConUsuario(Scenario $s): array
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s): array {
        $carrierId = (string) Str::uuid();

        DB::table('carriers')->insert([
            'id' => $carrierId,
            'tenant_id' => $s->tenant->id,
            'legal_name' => 'Vecino LLC',
            'dot_number' => '7900123',
            'contact_first_name' => 'Rosa',
            'contact_last_name' => 'Peña',
            'email' => 'vecino@escenario.test',
            'phone' => '+15550111',
            'preferred_locale' => 'es',
            'onboarding_status' => 'approved',
            'fmcsa_status' => 'not_started',
            'dispatch_fee_bps' => 1000,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $userId = (string) Str::uuid();

        DB::table('users')->insert([
            'id' => $userId,
            'email' => 'rosa@vecino.test',
            'email_normalized' => 'rosa@vecino.test',
            'first_name' => 'Rosa',
            'last_name' => 'Peña',
            'password' => bcrypt('x'),
            'locale' => 'es',
            'status' => 'active',
            'email_verified_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('user_tenant_memberships')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $s->tenant->id,
            'user_id' => $userId,
            'role' => Role::Carrier->value,
            'status' => 'active',
            'carrier_id' => $carrierId,
            'accepted_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return ['carrier' => $carrierId, 'user' => $userId];
    });
}

function documentoDelTransportista(Scenario $s, string $carrierId): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $carrierId): string {
        $id = (string) Str::uuid();

        DB::table('documents')->insert([
            'id' => $id,
            'tenant_id' => $s->tenant->id,
            'document_type' => 'certificate_of_insurance',
            'title' => 'Póliza 2026',
            'owner_type' => 'carrier',
            'owner_id' => $carrierId,
            'review_status' => 'pending',
            'is_required' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // CON su versión, y apuntada desde el documento. Sin ella la revisión
        // revienta —`document_reviews.document_version_id` es NOT NULL, porque
        // una revisión que no dice QUÉ versión miró no significa nada— y mi
        // primer intento de esta prueba plantaba un documento que no puede
        // existir: el fallo parecía del aviso y era del dato.
        $version = (string) Str::uuid();

        DB::table('document_versions')->insert([
            'id' => $version,
            'tenant_id' => $s->tenant->id,
            'document_id' => $id,
            'version_number' => 1,
            'storage_key' => 'tenants/'.$s->tenant->id.'/documents/'.$id.'/1.pdf',
            'original_filename' => 'poliza.pdf',
            'content_type' => 'application/pdf',
            'byte_size' => 1024,
            'sha256' => str_repeat('a', 64),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('documents')->where('id', $id)->update(['current_version_id' => $version]);

        return $id;
    });
}

/**
 * Los avisos escritos para esta persona.
 *
 * Con nombre largo a propósito: `avisosDe()` ya existe en `SweepTest`, y dos
 * ficheros de prueba con la misma función global revientan la suite entera con
 * «Cannot redeclare function» — un fallo que NO aparece al ejecutar este
 * fichero solo. Es la cuarta vez que pasa en este proyecto.
 *
 * @return list<object>
 */
function avisosDelTransportista(Scenario $s, string $userId, string $evento): array
{
    return app(TenantContext::class)->runAs($s->tenant->id, fn (): array => DB::table('notifications')
        ->where('user_id', $userId)
        ->where('event_key', $evento)
        ->get(['id', 'channel', 'body', 'locale'])
        ->all());
}

it('al rechazar un documento se avisa a su transportista', function () {
    $documento = documentoDelTransportista($this->scenario, (string) $this->scenario->assignedCarrier->id);
    $transportista = $this->scenario->user(Role::Carrier);

    signIn($this->scenario, Role::Admin);

    $this->post("/documents/{$documento}/review", [
        'decision' => 'rejected',
        'notes' => 'La póliza vence el mes que viene; mande la renovada.',
    ])->assertSessionHasNoErrors()->assertStatus(302);

    $avisos = avisosDelTransportista($this->scenario, (string) $transportista->id, 'document.rejected');

    expect($avisos)->not->toBe([], 'el transportista no se enteró de que le rechazaron el documento');

    // Y el motivo VA DENTRO. Sin él, el aviso repite el «rechazado a secas» que
    // la pantalla de revisión existe para evitar.
    expect($avisos[0]->body)->toContain('mande la renovada');
});

it('no le llega al transportista de al lado', function () {
    $vecino = otroTransportistaConUsuario($this->scenario);
    $documento = documentoDelTransportista($this->scenario, (string) $this->scenario->assignedCarrier->id);

    signIn($this->scenario, Role::Admin);

    $this->post("/documents/{$documento}/review", [
        'decision' => 'rejected',
        'notes' => 'Falta la firma del titular en la última página.',
    ])->assertSessionHasNoErrors();

    // Esta es LA prueba del lote: la vía nueva existe para saltarse la regla de
    // «alcance de empresa o más», y si filtrara mal, un transportista se
    // enteraría de los documentos de otro.
    expect(avisosDelTransportista($this->scenario, $vecino['user'], 'document.rejected'))->toBe([]);
});

it('aprobar un documento no avisa a nadie', function () {
    $documento = documentoDelTransportista($this->scenario, (string) $this->scenario->assignedCarrier->id);
    $transportista = $this->scenario->user(Role::Carrier);

    signIn($this->scenario, Role::Admin);

    $this->post("/documents/{$documento}/review", ['decision' => 'approved'])
        ->assertSessionHasNoErrors();

    // Una campana que suena con las buenas noticias también deja de mirarse.
    expect(avisosDelTransportista($this->scenario, (string) $transportista->id, 'document.rejected'))->toBe([]);
});

it('pedir correcciones avisa al transportista con sus notas', function () {
    $transportista = $this->scenario->user(Role::Carrier);
    $carrierId = (string) $this->scenario->assignedCarrier->id;

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($carrierId): void {
        DB::table('carriers')->where('id', $carrierId)->update(['onboarding_status' => 'under_review']);
        DB::table('carrier_onboardings')->where('carrier_id', $carrierId)->update(['status' => 'under_review']);
    });

    signIn($this->scenario, Role::Admin);

    $this->post("/carriers/{$carrierId}/onboarding/corrections_required", [
        'reason' => 'El W-9 está a nombre de otra empresa.',
    ])->assertSessionHasNoErrors()->assertStatus(302);

    $avisos = avisosDelTransportista($this->scenario, (string) $transportista->id, 'onboarding.corrections_required');

    expect($avisos)->not->toBe([]);
    expect($avisos[0]->body)->toContain('W-9');
});

it('el aviso sale en el idioma de quien lo recibe', function () {
    $transportista = $this->scenario->user(Role::Carrier);

    app(TenantContext::class)->withoutTenant(function () use ($transportista): void {
        DB::table('users')->where('id', $transportista->id)->update(['locale' => 'en']);
    });

    $documento = documentoDelTransportista($this->scenario, (string) $this->scenario->assignedCarrier->id);

    signIn($this->scenario, Role::Admin);

    $this->post("/documents/{$documento}/review", [
        'decision' => 'rejected',
        'notes' => 'Missing signature.',
    ])->assertSessionHasNoErrors()->assertStatus(302);

    $avisos = avisosDelTransportista($this->scenario, (string) $transportista->id, 'document.rejected');

    expect($avisos)->not->toBe([]);
    expect($avisos[0]->locale)->toBe('en');
    expect($avisos[0]->body)->toContain('was not accepted');
});

it('el transportista ve en sus preferencias lo suyo y nada de la oficina', function () {
    signIn($this->scenario, Role::Carrier);

    $this->get('/notifications')->assertInertia(fn ($page) => $page
        ->where('events', ['document.rejected', 'onboarding.corrections_required']));
});

it('la oficina sigue viendo las suyas', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/notifications')->assertInertia(function ($page) {
        $eventos = $page->toArray()['props']['events'];

        expect($eventos)->toContain('invoice.overdue');
        expect($eventos)->not->toContain('document.rejected');
    });
});

it('a un usuario suspendido del transportista no se le avisa', function () {
    $transportista = $this->scenario->user(Role::Carrier);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($transportista): void {
        DB::table('user_tenant_memberships')
            ->where('user_id', $transportista->id)
            ->update(['status' => 'suspended']);
    });

    $documento = documentoDelTransportista($this->scenario, (string) $this->scenario->assignedCarrier->id);

    signIn($this->scenario, Role::Admin);

    $this->post("/documents/{$documento}/review", [
        'decision' => 'rejected',
        'notes' => 'Le falta la página de firmas.',
    ])->assertSessionHasNoErrors();

    // Suspender a alguien es quitarle el acceso. Seguir mandándole el correo
    // de lo que ya no puede abrir es la mitad peor de las dos.
    expect(avisosDelTransportista($this->scenario, (string) $transportista->id, 'document.rejected'))->toBe([]);
});

it('la vía del transportista no manda nada sin el permiso', function () {
    $transportista = $this->scenario->user(Role::Carrier);

    $escritos = app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn (): int => Notifier::toCarrier(
            tenantId: (string) $this->scenario->tenant->id,
            carrierId: (string) $this->scenario->assignedCarrier->id,
            // El rol transportista NO tiene este permiso: es de la oficina.
            // Sin la comprobación, cualquiera podría dirigirle un aviso sobre
            // algo que no puede ni abrir — y peor, sobre algo que no es suyo.
            permission: 'tenant:settings:read',
            eventKey: 'document.rejected',
            dedupeKey: 'prueba:sin-permiso',
            params: ['title' => 'x', 'reason' => 'y'],
        ),
    );

    expect($escritos)->toBe(0);
    expect(avisosDelTransportista($this->scenario, (string) $transportista->id, 'document.rejected'))->toBe([]);
});
