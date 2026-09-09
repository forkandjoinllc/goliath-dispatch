<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Branding\Templates;
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
 * Las plantillas, guardadas y enviadas de verdad.
 *
 * El guardián de `tests/Unit/Suite` comprueba que el código llame a la
 * comprobación. Esto comprueba lo otro: que la ruta rechace, que no guarde nada
 * cuando rechaza, y —lo que de verdad importa— que una plantilla guardada ANTES
 * de la validación no salga con llaves al cliente.
 */

/** Manda el formulario de marca con una plantilla del enlace de rastreo. */
function guardarPlantilla(string $asunto, string $cuerpo): array
{
    return [
        'primary_color' => '#123456',
        'accent_color' => '#654321',
        'templates' => [
            ['event' => 'tracking.link', 'subject' => $asunto, 'body' => $cuerpo],
        ],
    ];
}

/* ── Al guardar ──────────────────────────────────────────────────────────── */

it('una ficha que ese correo no ofrece se rechaza', function () {
    signIn($this->scenario, Role::Admin);

    $this->from('/settings')
        ->post('/settings/branding', guardarPlantilla('Su carga', 'Enlace {url}. Factura {invoice}.'))
        ->assertSessionHasErrors('templates.0.body');

    // Y el mensaje NOMBRA la ficha que sobra. Un «esa ficha no vale» a secas
    // manda a adivinar cuál de las cuatro es, sobre un texto de 4000
    // caracteres.
    $errores = session('errors')->get('templates.0.body');

    expect($errores[0] ?? '')->toContain('{invoice}')
        ->and($errores[0] ?? '')->toContain('{url}');
});

it('también en el asunto, que es lo primero que se lee', function () {
    signIn($this->scenario, Role::Admin);

    $this->from('/settings')
        ->post('/settings/branding', guardarPlantilla('Su carga {invoice}', 'Enlace {url}.'))
        ->assertSessionHasErrors('templates.0.subject');
});

it('cuando se rechaza no se guarda nada', function () {
    // Es la razón de comprobarlo TODO antes de escribir: una plantilla a medias
    // es peor que ninguna, porque nadie sabe cuál de las dos quedó puesta.
    signIn($this->scenario, Role::Admin);

    $this->from('/settings')
        ->post('/settings/branding', guardarPlantilla('Su carga', 'Enlace {url}. Factura {invoice}.'))
        ->assertSessionHasErrors();

    app(TenantContext::class)->withoutTenant(function () {
        expect(DB::table('notification_templates')
            ->where('tenant_id', $this->scenario->tenant->id)
            ->where('event_key', 'tracking.link')
            ->exists())->toBeFalse();
    });
});

it('con las fichas de ese correo se guarda', function () {
    signIn($this->scenario, Role::Admin);

    $this->from('/settings')
        ->post('/settings/branding', guardarPlantilla('Su carga de {tenant}', 'Aquí tiene el enlace: {url}'))
        ->assertSessionHasNoErrors();

    app(TenantContext::class)->withoutTenant(function () {
        expect(DB::table('notification_templates')
            ->where('tenant_id', $this->scenario->tenant->id)
            ->where('event_key', 'tracking.link')
            ->value('body'))->toBe('Aquí tiene el enlace: {url}');
    });
});

it('la factura sí admite las suyas', function () {
    // Las dos plantillas están en la misma pantalla y no ofrecen lo mismo: la
    // comprobación tiene que ser POR EVENTO, no una lista común.
    signIn($this->scenario, Role::Admin);

    $this->from('/settings')
        ->post('/settings/branding', [
            'primary_color' => '#123456',
            'accent_color' => '#654321',
            'templates' => [
                ['event' => 'invoice.sent', 'subject' => 'Factura {invoice}', 'body' => '{tenant} le cobra {amount}: {url}'],
            ],
        ])
        ->assertSessionHasNoErrors();
});

/* ── Al enviar ───────────────────────────────────────────────────────────── */

it('una plantilla guardada antes de la validación no sale con llaves', function () {
    // El caso que importa de verdad, y el único que la validación no alcanza.
    // Se escribe directamente en la tabla, que es exactamente cómo llegó allí.
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->withoutTenant(function () use ($tenantId) {
        DB::table('notification_templates')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'event_key' => 'tracking.link',
            'channel' => 'email',
            'locale' => 'es',
            'subject' => 'Su carga {invoice}',
            'body' => 'Enlace de {tenant}: {url}. Factura {invoice} por {amount}.',
            'active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    $mensaje = Templates::render(
        $tenantId,
        'tracking.link',
        'es',
        ['tenant' => 'Escenario', 'url' => 'https://ejemplo/x'],
        'Enlace de {tenant}',
        'Aquí tiene su enlace: {url}',
    );

    // Ni una llave llega al cliente, en ninguno de los dos campos.
    expect($mensaje['subject'])->not->toContain('{')
        ->and($mensaje['body'])->not->toContain('{');

    // Y lo que sale es el texto de siempre, no una cadena recortada.
    expect($mensaje['subject'])->toBe('Enlace de Escenario')
        ->and($mensaje['body'])->toBe('Aquí tiene su enlace: https://ejemplo/x');
});

it('una plantilla limpia sí se usa', function () {
    // Sin esto, el arreglo podría ser «no usar nunca la plantilla de nadie» y
    // la prueba anterior pasaría igual.
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->withoutTenant(function () use ($tenantId) {
        DB::table('notification_templates')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'event_key' => 'tracking.link',
            'channel' => 'email',
            'locale' => 'es',
            'subject' => 'Su envío con {tenant}',
            'body' => 'Sígalo aquí: {url}',
            'active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    $mensaje = Templates::render(
        $tenantId,
        'tracking.link',
        'es',
        ['tenant' => 'Escenario', 'url' => 'https://ejemplo/x'],
        'De siempre',
        'De siempre',
    );

    expect($mensaje['subject'])->toBe('Su envío con Escenario')
        ->and($mensaje['body'])->toBe('Sígalo aquí: https://ejemplo/x');
});

it('un campo roto no arrastra al otro', function () {
    // El asunto y el cuerpo se deciden por separado: un asunto con una ficha
    // ajena no debe tirar por la borda un cuerpo que estaba bien.
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->withoutTenant(function () use ($tenantId) {
        DB::table('notification_templates')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'event_key' => 'tracking.link',
            'channel' => 'email',
            'locale' => 'es',
            'subject' => 'Su carga {invoice}',
            'body' => 'Sígalo aquí: {url}',
            'active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    $mensaje = Templates::render(
        $tenantId,
        'tracking.link',
        'es',
        ['tenant' => 'Escenario', 'url' => 'https://ejemplo/x'],
        'De siempre',
        'De siempre',
    );

    expect($mensaje['subject'])->toBe('De siempre')
        ->and($mensaje['body'])->toBe('Sígalo aquí: https://ejemplo/x');
});
