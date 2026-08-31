<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Signatures\Ceremony;
use App\Support\Signatures\Mailer;
use App\Support\Signatures\Seal;
use App\Support\Signatures\SigningLinks;
use App\Support\Signatures\Templates;
use App\Support\Signatures\Verifier;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => Templates::install(
        (string) $this->scenario->tenant->id,
    ));
});

afterEach(function () {
    app(TenantContext::class)->forget();
});

/** La plantilla vigente de una clave. */
function plantillaVigente(Scenario $scenario, string $clave = 'carrier_agreement'): object
{
    return DB::table('signature_templates')
        ->where('tenant_id', $scenario->tenant->id)
        ->where('template_key', $clave)
        ->where('active', 1)
        ->orderByDesc('version')
        ->first();
}

/** Crea una solicitud directamente y devuelve su token en claro. */
function solicitudDeFirma(Scenario $scenario, ?int $dias = 30, string $clave = 'carrier_agreement'): array
{
    return app(TenantContext::class)->runAs($scenario->tenant->id, fn (): array => SigningLinks::issue(
        tenantId: (string) $scenario->tenant->id,
        plantilla: plantillaVigente($scenario, $clave),
        subjectType: 'carrier',
        subjectId: (string) $scenario->assignedCarrier->id,
        carrierId: (string) $scenario->assignedCarrier->id,
        signerEmail: 'firmante@prueba.test',
        signerLegalName: null,
        locale: 'es',
        tokenValues: [
            'effectiveDate' => '2026-08-30',
            'tenantLegalName' => 'Empresa de prueba',
            'carrierLegalName' => (string) $scenario->assignedCarrier->legal_name,
            'carrierUsdot' => '1234567',
        ],
        expiryDays: $dias,
        requestedByUserId: null,
    ));
}

/** Firma por HTTP y devuelve el registro escrito. */
function firmar(string $token, string $nombre = 'María Ñíguez'): object
{
    test()->post("/s/{$token}/sign", [
        'consent' => '1',
        'legal_name' => $nombre,
        'title' => 'Gerente de flota',
        'method' => 'typed',
        'typed' => $nombre,
    ])->assertRedirect();

    return DB::table('signature_records')->orderByDesc('created_at')->first();
}

/* ── Plantillas ─────────────────────────────────────────────────────────── */

it('siembra las plantillas de partida una sola vez', function () {
    $antes = DB::table('signature_templates')->where('tenant_id', $this->scenario->tenant->id)->count();

    expect($antes)->toBe(3);

    $creadas = app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn () => Templates::install((string) $this->scenario->tenant->id),
    );

    expect($creadas)->toBe(0);
    expect(DB::table('signature_templates')->where('tenant_id', $this->scenario->tenant->id)->count())->toBe(3);
});

it('publicar una versión no edita la anterior', function () {
    $original = plantillaVigente($this->scenario);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => Templates::publish(
        tenantId: (string) $this->scenario->tenant->id,
        templateKey: 'carrier_agreement',
        titleEn: 'Broker–Carrier Agreement', titleEs: 'Acuerdo revisado',
        bodyEn: 'New body {{carrierLegalName}}', bodyEs: 'Cuerpo nuevo {{carrierLegalName}}',
        consentEn: 'Consent', consentEs: 'Consentimiento',
    ));

    $vieja = DB::table('signature_templates')->where('id', $original->id)->first();

    // La fila vieja sigue byte a byte igual salvo por su retirada.
    expect((string) $vieja->body_es)->toBe((string) $original->body_es);
    expect((string) $vieja->content_hash)->toBe((string) $original->content_hash);
    expect((bool) $vieja->active)->toBeFalse();
    expect($vieja->retired_at)->not->toBeNull();

    $nueva = plantillaVigente($this->scenario);
    expect((int) $nueva->version)->toBe((int) $original->version + 1);
    expect((string) $nueva->content_hash)->not->toBe((string) $original->content_hash);
});

