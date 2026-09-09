<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Storage\DocumentStore;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
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
 * El logo, subido y servido de verdad.
 *
 * El guardián de `tests/Unit/Suite` comprueba que el código llame a la pieza.
 * Esto comprueba lo otro: que la ruta pública devuelva las cabeceras que hacen
 * inerte lo que sirve, y que un logo guardado ANTES de este cambio —un SVG,
 * que la validación admitía— deje de servirse sin que nadie migre nada.
 */

/** Un PNG de 1×1, el más pequeño que existe. */
function pngDePrueba(): string
{
    return (string) base64_decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    );
}

/** Un SVG con una etiqueta de guion dentro. Inerte: no hace nada. */
function svgConGuion(): string
{
    return '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
        .'<script>void 0</script></svg>';
}

/* ── No se acepta ────────────────────────────────────────────────────────── */

it('subir un SVG como logo se rechaza', function () {
    signIn($this->scenario, Role::Admin);

    $fichero = UploadedFile::fake()->createWithContent('logo.svg', svgConGuion());

    $this->from('/settings')
        ->post('/settings/branding', ['logo' => $fichero])
        ->assertSessionHasErrors('logo');
});

it('un SVG con nombre de PNG tampoco', function () {
    // Por el CONTENIDO y no por la extensión: `mimetypes:` mira los bytes con
    // finfo, y LogoImage exige además que se analicen como imagen.
    signIn($this->scenario, Role::Admin);

    $fichero = UploadedFile::fake()->createWithContent('logo.png', svgConGuion());

    $this->from('/settings')
        ->post('/settings/branding', ['logo' => $fichero])
        ->assertSessionHasErrors('logo');
});

it('un PNG de verdad se acepta', function () {
    signIn($this->scenario, Role::Admin);

    $fichero = UploadedFile::fake()->createWithContent('logo.png', pngDePrueba());

    $this->from('/settings')
        ->post('/settings/branding', ['logo' => $fichero])
        ->assertSessionHasNoErrors();

    app(TenantContext::class)->withoutTenant(function () {
        expect(DB::table('tenant_branding')
            ->where('tenant_id', $this->scenario->tenant->id)
            ->value('logo_storage_key'))->toBeString();
    });
});

/* ── Lo que se sirve, y con qué cabeceras ────────────────────────────────── */

it('el logo se devuelve con las cabeceras que lo hacen inerte', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/settings/branding', [
        'logo' => UploadedFile::fake()->createWithContent('logo.png', pngDePrueba()),
    ])->assertSessionHasNoErrors();

    $respuesta = $this->get("/b/{$this->scenario->tenant->id}/logo")->assertOk();

    expect($respuesta->headers->get('Content-Type'))->toBe('image/png')
        ->and($respuesta->headers->get('X-Content-Type-Options'))->toBe('nosniff');

    $csp = (string) $respuesta->headers->get('Content-Security-Policy');

    expect($csp)->toContain("default-src 'none'")
        ->and($csp)->toContain('sandbox');

    // Se pinta —la página de rastreo lo necesita— pero sin decir cómo se llama
    // el fichero en disco.
    expect((string) $respuesta->headers->get('Content-Disposition'))
        ->toContain('inline')
        ->and((string) $respuesta->headers->get('Content-Disposition'))->not->toContain('.bin');
});

it('un logo guardado de antes que no sea imagen deja de servirse', function () {
    // El caso que importa de verdad: en disco puede haber un SVG subido cuando
    // la validación lo admitía. Se guarda saltándose el controlador, que es
    // exactamente cómo llegó allí.
    $store = app(DocumentStore::class);

    $clave = $store->putBytes((string) $this->scenario->tenant->id, svgConGuion(), 'svg');

    // La clave se escribe a mano en la fila, sin pasar por el controlador: es
    // exactamente cómo llegó allí un logo subido antes de este cambio.
    app(TenantContext::class)->withoutTenant(function () use ($clave) {
        DB::table('tenant_branding')->updateOrInsert(
            ['tenant_id' => $this->scenario->tenant->id],
            ['id' => (string) Str::uuid(), 'logo_storage_key' => $clave, 'created_at' => now(), 'updated_at' => now()],
        );
    });

    // Mismo 404 que no tener logo: distinguirlo le diría a quien prueba la ruta
    // qué acepta y qué no.
    $this->get("/b/{$this->scenario->tenant->id}/logo")->assertNotFound();
});

it('sin logo, la ruta contesta lo mismo', function () {
    $this->get("/b/{$this->scenario->tenant->id}/logo")->assertNotFound();
});

it('la ruta es pública: no hace falta sesión', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/settings/branding', [
        'logo' => UploadedFile::fake()->createWithContent('logo.png', pngDePrueba()),
    ])->assertSessionHasNoErrors();

    // Es lo que la página de rastreo necesita, y por eso las tres capas de
    // arriba tienen que estar: quien abre esto puede ser cualquiera.
    auth()->logout();

    $this->get("/b/{$this->scenario->tenant->id}/logo")->assertOk();
});
