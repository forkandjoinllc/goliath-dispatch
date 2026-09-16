<?php

declare(strict_types=1);

use App\Authorization\ActorFactory;
use App\Enums\Role;
use App\Support\Retention\Holds;
use App\Support\Retention\Sweeper;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

/**
 * Un bloqueo sobre una carga alcanza lo que cuelga de ella.
 *
 * `Holds` lo prometía en su cabecera desde el primer día —«una carga concreta y
 * lo que cuelga de ella», «los papeles, la conversación con el transportista,
 * las horas del viaje, la factura»— y marcaba UNA fila. El resto seguía
 * envejeciendo con `legal_hold = 0` y el barrido lo purgaba en su fecha: el
 * bloqueo protegía la carga y dejaba borrar la prueba.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    config(['retention.purge_enabled' => false]);
});

afterEach(fn () => app(TenantContext::class)->forget());

function actorBloqueo(Scenario $s): App\Authorization\Actor
{
    app(TenantContext::class)->set((string) $s->tenant->id);

    return app(ActorFactory::class)->for($s->user(Role::Admin)->fresh(), (string) $s->tenant->id);
}

/**
 * Cuelga de la carga una de cada cosa que la cabecera promete proteger.
 *
 * @return array<string, string> tabla => id
 */
function loQueCuelgaDeLaCarga(Scenario $s): array
{
    $t = (string) $s->tenant->id;
    $carga = (string) $s->load->id;
    $ahora = now();
    $ids = [];

    return app(TenantContext::class)->runAs($t, function () use ($t, $carga, $ahora, $s, &$ids): array {
        // La conversación con el transportista, y su mensaje.
        $ids['conversations'] = (string) Str::uuid();
        DB::table('conversations')->insert([
            'id' => $ids['conversations'], 'tenant_id' => $t, 'load_id' => $carga,
            'subject' => 'Detención en destino', 'kind' => 'load',
            'created_at' => $ahora, 'updated_at' => $ahora,
        ]);

        $ids['messages'] = (string) Str::uuid();
        DB::table('messages')->insert([
            'id' => $ids['messages'], 'tenant_id' => $t, 'conversation_id' => $ids['conversations'],
            'sender_user_id' => $s->user(Role::Dispatcher)->id, 'body' => 'Llevamos cuatro horas parados.',
            'created_at' => $ahora, 'updated_at' => $ahora,
        ]);

        // Las horas del viaje.
        $ids['tracking_events'] = (string) Str::uuid();
        DB::table('tracking_events')->insert([
            'id' => $ids['tracking_events'], 'tenant_id' => $t, 'load_id' => $carga,
            'provider' => 'manual', 'event_type' => 'arrived_delivery',
            'occurred_at' => $ahora, 'ingested_at' => $ahora,
            'created_at' => $ahora, 'updated_at' => $ahora,
        ]);

        // La factura.
        $ids['invoices'] = (string) Str::uuid();
        DB::table('invoices')->insert([
            'id' => $ids['invoices'], 'tenant_id' => $t, 'load_id' => $carga,
            'customer_id' => $s->load->customer_id, 'carrier_id' => $s->load->carrier_id,
            'invoice_number' => 'INV-BLOQ-1',
            'status' => 'draft', 'issue_date' => $ahora->toDateString(), 'due_date' => $ahora->toDateString(),
            'subtotal_cents' => 100000, 'total_cents' => 100000, 'balance_cents' => 100000,
            'created_at' => $ahora, 'updated_at' => $ahora,
        ]);

        // El papel colgado de la carga.
        $ids['documents'] = (string) Str::uuid();
        DB::table('documents')->insert([
            'id' => $ids['documents'], 'tenant_id' => $t,
            'owner_type' => 'load', 'owner_id' => $carga,
            'document_type' => 'pod', 'title' => 'Comprobante de entrega',
            'uploaded_by_user_id' => $s->user(Role::Dispatcher)->id,
            'created_at' => $ahora, 'updated_at' => $ahora,
        ]);

        return $ids;
    });
}

/** @return array<string, int> tabla => legal_hold de su fila */
function marcasDe(Scenario $s, array $ids): array
{
    return app(TenantContext::class)->runAs((string) $s->tenant->id, function () use ($ids): array {
        $out = [];

        foreach ($ids as $tabla => $id) {
            $out[$tabla] = (int) DB::table($tabla)->where('id', $id)->value('legal_hold');
        }

        return $out;
    });
}

it('un bloqueo sobre la carga marca lo que cuelga de ella', function (): void {
    // ESTE ES EL FALLO. Antes: la carga a 1 y las cinco filas a 0.
    $ids = loQueCuelgaDeLaCarga($this->scenario);
    $actor = actorBloqueo($this->scenario);

    Holds::apply($actor, 'Reclamación', 'Daño en tránsito, el cliente reclama.', 'record', 'loads', (string) $this->scenario->load->id);

    expect(marcasDe($this->scenario, $ids))->toBe([
        'conversations' => 1,
        'messages' => 1,
        'tracking_events' => 1,
        'invoices' => 1,
        'documents' => 1,
    ]);

    expect((int) DB::table('loads')->where('id', $this->scenario->load->id)->value('legal_hold'))->toBe(1);
});