it('publicar una versión reemplaza las solicitudes sin firmar y respeta las firmadas', function () {
    ['requestId' => $pendiente] = solicitudDeFirma($this->scenario);

    ['token' => $token] = solicitudDeFirma($this->scenario);
    $registro = firmar($token);
    $firmada = (string) $registro->request_id;

    app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => Templates::publish(
        tenantId: (string) $this->scenario->tenant->id,
        templateKey: 'carrier_agreement',
        titleEn: 'T', titleEs: 'T', bodyEn: 'B', bodyEs: 'B', consentEn: 'C', consentEs: 'C',
    ));

    expect(DB::table('signature_requests')->where('id', $pendiente)->value('status'))->toBe('superseded');
    // La firmada NO se toca: sigue siendo válida para el texto que sí se firmó.
    expect(DB::table('signature_requests')->where('id', $firmada)->value('status'))->toBe('signed');
});

/* ── El enlace ──────────────────────────────────────────────────────────── */

it('el token no se guarda en ninguna parte', function () {
    ['token' => $token, 'requestId' => $id] = solicitudDeFirma($this->scenario);

    $fila = DB::table('signature_requests')->where('id', $id)->first();

    expect((string) $fila->access_token_hash)->toBe(hash('sha256', $token));
    expect(json_encode($fila))->not->toContain($token);
});

it('un token inventado no dice si alguna vez existió', function () {
    $this->get('/s/'.Str::random(48))
        ->assertOk()
        ->assertInertia(fn (Assert $p) => $p->component('Public/Signature')->where('state', 'not_found'));
});

it('la primera visita queda anotada y el estado pasa a visto', function () {
    ['token' => $token, 'requestId' => $id] = solicitudDeFirma($this->scenario);

    $this->get("/s/{$token}")->assertOk();

    $fila = DB::table('signature_requests')->where('id', $id)->first();

    expect($fila->first_viewed_at)->not->toBeNull();
    expect((string) $fila->status)->toBe('viewed');

    $tipos = DB::table('signature_audit_events')->where('request_id', $id)->pluck('event_type')->all();
    expect($tipos)->toContain(Ceremony::OPENED);
    expect($tipos)->toContain(Ceremony::VIEWED);
});

it('la página de firma llega con el documento, no con la pantalla de firmado', function () {
    // Una petición SIN nada en el flash tiene que traer el documento. Parece
    // obvio; no lo era. La bolsa `flash` compartida devuelve NULL —no ausente—
    // cuando no hay mensaje, y un `!== undefined` en la pantalla daba verdadero
    // siempre: todo el que abría su enlace veía la pantalla de «firmado» con el
    // título vacío, y el acuerdo no aparecía por ninguna parte.
    //
    // Se comprueba contra el HTML renderizado y no contra los props: los props
    // estaban perfectos mientras la pantalla estaba rota.
    ['token' => $token] = solicitudDeFirma($this->scenario);

    $cuerpo = $this->get("/s/{$token}")->assertOk()->getContent();

    expect($cuerpo)->toContain('Acuerdo entre corredor y transportista');
    expect($cuerpo)->toContain((string) $this->scenario->assignedCarrier->legal_name);
});

it('un enlace vencido no abre, y lo dice', function () {
    ['token' => $token, 'requestId' => $id] = solicitudDeFirma($this->scenario);

    DB::table('signature_requests')->where('id', $id)->update(['expires_at' => now()->subDay()]);

    $this->get("/s/{$token}")
        ->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('state', 'expired'));
});

it('el documento llega con los datos ya dentro, no con huecos', function () {
    ['token' => $token] = solicitudDeFirma($this->scenario);

    $this->get("/s/{$token}")->assertOk()->assertInertia(function (Assert $p) {
        $cuerpo = $p->toArray()['props']['document']['body'];

        expect($cuerpo)->toContain((string) $this->scenario->assignedCarrier->legal_name);
        // Ni una llave sin resolver: se firma lo que se lee.
        expect($cuerpo)->not->toContain('{{');
    });
});

/* ── La firma ───────────────────────────────────────────────────────────── */

