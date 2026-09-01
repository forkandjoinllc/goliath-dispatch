<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Branding\Brand;
use App\Support\Branding\Templates;
use App\Support\TenantContext;
use App\Support\Tracking\LinkMailer;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

// ─────────────────────────────────────────────────────────────── los colores

it('sin marca puesta, usa la de siempre', function () {
    $marca = Brand::for((string) $this->scenario->tenant->id);

    expect($marca['primaryColor'])->toBe(Brand::POR_DEFECTO['primary_color'])
        ->and($marca['logoUrl'])->toBeNull()
        ->and($marca['name'])->not->toBe('');
});

it('un color que no es un color no entra, ni por el formulario ni por la base', function () {
    // Una defensa que solo está en el formulario se salta con un `update`. Por
    // eso el color se comprueba también AL LEER.
    signIn($this->scenario, Role::Admin);

    $this->post('/settings/branding', ['primary_color' => 'javascript:alert(1)'])
        ->assertSessionHasErrors('primary_color');

    Brand::save((string) $this->scenario->tenant->id, '#0A0A0A', '#FFFFFF', null);

    app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_branding')
        ->where('tenant_id', $this->scenario->tenant->id)
        // La columna es varchar(9), así que el esquema ya frena lo más burdo;
        // esto es lo que SÍ cabe y sigue sin ser un color.
        ->update(['primary_color' => '#GGGGGG']));

    expect(Brand::for((string) $this->scenario->tenant->id)['primaryColor'])
        ->toBe(Brand::POR_DEFECTO['primary_color']);
});

it('el pie del correo no admite marcado, ni aunque entre por la base', function () {
    // Ese texto lo escribe el administrador de una empresa y lo lee un tercero
    // que no nos conoce. Un bloque con formato es lo que usa quien suplanta.
    $tenantId = (string) $this->scenario->tenant->id;

    Brand::save($tenantId, null, null, 'Transportes Demo · 555 0100');

    app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_branding')
        ->where('tenant_id', $tenantId)
        ->update(['email_footer_html' => '<a href="http://malo.test">Confirme sus datos</a>']));

    $pie = Brand::for($tenantId)['emailFooter'];

    expect($pie)->not->toContain('<a ')
        ->and($pie)->toContain('Confirme sus datos');
});

// ──────────────────────────────────────────────────────────────────── el logo

it('sube un logo y la página pública lo puede servir', function () {
    Storage::fake('local');

    signIn($this->scenario, Role::Admin);

    $this->post('/settings/branding', [
        'logo' => UploadedFile::fake()->image('logo.png'),
    ])->assertSessionHasNoErrors();

    $tenantId = (string) $this->scenario->tenant->id;

    expect(Brand::logoKey($tenantId))->not->toBeNull();

    // Sin sesión: es lo que hace la página que abre el cliente.
    $this->post('/logout');
    $this->get("/b/{$tenantId}/logo")->assertOk();
});

it('sin logo, la dirección contesta lo mismo que si la empresa no existiera', function () {
    // Distinguirlo convertiría esta ruta en una forma de enumerar empresas.
    $tenantId = (string) $this->scenario->tenant->id;

    $this->get("/b/{$tenantId}/logo")->assertNotFound();
    $this->get('/b/'.\Illuminate\Support\Str::uuid().'/logo')->assertNotFound();
});

// ────────────────────────────────────────────────────────────── las plantillas

it('sin plantilla se manda el texto de siempre', function () {
    $porDefecto = LinkMailer::compose('a@b.test', 'https://x/t/abc', 'Demo', 'es');
    $conEmpresa = LinkMailer::compose('a@b.test', 'https://x/t/abc', 'Demo', 'es', (string) $this->scenario->tenant->id);

    expect($conEmpresa['subject'])->toBe($porDefecto['subject']);
});

it('una plantilla a medias no deja el correo sin asunto', function () {
    // Con cuerpo propio y sin asunto, el asunto sigue siendo el de siempre. Una
    // plantilla no puede romper un aviso.
    $tenantId = (string) $this->scenario->tenant->id;

    Templates::save($tenantId, Templates::ENLACE_DE_RASTREO, 'es', null, 'Su carga va en camino: {url}');

    $mensaje = LinkMailer::compose('a@b.test', 'https://x/t/abc', 'Demo', 'es', $tenantId);

    expect($mensaje['subject'])->not->toBe('')
        ->and($mensaje['body'])->toContain('Su carga va en camino')
        ->and($mensaje['body'])->toContain('https://x/t/abc');
});

it('una ficha mal escrita se ve, no se vacía', function () {
    // `{{loadNumbre}}` mal escrito se ve en el correo y se arregla; sustituido
    // por vacío, no se entera nadie.
    expect(Templates::sustituir('Hola {{tenant}} y {{tenatn}}', ['tenant' => 'Demo']))
        ->toBe('Hola Demo y {{tenatn}}');
});

it('borrar los dos campos vuelve al texto de siempre', function () {
    $tenantId = (string) $this->scenario->tenant->id;

    Templates::save($tenantId, Templates::ENLACE_DE_RASTREO, 'es', 'Asunto propio', 'Cuerpo propio');
    expect(Templates::find($tenantId, Templates::ENLACE_DE_RASTREO, 'es'))->not->toBeNull();

    Templates::save($tenantId, Templates::ENLACE_DE_RASTREO, 'es', '', '');
    expect(Templates::find($tenantId, Templates::ENLACE_DE_RASTREO, 'es'))->toBeNull();
});

it('el pie de la empresa se añade al correo', function () {
    $tenantId = (string) $this->scenario->tenant->id;

    Brand::save($tenantId, null, null, 'Transportes Demo · 555 0100');

    $mensaje = LinkMailer::compose('a@b.test', 'https://x/t/abc', 'Demo', 'es', $tenantId);

    expect($mensaje['body'])->toContain('Transportes Demo · 555 0100');
});
