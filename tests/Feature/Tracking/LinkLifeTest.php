<?php

declare(strict_types=1);

use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use App\Support\Tracking\CustomerLink;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
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
 * «Ábralo cuando quiera… desde la recolección hasta la entrega.»
 *
 * Esa frase está en la página que lee un cliente antes de contratar, y está
 * declarada en `PublicClaims::RESPALDOS` con `CustomerLink` de respaldo. Lo que
 * se comprobó cuando entró fue la primera mitad —que el correo sale al
 * despachar—. La segunda no la comprobó nadie: el enlace vivía 72 horas y se
 * mandaba una sola vez.
 */
function clienteConContacto(Scenario $s): void
{
    app(TenantContext::class)->runAs($s->tenant->id, function () use ($s): void {
        DB::table('customer_contacts')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $s->tenant->id,
            'customer_id' => $s->customer->id,
            'first_name' => 'Tráfico',
            'last_name' => 'Cliente',
            'email' => 'trafico@cliente.test',
            'position' => 'traffic',
            'preferred_locale' => 'es',
            'is_primary' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });
}

function enlaceDe(Scenario $s): ?object
{
    return app(TenantContext::class)->runAs($s->tenant->id, fn () => DB::table('public_tracking_links')
        ->where('load_id', $s->load->id)
        ->orderByDesc('created_at')
        ->first(['id', 'expires_at', 'sent_at', 'revoked_at']));
}

it('el enlace dura lo que dura el viaje, no 72 horas', function () {
    clienteConContacto($this->scenario);

    // Un viaje de diez días. Con el plazo por omisión de la empresa —72 horas—
    // el cliente abría su enlace el cuarto día y leía «Enlace vencido».
    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        DB::table('loads')->where('id', $this->scenario->load->id)->update([
            'planned_delivery_at' => now()->addDays(10),
            'updated_at' => now(),
        ]);
    });

    expect(CustomerLink::sendForLoad(
        (string) $this->scenario->tenant->id,
        (string) $this->scenario->load->id,
        null,
    ))->toBe('sent');

    $enlace = enlaceDe($this->scenario);
    $plazo = TenantPolicy::for((string) $this->scenario->tenant->id)->publicTrackingTtlHours;

    // Hasta la entrega prevista MÁS el plazo de la empresa: el comprobante
    // llega tarde y el cliente mira el estado el lunes siguiente.
    expect(now()->diffInHours($enlace->expires_at))
        ->toBeGreaterThan(10 * 24 + $plazo - 2);
});

it('sin entrega prevista se cae al plazo de la empresa', function () {
    clienteConContacto($this->scenario);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        DB::table('loads')->where('id', $this->scenario->load->id)->update([
            'planned_delivery_at' => null,
            'updated_at' => now(),
        ]);
    });

    CustomerLink::sendForLoad((string) $this->scenario->tenant->id, (string) $this->scenario->load->id, null);

    $plazo = TenantPolicy::for((string) $this->scenario->tenant->id)->publicTrackingTtlHours;
    $horas = now()->diffInHours(enlaceDe($this->scenario)->expires_at);

    // Ni más ni menos que lo que había: una carga a la que nadie le puso fecha
    // no puede inventarse una.
    expect($horas)->toBeGreaterThan($plazo - 2)->toBeLessThan($plazo + 2);
});

it('una entrega ya pasada no acorta el enlace por debajo del plazo', function () {
    clienteConContacto($this->scenario);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        DB::table('loads')->where('id', $this->scenario->load->id)->update([
            'planned_delivery_at' => now()->subDays(5),
            'updated_at' => now(),
        ]);
    });

    CustomerLink::sendForLoad((string) $this->scenario->tenant->id, (string) $this->scenario->load->id, null);

    // La resta daría un número negativo. Un enlace que nace muerto es peor que
    // uno corto: el cliente recibe un correo que no sirve para nada.
    expect(now()->diffInHours(enlaceDe($this->scenario)->expires_at))
        ->toBeGreaterThan(TenantPolicy::for((string) $this->scenario->tenant->id)->publicTrackingTtlHours - 2);
});

it('un enlace vencido ya no bloquea el envío de otro', function () {
    clienteConContacto($this->scenario);

    CustomerLink::sendForLoad((string) $this->scenario->tenant->id, (string) $this->scenario->load->id, null);

    // Se vence a mano, que es lo que hace el calendario.
    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        DB::table('public_tracking_links')
            ->where('load_id', $this->scenario->load->id)
            ->update(['expires_at' => now()->subHour(), 'updated_at' => now()]);
    });

    // Antes contestaba `alreadySent` para siempre: `yaSeMando()` miraba si
    // alguno había salido, no si alguno seguía valiendo.
    expect(CustomerLink::sendForLoad(
        (string) $this->scenario->tenant->id,
        (string) $this->scenario->load->id,
        null,
    ))->toBe('sent');
});

it('uno vivo sí lo bloquea', function () {
    clienteConContacto($this->scenario);

    CustomerLink::sendForLoad((string) $this->scenario->tenant->id, (string) $this->scenario->load->id, null);

    // La otra mitad: despachar dos veces no puede mandarle dos correos al
    // cliente.
    expect(CustomerLink::sendForLoad(
        (string) $this->scenario->tenant->id,
        (string) $this->scenario->load->id,
        null,
    ))->toBe('alreadySent');
});

it('el barrido renueva el enlace de una carga que sigue rodando', function () {
    clienteConContacto($this->scenario);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        DB::table('loads')->where('id', $this->scenario->load->id)->update([
            'status' => 'in_transit',
            'updated_at' => now(),
        ]);
    });

    CustomerLink::sendForLoad((string) $this->scenario->tenant->id, (string) $this->scenario->load->id, null);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        DB::table('public_tracking_links')
            ->where('load_id', $this->scenario->load->id)
            ->update(['expires_at' => now()->subHour(), 'updated_at' => now()]);
    });

    Artisan::call('notifications:sweep');

    // La red de abajo: una entrega que se retrasa una semana deja el enlace
    // muerto con el camión todavía rodando.
    expect(now()->lt(enlaceDe($this->scenario)->expires_at))->toBeTrue();
});

it('el barrido no renueva el de una carga ya entregada', function () {
    clienteConContacto($this->scenario);

    CustomerLink::sendForLoad((string) $this->scenario->tenant->id, (string) $this->scenario->load->id, null);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        DB::table('loads')->where('id', $this->scenario->load->id)->update([
            'status' => 'delivered',
            'updated_at' => now(),
        ]);

        DB::table('public_tracking_links')
            ->where('load_id', $this->scenario->load->id)
            ->update(['expires_at' => now()->subHour(), 'updated_at' => now()]);
    });

    Artisan::call('notifications:sweep');

    // Un enlace que se renueva solo para siempre es una dirección pública que
    // nunca muere. El viaje se acabó.
    expect(now()->gt(enlaceDe($this->scenario)->expires_at))->toBeTrue();
});