it('firmar escribe el registro, el PDF y el certificado', function () {
    ['token' => $token, 'requestId' => $id] = solicitudDeFirma($this->scenario);
    $this->get("/s/{$token}")->assertOk();

    $registro = firmar($token);

    expect((string) $registro->request_id)->toBe($id);
    expect((string) $registro->signer_legal_name)->toBe('María Ñíguez');
    expect((string) $registro->method)->toBe('typed');
    expect((int) $registro->consent_accepted)->toBe(1);
    expect($registro->signed_document_id)->not->toBeNull();
    expect($registro->audit_certificate_document_id)->not->toBeNull();

    // El PDF existe y su hash es el que dice el registro, calculado sobre los
    // BYTES REALES del fichero y no sobre el texto que lo originó.
    $clave = DB::table('documents as d')
        ->join('document_versions as v', 'v.id', '=', 'd.current_version_id')
        ->where('d.id', $registro->signed_document_id)
        ->value('v.storage_key');

    expect(Storage::disk('local')->exists($clave))->toBeTrue();
    expect(hash('sha256', Storage::disk('local')->get($clave)))->toBe((string) $registro->document_sha256);

    // Y el documento firmado queda en el expediente del transportista.
    $documento = DB::table('documents')->where('id', $registro->signed_document_id)->first();
    expect((string) $documento->document_type)->toBe('carrier_agreement');
    expect((string) $documento->owner_id)->toBe((string) $this->scenario->assignedCarrier->id);
});

it('tras firmar, el enlace dice «ya firmado» y no «no encontrado»', function () {
    // Quien acaba de firmar vuelve a su propio enlace: tiene que leer que
    // consta, no que su enlace no existe. Borrar el token al firmar producía lo
    // segundo, y la suite no lo veía porque comprobaba la fila, no la vuelta.
    ['token' => $token] = solicitudDeFirma($this->scenario);
    firmar($token);

    $this->get("/s/{$token}")
        ->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('state', 'already_signed'));
});

it('no se puede firmar dos veces', function () {
    ['token' => $token, 'requestId' => $id] = solicitudDeFirma($this->scenario);
    firmar($token);

    $this->post("/s/{$token}/sign", [
        'consent' => '1', 'legal_name' => 'Otro', 'method' => 'typed', 'typed' => 'Otro',
    ])->assertRedirect();

    expect(DB::table('signature_records')->where('request_id', $id)->count())->toBe(1);
});

it('sin consentimiento no se firma', function () {
    ['token' => $token, 'requestId' => $id] = solicitudDeFirma($this->scenario);

    $this->post("/s/{$token}/sign", [
        'legal_name' => 'Alguien', 'method' => 'typed', 'typed' => 'Alguien',
    ])->assertSessionHasErrors('consent');

    expect(DB::table('signature_records')->where('request_id', $id)->count())->toBe(0);
});

it('rechazar cierra la solicitud y el enlace lo cuenta', function () {
    ['token' => $token, 'requestId' => $id] = solicitudDeFirma($this->scenario);

    $this->post("/s/{$token}/decline", ['reason' => 'La tarifa no es la acordada'])->assertRedirect();

    $fila = DB::table('signature_requests')->where('id', $id)->first();
    expect((string) $fila->status)->toBe('declined');
    expect((string) $fila->decline_reason)->toBe('La tarifa no es la acordada');

    // El enlace sigue abriendo, y dice que consta el rechazo.
    $this->get("/s/{$token}")
        ->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('state', 'declined'));
});

/* ── Integridad ─────────────────────────────────────────────────────────── */

it('la verificación pasa en una firma intacta', function () {
    ['token' => $token] = solicitudDeFirma($this->scenario);
    $registro = firmar($token);

    $v = Verifier::verify($registro);

    expect($v['seal'])->toBeTrue();
    expect($v['document'])->toBe('valid');
    expect($v['chain'])->toBeTrue();
});

