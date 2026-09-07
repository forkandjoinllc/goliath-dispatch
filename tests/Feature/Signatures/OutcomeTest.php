<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Signatures\SigningLinks;
use App\Support\Signatures\State;
use App\Support\Signatures\Templates;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
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

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Una solicitud de firma con el vencimiento que se pida.
 *
 * Con nombre propio y no `solicitudDeFirma()`: Pest carga todos los ficheros de
 * prueba en un espacio global y `SignatureTest.php` ya tiene una con ese
 * nombre. Dos funciones de primer nivel iguales son un fatal que se lleva la
 * suite entera, y solo aparece al correrla entera.
 */
function solicitudDeDesenlace(Scenario $scenario, ?int $dias = 30): array
{
    $plantilla = DB::table('signature_templates')
        ->where('tenant_id', $scenario->tenant->id)
        ->where('template_key', 'carrier_agreement')
        ->where('active', 1)
        ->orderByDesc('version')
        ->first();

    return app(TenantContext::class)->runAs($scenario->tenant->id, fn (): array => SigningLinks::issue(
        tenantId: (string) $scenario->tenant->id,
        plantilla: $plantilla,
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

/**
 * Una petición con IP propia.
 *
 * Las rutas públicas de firma van con `throttle:20,1`, y el limitador es POR
 * IP. Todas las pruebas salen de 127.0.0.1, así que este fichero —que hace
 * ocho envíos— se comía el presupuesto compartido con `SignatureTest.php` y
 * hacía caer pruebas de OTROS ficheros, al azar, según el minuto en que
 * cayeran. Se vio en la suite entera y no al correr estos ficheros juntos:
 * exactamente la clase de fallo que se echa a «flaky» y se ignora.
 *
 * Mismo remedio que `signIn()` en Pest.php: variar REMOTE_ADDR. Y con
 * `withServerVariables`, no con el tercer argumento de `post()`, que son
 * CABECERAS — puesta como cabecera, el limitador seguiría viendo 127.0.0.1.
 */
function envioDeFirma(string $url, array $datos): TestResponse
{
    static $n = 0;
    $n++;

    return test()
        ->withServerVariables(['REMOTE_ADDR' => '198.51.100.'.(($n % 250) + 1)])
        ->post($url, $datos);
}

/** Empuja el vencimiento de una solicitud al pasado. */
function venceLaSolicitud(string $requestId, int $diasAtras): void
{
    DB::table('signature_requests')->where('id', $requestId)->update([
        'expires_at' => CarbonImmutable::now()->subDays($diasAtras),
    ]);
}

/* ── Rechazar: la frase de la pantalla ahora es verdad ───────────────────── */

it('rechazar la firma se lo cuenta a la casa', function () {
    // La página le dice a quien rechaza que «se ha notificado al remitente».
    // Hasta este lote nadie avisaba a nadie.
    ['token' => $token, 'requestId' => $id] = solicitudDeDesenlace($this->scenario);

    envioDeFirma("/s/{$token}/decline", ['reason' => 'La tarifa no es la acordada.'])
        ->assertRedirect();

    $aviso = DB::table('notifications')->where('event_key', 'signature.declined')->first();

    expect($aviso)->not->toBeNull()
        ->and((string) $aviso->tenant_id)->toBe((string) $this->scenario->tenant->id)
        ->and((string) $aviso->action_url)->toBe('/signatures/'.$id);

    // El motivo viaja dentro del aviso: sin él hay que abrir la solicitud para
    // saber si es «la tarifa» o «esta empresa no es la nuestra».
    expect((string) $aviso->body)->toContain('La tarifa no es la acordada');
});

it('el motivo larguísimo no se pega entero en el aviso', function () {
    ['token' => $token] = solicitudDeDesenlace($this->scenario);

    envioDeFirma("/s/{$token}/decline", ['reason' => str_repeat('motivo larguísimo ', 100)])
        ->assertRedirect();

    $aviso = DB::table('notifications')->where('event_key', 'signature.declined')->first();

    expect(mb_strlen((string) $aviso->body))->toBeLessThan(400);
});

it('firmar también se lo cuenta a la casa', function () {
    // Mailer::sendSignedCopy va al FIRMANTE. Quien pidió la firma no se
    // enteraba de nada.
    ['token' => $token] = solicitudDeDesenlace($this->scenario);

    envioDeFirma("/s/{$token}/sign", [
        'consent' => '1',
        'legal_name' => 'María Ñíguez',
        'title' => 'Gerente de flota',
        'method' => 'typed',
        'typed' => 'María Ñíguez',
    ])->assertRedirect();

    expect(DB::table('notifications')->where('event_key', 'signature.signed')->count())->toBeGreaterThan(0);
});

it('la firma queda sellada aunque no haya nadie a quien avisar', function () {
    // El aviso va fuera de la transacción justamente para esto: una firma hay
    // que volver a pedírsela a una persona.
    ['token' => $token, 'requestId' => $id] = solicitudDeDesenlace($this->scenario);

    DB::table('user_tenant_memberships')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->update(['status' => 'suspended']);

    envioDeFirma("/s/{$token}/sign", [
        'consent' => '1',
        'legal_name' => 'María Ñíguez',
        'method' => 'typed',
        'typed' => 'María Ñíguez',
    ])->assertRedirect();

    $solicitud = DB::table('signature_requests')->where('id', $id)->first();

    expect((string) $solicitud->status)->toBe('signed');
});

/* ── El estado guardado no es el estado real ─────────────────────────────── */

it('una solicitud vencida deja de decir que está pendiente', function () {
    ['requestId' => $id] = solicitudDeDesenlace($this->scenario);
    venceLaSolicitud($id, 3);

    signIn($this->scenario, Role::Admin);

    $this->get('/signatures')->assertOk()->assertInertia(
        fn (Assert $p) => $p->where(
            'requests.0.status',
            'expired',
        )
    );
});

it('el filtro «vencida» encuentra las que vencieron', function () {
    // Antes no encontraba nada NUNCA: ninguna fila llega a tener ese valor
    // guardado, porque nada corre a medianoche a escribirlo.
    ['requestId' => $id] = solicitudDeDesenlace($this->scenario);
    venceLaSolicitud($id, 3);

    signIn($this->scenario, Role::Admin);

    $this->get('/signatures?status=expired')->assertOk()->assertInertia(
        fn (Assert $p) => $p->has('requests', 1)
    );
});

it('el filtro «pendiente» ya no devuelve puertas cerradas', function () {
    // La otra mitad del defecto: arreglar «vencida» y dejar «pendiente»
    // enseñando lo mismo sería seguir mintiendo, solo que en otro sitio.
    ['requestId' => $id] = solicitudDeDesenlace($this->scenario);
    venceLaSolicitud($id, 3);

    signIn($this->scenario, Role::Admin);

    $this->get('/signatures?status=pending')->assertOk()->assertInertia(
        fn (Assert $p) => $p->has('requests', 0)
    );
});

it('lo que todavía no ha vencido sigue pendiente', function () {
    solicitudDeDesenlace($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->get('/signatures?status=pending')->assertOk()->assertInertia(
        fn (Assert $p) => $p->has('requests', 1)
    );
});

it('el SQL y el PHP aplican la misma regla', function () {
    // Hay dos copias de la regla por necesidad —una para pintar y otra para
    // filtrar—, y dos copias de una regla se separan. Esta prueba existe para
    // que se separen aquí y no en producción.
    ['requestId' => $vencida] = solicitudDeDesenlace($this->scenario);
    venceLaSolicitud($vencida, 3);
    solicitudDeDesenlace($this->scenario);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        foreach (['pending', 'expired', 'signed', 'declined'] as $estado) {
            $porSql = State::filtrar(
                DB::table('signature_requests as r')->whereNull('r.deleted_at'),
                'r',
                $estado,
            )->pluck('r.id')->map(fn ($v): string => (string) $v)->sort()->values()->all();

            $porPhp = DB::table('signature_requests as r')
                ->whereNull('r.deleted_at')
                ->get(['r.id', 'r.status', 'r.expires_at'])
                ->filter(fn (object $f): bool => State::of($f) === $estado)
                ->pluck('id')->map(fn ($v): string => (string) $v)->sort()->values()->all();

            expect($porSql)->toBe($porPhp, "el filtro «{$estado}» no coincide entre SQL y PHP");
        }
    });
});

/* ── El barrido persigue lo vencido sin firmar ───────────────────────────── */

it('el barrido avisa de una firma que venció sin firmarse', function () {
    ['requestId' => $id] = solicitudDeDesenlace($this->scenario);
    venceLaSolicitud($id, 3);

    $this->artisan('notifications:sweep', ['--tenant' => (string) $this->scenario->tenant->id])
        ->assertSuccessful();

    expect(DB::table('notifications')->where('event_key', 'signature.expired')->count())->toBeGreaterThan(0);
});

it('el barrido no avisa dos veces de la misma', function () {
    ['requestId' => $id] = solicitudDeDesenlace($this->scenario);
    venceLaSolicitud($id, 3);

    $tenantId = (string) $this->scenario->tenant->id;

    $this->artisan('notifications:sweep', ['--tenant' => $tenantId])->assertSuccessful();
    $primera = DB::table('notifications')->where('event_key', 'signature.expired')->count();

    $this->artisan('notifications:sweep', ['--tenant' => $tenantId])->assertSuccessful();

    expect(DB::table('notifications')->where('event_key', 'signature.expired')->count())->toBe($primera);
});

it('lo vencido hace demasiado no se desentierra', function () {
    // Sin el corte, el día que este barrido empiece a correr avisaría de golpe
    // de todo lo vencido desde el principio.
    ['requestId' => $id] = solicitudDeDesenlace($this->scenario);
    venceLaSolicitud($id, 400);

    $this->artisan('notifications:sweep', ['--tenant' => (string) $this->scenario->tenant->id])
        ->assertSuccessful();

    expect(DB::table('notifications')->where('event_key', 'signature.expired')->count())->toBe(0);
});

it('lo que ya se firmó no se persigue aunque pase la fecha', function () {
    ['token' => $token, 'requestId' => $id] = solicitudDeDesenlace($this->scenario);

    envioDeFirma("/s/{$token}/sign", [
        'consent' => '1',
        'legal_name' => 'María Ñíguez',
        'method' => 'typed',
        'typed' => 'María Ñíguez',
    ])->assertRedirect();

    venceLaSolicitud($id, 3);

    $this->artisan('notifications:sweep', ['--tenant' => (string) $this->scenario->tenant->id])
        ->assertSuccessful();

    expect(DB::table('notifications')->where('event_key', 'signature.expired')->count())->toBe(0);
});