it('lo que no cuelga de esta carga no se marca', function (): void {
    // El bloqueo tiene que alcanzar hacia abajo y pararse. Marcar de más deja
    // a la empresa sin poder purgar nada y con un cumplimiento que no cumple.
    //
    // Los tres vecinos que se plantan aquí son los tres que un recorrido
    // descuidado se llevaría por delante: una conversación sin carga, un papel
    // del TRANSPORTISTA —mismo tipo de tabla, otro dueño— y un aviso cuyo
    // `subject_id` es el id de la carga pero cuyo `subject_type` no es «load».
    $ids = loQueCuelgaDeLaCarga($this->scenario);
    $actor = actorBloqueo($this->scenario);
    $t = (string) $this->scenario->tenant->id;
    $carga = (string) $this->scenario->load->id;

    $vecinos = app(TenantContext::class)->runAs($t, function () use ($t, $carga): array {
        $ajenos = [];

        $ajenos['conversations'] = (string) Str::uuid();
        DB::table('conversations')->insert([
            'id' => $ajenos['conversations'], 'tenant_id' => $t, 'load_id' => null,
            'subject' => 'Hilo suelto', 'kind' => 'direct',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $ajenos['documents'] = (string) Str::uuid();
        DB::table('documents')->insert([
            'id' => $ajenos['documents'], 'tenant_id' => $t,
            'owner_type' => 'carrier', 'owner_id' => (string) DB::table('carriers')->value('id'),
            'document_type' => 'certificate_of_insurance', 'title' => 'Seguro del transportista',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $ajenos['notifications'] = (string) Str::uuid();
        DB::table('notifications')->insert([
            'id' => $ajenos['notifications'], 'tenant_id' => $t,
            'user_id' => DB::table('users')->value('id'),
            'event_key' => 'document.expiring', 'channel' => 'in_app', 'locale' => 'es',
            'title' => 'Otro asunto', 'body' => 'Cuerpo', 'status' => 'sent',
            // El MISMO id, otro tipo: si el recorrido ignora `subject_type`,
            // esto se marca y el aviso de un documento queda bloqueado por una
            // reclamación sobre una carga con la que no tiene nada que ver.
            'subject_type' => 'document', 'subject_id' => $carga,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return $ajenos;
    });

    Holds::apply($actor, 'Reclamación', 'Daño en tránsito, el cliente reclama.', 'record', 'loads', $carga);

    expect(marcasDe($this->scenario, $vecinos))->toBe([
        'conversations' => 0,
        'documents' => 0,
        'notifications' => 0,
    ]);

    expect(marcasDe($this->scenario, $ids)['conversations'])->toBe(1);
});

it('levantar el bloqueo libera también lo que colgaba', function (): void {
    $ids = loQueCuelgaDeLaCarga($this->scenario);
    $actor = actorBloqueo($this->scenario);

    $bloqueo = Holds::apply($actor, 'Reclamación', 'Daño en tránsito, el cliente reclama.', 'record', 'loads', (string) $this->scenario->load->id);

    expect(Holds::release($actor, $bloqueo, 'Se cerró el expediente sin reclamación.'))->toBeTrue();

    expect(marcasDe($this->scenario, $ids))->toBe([
        'conversations' => 0,
        'messages' => 0,
        'tracking_events' => 0,
        'invoices' => 0,
        'documents' => 0,
    ]);
});

it('dos bloqueos sobre la misma carga: levantar uno no desprotege lo que cuelga', function (): void {
    // La reconstrucción al levantar ya existía para las filas raíz. Si no
    // recorriera también lo que cuelga, cerrar la reclamación del cliente
    // dejaría los papeles sueltos frente a la del seguro.
    $ids = loQueCuelgaDeLaCarga($this->scenario);
    $actor = actorBloqueo($this->scenario);
    $carga = (string) $this->scenario->load->id;

    $cliente = Holds::apply($actor, 'Cliente', 'Reclamación del cliente sobre la detención.', 'record', 'loads', $carga);
    Holds::apply($actor, 'Seguro', 'El seguro abrió expediente por el mismo viaje.', 'record', 'loads', $carga);

    Holds::release($actor, $cliente, 'El cliente retiró su reclamación.');

    expect(marcasDe($this->scenario, $ids))->toBe([
        'conversations' => 1,
        'messages' => 1,
        'tracking_events' => 1,
        'invoices' => 1,
        'documents' => 1,
    ]);
});

it('el barrido no purga la prueba de una carga bloqueada', function (): void {
    // La consecuencia, medida donde duele: con la purga encendida y todo
    // vencido, el barrido se los saltaba a todos menos la carga.
    $ids = loQueCuelgaDeLaCarga($this->scenario);
    $actor = actorBloqueo($this->scenario);
    $viejo = CarbonImmutable::now()->subYears(9);

    Holds::apply($actor, 'Reclamación', 'Daño en tránsito, el cliente reclama.', 'record', 'loads', (string) $this->scenario->load->id);

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($ids, $viejo): void {
        foreach ($ids as $tabla => $id) {
            DB::table($tabla)->where('id', $id)->update([
                'archived_at' => $viejo,
                'purge_eligible_at' => $viejo,
                'updated_at' => now(),
            ]);
        }
    });

    config(['retention.purge_enabled' => true]);

    Sweeper::purge(app(App\Support\Storage\DocumentStore::class), (string) $this->scenario->tenant->id);

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($ids): void {
        foreach ($ids as $tabla => $id) {
            expect(DB::table($tabla)->where('id', $id)->exists())
                ->toBeTrue("el barrido se llevó la prueba de «{$tabla}»");
        }
    });
});

/* ── La tabla que no admite que le escriban ──────────────────────────────── */

/**
 * Una fila de auditoría de firma, vieja, que es la que reventaba.
 *
 * `signature_audit_events` lleva un `before update` sin condición. Mientras la
 * tabla estuvo vacía no se notaba: un `update` que no toca ninguna fila no
 * dispara el disparador.
 */
function auditoriaDeFirmaVieja(Scenario $s): string
{
    return app(TenantContext::class)->runAs((string) $s->tenant->id, function () use ($s): string {
        $viejo = CarbonImmutable::now()->subYears(4);
        $solicitud = (string) Str::uuid();

        $plantillaId = (string) Str::uuid();

        DB::table('signature_templates')->insert([
            'id' => $plantillaId, 'tenant_id' => (string) $s->tenant->id,
            'template_key' => 'carrier_agreement', 'version' => 1,
            'title_en' => 'Carrier agreement', 'title_es' => 'Acuerdo de transportista',
            'body_en' => 'Body', 'body_es' => 'Cuerpo',
            'consent_copy_en' => 'Consent', 'consent_copy_es' => 'Consentimiento',
            'content_hash' => hash('sha256', $plantillaId),
            'created_at' => $viejo, 'updated_at' => $viejo,
        ]);

        DB::table('signature_requests')->insert([
            'id' => $solicitud, 'tenant_id' => (string) $s->tenant->id,
            'template_id' => $plantillaId, 'template_version' => 1,
            'template_content_hash' => hash('sha256', $plantillaId),
            'subject_type' => 'carrier', 'subject_id' => (string) DB::table('carriers')->value('id'),
            'status' => 'pending', 'signer_email' => 'firmante@example.test',
            'requested_at' => $viejo, 'created_at' => $viejo, 'updated_at' => $viejo,
        ]);

        $id = (string) Str::uuid();

        DB::table('signature_audit_events')->insert([
            'id' => $id, 'tenant_id' => (string) $s->tenant->id, 'request_id' => $solicitud,
            'event_type' => 'requested', 'event_hash' => hash('sha256', $id),
            'occurred_at' => $viejo, 'created_at' => $viejo, 'updated_at' => $viejo,
        ]);

        return $id;
    });
}

it('el barrido no revienta con una auditoría de firma vencida', function (): void {
    // A los dos años de funcionamiento, el barrido nocturno intentaba archivar
    // esta fila y el disparador abortaba la transacción entera, arrastrando lo
    // que llevara hecho. No es un caso raro: es el estado garantizado de
    // cualquier instalación que lleve tiempo.
    auditoriaDeFirmaVieja($this->scenario);

    $resumen = Sweeper::archive((string) $this->scenario->tenant->id);

    expect($resumen)->not->toHaveKey('signature_audit_events');
});

it('levantar un bloqueo no revienta con una auditoría de firma', function (): void {
    // Y esto reventaba SIN esperar dos años: `rebuild()` limpia las veintiuna
    // tablas, y basta una sola fila de auditoría de firma para que levantar
    // cualquier bloqueo aborte.
    auditoriaDeFirmaVieja($this->scenario);
    $actor = actorBloqueo($this->scenario);

    $bloqueo = Holds::apply($actor, 'Citación', 'Citación amplia, todavía no se sabe qué piden.', 'tenant');

    expect(Holds::release($actor, $bloqueo, 'Se cerró el expediente sin reclamación.'))->toBeTrue();
});

it('un bloqueo de toda la empresa tampoco revienta', function (): void {
    auditoriaDeFirmaVieja($this->scenario);
    $actor = actorBloqueo($this->scenario);

    Holds::apply($actor, 'Citación', 'Citación amplia, todavía no se sabe qué piden.', 'tenant');

    expect((int) DB::table('loads')->where('id', $this->scenario->load->id)->value('legal_hold'))->toBe(1);

    // Y la fila que no se puede marcar se queda a cero, que es lo honesto: no
    // se purga nunca, así que no hay nada que proteger en ella.
    expect((int) DB::table('signature_audit_events')->where('tenant_id', $this->scenario->tenant->id)->value('legal_hold'))->toBe(0);
});