it('el sello detecta que alguien cambió el nombre del firmante', function () {
    ['token' => $token] = solicitudDeFirma($this->scenario);
    $registro = firmar($token);

    // El disparador de MySQL rechaza cambiar `signer_legal_name`, que es
    // exactamente lo que se quiere. Se comprueba el sello contra un registro
    // manipulado EN MEMORIA: es el escenario real de una copia restaurada o de
    // una fila reescrita con los disparadores desactivados.
    $manipulado = clone $registro;
    $manipulado->signer_legal_name = 'Otra Persona';

    expect(Verifier::verify($manipulado)['seal'])->toBeFalse();
    // Y el original sigue validando: no es que el verificador diga que no a todo.
    expect(Verifier::verify($registro)['seal'])->toBeTrue();
});

it('el sello detecta que alguien cambió el fichero firmado', function () {
    ['token' => $token] = solicitudDeFirma($this->scenario);
    $registro = firmar($token);

    $clave = DB::table('documents as d')
        ->join('document_versions as v', 'v.id', '=', 'd.current_version_id')
        ->where('d.id', $registro->signed_document_id)
        ->value('v.storage_key');

    Storage::disk('local')->put($clave, 'otro contenido cualquiera');

    $v = Verifier::verify($registro);

    expect($v['document'])->toBe('invalid');
    // El sello sigue bien: sella lo que DICE la fila, y la fila no cambió. Son
    // dos preguntas distintas y contestarlas juntas escondería cuál falló.
    expect($v['seal'])->toBeTrue();
});

it('un fichero que falta es «no se puede comprobar», no «alterado»', function () {
    ['token' => $token] = solicitudDeFirma($this->scenario);
    $registro = firmar($token);

    $clave = DB::table('documents as d')
        ->join('document_versions as v', 'v.id', '=', 'd.current_version_id')
        ->where('d.id', $registro->signed_document_id)
        ->value('v.storage_key');

    Storage::disk('local')->delete($clave);

    expect(Verifier::verify($registro)['document'])->toBe('unavailable');
});

it('la cadena aguanta varios eventos en el mismo milisegundo', function () {
    // Este es el fallo que apareció al reconstruir el entorno y pasar la suite
    // otra vez: `occurred_at` es datetime(3), y `opened` y `viewed` se escriben
    // seguidos al abrir un enlace — caen en el mismo milisegundo con toda
    // facilidad. Con la hora empatada, el desempate era el UUID, que es
    // aleatorio: escribir y verificar recorrían la cadena en órdenes distintos
    // y la verificación fallaba en una firma perfectamente sana, según qué
    // UUID hubiera tocado esa vez.
    //
    // Se fija el reloj para que TODOS los eventos compartan el instante. Si la
    // cadena volviera a depender del orden de los UUID, esto fallaría siempre
    // en vez de una de cada tantas.
    Carbon::setTestNow(Carbon::create(2026, 8, 31, 10, 0, 0)->addMilliseconds(123));

    ['requestId' => $id] = solicitudDeFirma($this->scenario);

    foreach ([Ceremony::OPENED, Ceremony::VIEWED, Ceremony::CONSENT_SHOWN, Ceremony::CONSENT_ACCEPTED] as $tipo) {
        app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => Ceremony::record(
            tenantId: (string) $this->scenario->tenant->id,
            requestId: $id,
            eventType: $tipo,
        ));
    }

    $horas = DB::table('signature_audit_events')->where('request_id', $id)->pluck('occurred_at')->unique();
    expect($horas)->toHaveCount(1);

    expect(Ceremony::verifyChain($id))->toBeNull();

    Carbon::setTestNow();
});

