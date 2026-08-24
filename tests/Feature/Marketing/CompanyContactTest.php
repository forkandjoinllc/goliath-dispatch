<?php

declare(strict_types=1);

use App\Enums\Locale;
use App\Support\Company;
use App\Support\Site;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(fn () => app(TenantContext::class)->forget());
afterEach(fn () => app(TenantContext::class)->forget());

/* ── El sitio de la plataforma ──────────────────────────────────────────── */

it('el sitio público lleva el domicilio de la plataforma', function (string $locale) {
    $this->get(Site::path(Locale::from($locale), 'contact'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('company.legalName', 'Goliath Dispatch LLC')
            ->where('company.line1', '4474 Weston Rd')
            ->where('company.line2', 'Unit #2130')
            ->where('company.city', 'Davie')
            ->where('company.state', 'FL')
            ->where('company.postalCode', '33331')
            ->where('company.country', 'US')
        );
})->with(['en', 'es']);

it('el domicilio viaja también a las páginas legales', function () {
    // Privacidad y Términos lo pintan al final: un texto legal que no dice
    // QUIÉN se obliga obliga a poca cosa.
    foreach (['privacy', 'terms'] as $route) {
        $this->get(Site::path(Locale::from('en'), $route))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page->where('company.line1', '4474 Weston Rd'));
    }
});

it('no inventa teléfono ni correo', function () {
    // Un correo de contacto inventado es peor que no tener ninguno: alguien
    // escribe y nadie lo lee.
    $this->get(Site::path(Locale::from('en'), 'contact'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('company.phone', null)
            ->where('company.email', null)
        );
});

/* ── El sitio de una empresa cliente ────────────────────────────────────── */

it('bajo el dominio de un cliente NO se enseña el domicilio de Goliath', function () {
    $scenario = Scenario::create();

    // El cliente no ha rellenado su domicilio. Caer al de la plataforma le
    // diría a SUS visitantes que la empresa está en Davie, Florida.
    expect(Company::forSite((string) $scenario->tenant->id))->toBeNull();
});

it('bajo el dominio de un cliente se enseña el domicilio del cliente', function () {
    $scenario = Scenario::create();

    DB::table('tenant_settings')
        ->where('tenant_id', $scenario->tenant->id)
        ->update([
            'address_line1' => '900 Industrial Pkwy',
            'address_city' => 'Laredo',
            'address_state' => 'TX',
            'address_postal_code' => '78045',
            'address_country' => 'US',
            'contact_phone' => '+19565550142',
        ]);

    $company = Company::forSite((string) $scenario->tenant->id);

    expect($company['line1'])->toBe('900 Industrial Pkwy')
        ->and($company['city'])->toBe('Laredo')
        ->and($company['phone'])->toBe('+19565550142')
        // El nombre sale de la propia empresa, no de la configuración.
        ->and($company['legalName'])->toBe($scenario->tenant->legal_name);
});

it('una ciudad suelta sin calle no cuenta como domicilio', function () {
    $scenario = Scenario::create();

    DB::table('tenant_settings')
        ->where('tenant_id', $scenario->tenant->id)
        ->update(['address_city' => 'Laredo', 'address_state' => 'TX']);

    // Devolver el bloque a medias pintaría un encabezado «Oficina» encima de
    // una ciudad suelta.
    expect(Company::forSite((string) $scenario->tenant->id))->toBeNull();
});

/* ── Los dos idiomas ────────────────────────────────────────────────────── */

it('el nombre del país está en los dos diccionarios', function () {
    // El país se traduce; la calle no. Si esta clave falta, la página enseña
    // «marketing.company.countries.US» en crudo.
    foreach (['en', 'es'] as $locale) {
        $dictionary = json_decode(
            (string) file_get_contents(lang_path("{$locale}/marketing.json")),
            true,
            512,
            JSON_THROW_ON_ERROR
        );

        expect($dictionary['company']['countries']['US'] ?? null)->not->toBeNull();
    }
});