it('la cadena de la bitácora detecta un eslabón que no cuadra', function () {
    ['token' => $token, 'requestId' => $id] = solicitudDeFirma($this->scenario);
    $this->get("/s/{$token}")->assertOk();
    firmar($token);

    expect(Ceremony::verifyChain($id))->toBeNull();

    // Se AÑADE un evento con un `previous_event_hash` que no corresponde. Es el
    // mismo camino de código que recorre un evento quitado del medio —el
    // siguiente queda apuntando a un hash que ya no está— con la diferencia de
    // que aquí no hace falta tocar los disparadores.
    //
    // Y esa diferencia importa: quitar un disparador es DDL, y MySQL confirma
    // la transacción abierta al ejecutarlo. Una prueba que lo hiciera dejaría
    // sus propios datos escritos para siempre en la base de pruebas y rompería
    // pruebas de otros ficheros. Ya pasó una vez en este proyecto; está
    // contado en docs/testing.md.
    $intruso = (string) Str::uuid();

    DB::table('signature_audit_events')->insert([
        'id' => $intruso,
        'tenant_id' => $this->scenario->tenant->id,
        'request_id' => $id,
        'event_type' => Ceremony::VIEWED,
        'previous_event_hash' => str_repeat('f', 64),
        'event_hash' => hash('sha256', 'lo que sea'),
        'occurred_at' => now()->addSecond(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    expect(Ceremony::verifyChain($id))->toBe($intruso);
});

it('la base de datos misma rechaza borrar un registro de firma', function () {
    ['token' => $token] = solicitudDeFirma($this->scenario);
    $registro = firmar($token);

    expect(fn () => DB::table('signature_records')->where('id', $registro->id)->delete())
        ->toThrow(Illuminate\Database\QueryException::class);
});

it('la base de datos misma rechaza reescribir el sello', function () {
    ['token' => $token] = solicitudDeFirma($this->scenario);
    $registro = firmar($token);

    expect(fn () => DB::table('signature_records')
        ->where('id', $registro->id)
        ->update(['integrity_seal' => str_repeat('0', 64)]))
        ->toThrow(Illuminate\Database\QueryException::class);
});

it('el sello va con clave, no es un sha que cualquiera pueda recalcular', function () {
    $componentes = Seal::components(
        templateContentHash: str_repeat('a', 64),
        documentSha256: str_repeat('b', 64),
        signatureSha256: str_repeat('c', 64),
        signerLegalName: 'Alguien',
        signerEmail: 'alguien@prueba.test',
        signedAt: '2026-08-30 12:00:00.000',
    );

    $sello = Seal::compute($componentes);

    expect($sello)->not->toBe(hash('sha256', Seal::canonical($componentes)));
    expect(strlen($sello))->toBe(64);
});

/* ── Correos y descargas ────────────────────────────────────────────────── */

it('manda el enlace por correo y lo anota en la bitácora', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/signatures/requests', [
        'carrier_id' => (string) $this->scenario->assignedCarrier->id,
        'template_key' => 'carrier_agreement',
        'signer_email' => 'firmante@prueba.test',
        'locale' => 'es',
        'expiry_days' => 30,
    ])->assertRedirect();

    $id = DB::table('signature_requests')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('signer_email', 'firmante@prueba.test')
        ->value('id');

    // El evento `emailed` SOLO se escribe si el envío devolvió que salió. Es
    // una afirmación sobre lo que hizo este código, no sobre cómo el doble de
    // pruebas de Laravel registra un envío en crudo.
    expect(DB::table('signature_audit_events')->where('request_id', $id)->pluck('event_type')->all())
        ->toContain(Ceremony::EMAILED);
});

it('el correo se compone en el idioma de la SOLICITUD, no en el de quien lo crea', function () {
    // Un despachador trabajando en inglés le manda un acuerdo a un
    // transportista al que se le habla en español. El correo tiene que salir en
    // español: el idioma lo decidió quien lo mandó, no la petición.
    app()->setLocale('en');

    $destinatario = (object) ['locale' => 'es', 'signer_email' => 'firmante@prueba.test'];

    $mensaje = Mailer::composeRequest($destinatario, 'https://ejemplo.test/es/s/abc', 'Demo Dispatch', 'Acuerdo');

    expect($mensaje['subject'])->toContain('revise y firme');
    expect($mensaje['body'])->toContain('Revisar y firmar');
    expect($mensaje['body'])->toContain('https://ejemplo.test/es/s/abc');

    // Y al revés, para que la prueba no pase por casualidad.
    app()->setLocale('es');
    $enIngles = Mailer::composeRequest(
        (object) ['locale' => 'en', 'signer_email' => 'x@prueba.test'],
        'https://ejemplo.test/en/s/abc', 'Demo Dispatch', 'Agreement',
    );

    expect($enIngles['subject'])->toContain('review and sign');
});

it('el aviso de copia firmada no promete un adjunto que no se manda', function () {
    // El diccionario portado dice «adjuntamos su copia firmada». No se adjunta
    // nada: mandar el acuerdo a un buzón que no controlamos y que se reenvía
    // tres veces es una decisión, no un efecto secundario de una frase.
    $mensaje = Mailer::composeSignedCopy(
        (object) ['locale' => 'es', 'signer_email' => 'x@prueba.test'],
        'Demo Dispatch',
    );

    expect($mensaje['body'])->not->toContain('Adjuntamos');
    expect($mensaje['body'])->toContain('Demo Dispatch');
});

it('un fallo de correo no deshace la solicitud', function () {
    // El servidor de correo caído es un problema de entrega, no un motivo para
    // que no exista lo que se pidió: el enlace se enseña igual en pantalla.
    Mail::shouldReceive('mailer')->andThrow(new RuntimeException('servidor caído'));

    signIn($this->scenario, Role::Admin);

    $this->post('/signatures/requests', [
        'carrier_id' => (string) $this->scenario->assignedCarrier->id,
        'template_key' => 'carrier_agreement',
        'signer_email' => 'firmante@prueba.test',
        'locale' => 'es',
    ])->assertRedirect();

    expect(DB::table('signature_requests')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('signer_email', 'firmante@prueba.test')
        ->count())->toBe(1);
});

it('descargar el certificado queda anotado en la ceremonia', function () {
    ['token' => $token, 'requestId' => $id] = solicitudDeFirma($this->scenario);
    firmar($token);

    signIn($this->scenario, Role::Admin);

    $this->get("/signatures/{$id}/certificate")->assertRedirect();

    expect(DB::table('signature_audit_events')->where('request_id', $id)->pluck('event_type')->all())
        ->toContain(Ceremony::CERTIFICATE_DOWNLOADED);

    // Y la cadena sigue entera después de añadirle ese evento.
    expect(Ceremony::verifyChain($id))->toBeNull();
});

it('no se descarga el certificado de una firma que aún no existe', function () {
    ['requestId' => $id] = solicitudDeFirma($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->get("/signatures/{$id}/certificate")->assertRedirect();

    expect(DB::table('signature_audit_events')->where('request_id', $id)->pluck('event_type')->all())
        ->not->toContain(Ceremony::CERTIFICATE_DOWNLOADED);
});

/* ── La aplicación por dentro ───────────────────────────────────────────── */

it('el índice enseña las solicitudes de la empresa', function () {
    ['requestId' => $id] = solicitudDeFirma($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->get('/signatures')->assertOk()->assertInertia(function (Assert $p) use ($id) {
        $ids = collect($p->toArray()['props']['requests'])->pluck('id')->all();
        expect($ids)->toContain($id);
    });
});

it('no enseña las solicitudes de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();
    app(TenantContext::class)->runAs($otra->tenant->id, fn () => Templates::install((string) $otra->tenant->id));
    ['requestId' => $ajena] = solicitudDeFirma($otra);

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Admin);

    $this->get('/signatures')->assertInertia(function (Assert $p) use ($ajena) {
        $ids = collect($p->toArray()['props']['requests'])->pluck('id')->all();
        expect($ids)->not->toContain($ajena);
    });
});

it('«requiere nueva firma» agrupa las firmadas sobre una versión ya retirada', function () {
    ['token' => $token] = solicitudDeFirma($this->scenario);
    $registro = firmar($token);

    signIn($this->scenario, Role::Admin);

    $this->get('/signatures')->assertInertia(function (Assert $p) {
        expect($p->toArray()['props']['needsResignature'])->toBe([]);
    });

    app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => Templates::publish(
        tenantId: (string) $this->scenario->tenant->id,
        templateKey: 'carrier_agreement',
        titleEn: 'T', titleEs: 'T', bodyEn: 'B', bodyEs: 'B', consentEn: 'C', consentEs: 'C',
    ));

    $this->get('/signatures')->assertInertia(function (Assert $p) use ($registro) {
        $ids = collect($p->toArray()['props']['needsResignature'])->pluck('id')->all();
        expect($ids)->toContain((string) $registro->request_id);
    });
});

it('el detalle recalcula la verificación en vez de leer una bandera', function () {
    ['token' => $token, 'requestId' => $id] = solicitudDeFirma($this->scenario);
    firmar($token);

    signIn($this->scenario, Role::Admin);

    $this->get("/signatures/{$id}")->assertOk()->assertInertia(fn (Assert $p) => $p
        ->where('verification.seal', true)
        ->where('verification.document', 'valid')
        ->where('verification.chain', true));

    // Se rompe el fichero y la MISMA página lo cuenta, sin que nada haya
    // escrito nunca un «verificado = no» en ninguna columna.
    $registro = DB::table('signature_records')->where('request_id', $id)->first();
    $clave = DB::table('documents as d')
        ->join('document_versions as v', 'v.id', '=', 'd.current_version_id')
        ->where('d.id', $registro->signed_document_id)
        ->value('v.storage_key');
    Storage::disk('local')->put($clave, 'manipulado');

    $this->get("/signatures/{$id}")->assertInertia(fn (Assert $p) => $p
        ->where('verification.document', 'invalid'));
});

it('el enlace en claro llega a la pantalla una vez, y solo una', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/signatures/requests', [
        'carrier_id' => (string) $this->scenario->assignedCarrier->id,
        'template_key' => 'carrier_agreement',
        'signer_email' => 'firmante@prueba.test',
        'locale' => 'es',
        'expiry_days' => 30,
    ])->assertRedirect();

    $this->get('/signatures')->assertOk()->assertInertia(function (Assert $p) {
        $url = $p->toArray()['props']['newSigningUrl'];
        expect($url)->toBeString();
        expect($url)->toContain('/es/s/');
    });

    $this->get('/signatures')->assertInertia(fn (Assert $p) => $p->where('newSigningUrl', null));
});

it('anular cierra el enlace, y una firmada no se anula', function () {
    ['token' => $token, 'requestId' => $id] = solicitudDeFirma($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/signatures/{$id}/void", ['reason' => 'Se mandó al contacto equivocado'])->assertRedirect();

    expect(DB::table('signature_requests')->where('id', $id)->value('status'))->toBe('voided');

    $this->get("/s/{$token}")->assertOk()->assertInertia(fn (Assert $p) => $p->where('state', 'voided'));

    // Una ya firmada, en cambio, no se puede anular: el hecho ocurrió.
    ['token' => $otro, 'requestId' => $firmada] = solicitudDeFirma($this->scenario);
    firmar($otro);

    $this->post("/signatures/{$firmada}/void", ['reason' => 'Da igual'])->assertRedirect();
    expect(DB::table('signature_requests')->where('id', $firmada)->value('status'))->toBe('signed');
});

it('el conductor no puede mandar nada a firmar', function () {
    // El conductor no tiene ningún permiso de firma salvo `signature:sign` con
    // alcance propio: puede firmar lo que le manden, no mandarle nada a nadie.
    // La aplicación contesta el 403 con una redirección y el mensaje en la
    // sesión, que es como lo trata el resto del producto; lo que importa aquí
    // es que no quede fila escrita.
    signIn($this->scenario, Role::Driver);

    $this->post('/signatures/requests', [
        'carrier_id' => (string) $this->scenario->assignedCarrier->id,
        'template_key' => 'carrier_agreement',
        'signer_email' => 'firmante@prueba.test',
        'locale' => 'en',
    ])->assertRedirect();

    expect(DB::table('signature_requests')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('signer_email', 'firmante@prueba.test')
        ->count())->toBe(0);
});

it('el prefijo de idioma del enlace manda sobre el navegador del firmante', function () {
    ['token' => $token] = solicitudDeFirma($this->scenario);

    $this->withHeaders(['Accept-Language' => 'en-US,en;q=0.9'])
        ->get("/es/s/{$token}")
        ->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('locale', 'es'));
});
