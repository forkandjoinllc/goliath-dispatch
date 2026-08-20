<?php

declare(strict_types=1);

use App\Enums\OnboardingStatus;
use App\Exceptions\MissingTenantContextException;
use App\Models\Carrier;
use App\Models\Lead;
use App\Models\Tenant;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;

uses(DatabaseTransactions::class);

/**
 * El aislamiento entre empresas tiene dos capas y aquí se prueban las dos:
 * TenantScope (que impide LEER de más) y las claves foráneas compuestas del
 * esquema (que impiden ESCRIBIR mal). Ninguna cubre lo de la otra.
 */
beforeEach(function () {
    $this->context = app(TenantContext::class);
    $this->context->forget();

    $this->tenantA = Tenant::create([
        'slug' => 'test-a-'.Str::random(6),
        'legal_name' => 'Empresa A LLC',
        'display_name' => 'Empresa A',
        'status' => 'active',
    ]);
    $this->tenantB = Tenant::create([
        'slug' => 'test-b-'.Str::random(6),
        'legal_name' => 'Empresa B LLC',
        'display_name' => 'Empresa B',
        'status' => 'active',
    ]);
});

afterEach(function () {
    app(TenantContext::class)->forget();
});

function makeCarrier(string $tenantId, string $dot, string $name = 'Transportista'): Carrier
{
    return app(TenantContext::class)->runAs($tenantId, fn () => Carrier::create([
        'legal_name' => $name,
        'dot_number' => $dot,
        'contact_first_name' => 'Ana',
        'contact_last_name' => 'Díaz',
        'email' => 'ops@'.Str::random(6).'.test',
        'phone' => '+15550100',
        'onboarding_status' => OnboardingStatus::Draft,
    ]));
}

/* ── Sin contexto: lanza, no devuelve vacío ─────────────────────────────── */

it('lanza al consultar una tabla con empresa sin contexto', function () {
    Carrier::query()->get();
})->throws(MissingTenantContextException::class);

it('el mensaje dice qué modelo y cómo arreglarlo', function () {
    try {
        Carrier::query()->count();
        $this->fail('debería haber lanzado');
    } catch (MissingTenantContextException $e) {
        expect($e->getMessage())
            ->toContain('Carrier')
            ->toContain('runAs')
            ->toContain('withoutTenant');
    }
});

it('NO devuelve cero filas cuando falta el contexto', function () {
    // Esta es la prueba del comportamiento que se eligió a propósito. Devolver
    // una colección vacía haría que un informe olvidadizo pareciera "sin datos".
    makeCarrier($this->tenantA->id, '9000001');
    expect(fn () => Carrier::query()->get())->toThrow(MissingTenantContextException::class);
});

it('las tablas sin tenant_id se consultan sin contexto', function () {
    expect(Tenant::query()->count())->toBeGreaterThanOrEqual(2);
});

/* ── Con contexto: solo lo propio ───────────────────────────────────────── */

it('solo ve los registros de la empresa activa', function () {
    makeCarrier($this->tenantA->id, '9100001', 'De A');
    makeCarrier($this->tenantB->id, '9100002', 'De B');

    $this->context->runAs($this->tenantA->id, function () {
        expect(Carrier::pluck('legal_name')->all())->toBe(['De A']);
    });

    $this->context->runAs($this->tenantB->id, function () {
        expect(Carrier::pluck('legal_name')->all())->toBe(['De B']);
    });
});

it('find() de un id de otra empresa devuelve null, no el registro', function () {
    $carrierB = makeCarrier($this->tenantB->id, '9200001');

    $this->context->runAs($this->tenantA->id, function () use ($carrierB) {
        // Conocer el UUID no basta: el scope se aplica también a find().
        expect(Carrier::find($carrierB->id))->toBeNull();
    });
});

it('count y aggregates también quedan estrechados', function () {
    makeCarrier($this->tenantA->id, '9300001');
    makeCarrier($this->tenantB->id, '9300002');
    makeCarrier($this->tenantB->id, '9300003');

    $this->context->runAs($this->tenantA->id, fn () => expect(Carrier::count())->toBe(1));
    $this->context->runAs($this->tenantB->id, fn () => expect(Carrier::count())->toBe(2));
});

/* ── Escritura ──────────────────────────────────────────────────────────── */

it('rellena tenant_id al crear', function () {
    $carrier = makeCarrier($this->tenantA->id, '9400001');
    expect($carrier->tenant_id)->toBe($this->tenantA->id);
});

it('no permite mover un registro de una empresa a otra', function () {
    $carrier = makeCarrier($this->tenantA->id, '9500001');

    $this->context->runAs($this->tenantA->id, function () use ($carrier) {
        $carrier->tenant_id = $this->tenantB->id;
        expect(fn () => $carrier->save())->toThrow(LogicException::class);
    });
});

it('un tenant_id explícito distinto del contexto se respeta al crear', function () {
    // Es intencionado: un trabajo de plataforma puede necesitar sembrar datos de
    // otra empresa. Lo que NO se permite es cambiarlo después (prueba anterior).
    $carrier = $this->context->runAs($this->tenantA->id, fn () => Carrier::create([
        'tenant_id' => $this->tenantB->id,
        'legal_name' => 'Explícito',
        'dot_number' => '9600001',
        'contact_first_name' => 'X', 'contact_last_name' => 'Y',
        'email' => 'x@y.test', 'phone' => '+15550111',
        'onboarding_status' => OnboardingStatus::Draft,
    ]));
    expect($carrier->tenant_id)->toBe($this->tenantB->id);
});

/* ── La vía de escape ───────────────────────────────────────────────────── */

it('withoutTenant ve todas las empresas', function () {
    makeCarrier($this->tenantA->id, '9700001');
    makeCarrier($this->tenantB->id, '9700002');

    $this->context->withoutTenant(function () {
        expect(Carrier::whereIn('dot_number', ['9700001', '9700002'])->count())->toBe(2);
    });
});

it('withoutTenantScope quita el estrechamiento solo en esa consulta', function () {
    makeCarrier($this->tenantB->id, '9800001');

    $this->context->runAs($this->tenantA->id, function () {
        expect(Carrier::where('dot_number', '9800001')->count())->toBe(0);
        expect(Carrier::withoutTenantScope()->where('dot_number', '9800001')->count())->toBe(1);
        // Y la siguiente consulta vuelve a estar estrechada.
        expect(Carrier::where('dot_number', '9800001')->count())->toBe(0);
    });
});

it('runAs y withoutTenant restauran el estado anterior incluso si lanza', function () {
    $this->context->set($this->tenantA->id);

    try {
        $this->context->runAs($this->tenantB->id, function () {
            throw new RuntimeException('boom');
        });
    } catch (RuntimeException) {
        // esperado
    }
    expect($this->context->id())->toBe($this->tenantA->id);

    try {
        $this->context->withoutTenant(function () {
            throw new RuntimeException('boom');
        });
    } catch (RuntimeException) {
        // esperado
    }
    expect($this->context->id())->toBe($this->tenantA->id);
    expect($this->context->isUnscoped())->toBeFalse();
});

it('anida runAs correctamente', function () {
    $this->context->runAs($this->tenantA->id, function () {
        expect($this->context->id())->toBe($this->tenantA->id);
        $this->context->runAs($this->tenantB->id, function () {
            expect($this->context->id())->toBe($this->tenantB->id);
        });
        expect($this->context->id())->toBe($this->tenantA->id);
    });
});

/* ── La segunda capa: la base de datos ──────────────────────────────────── */

it('la base de datos rechaza un hijo que apunta al padre de otra empresa', function () {
    $carrierB = makeCarrier($this->tenantB->id, '9900001');

    // Aunque el código de la aplicación se equivoque, la clave foránea compuesta
    // (tenant_id, carrier_id) -> carriers (tenant_id, id) lo impide.
    $this->context->runAs($this->tenantA->id, function () use ($carrierB) {
        expect(fn () => DB::table('carrier_onboardings')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenantA->id,
            'carrier_id' => $carrierB->id,
            'status' => 'draft',
            'created_at' => now()->format('Y-m-d H:i:s.v'),
            'updated_at' => now()->format('Y-m-d H:i:s.v'),
        ]))->toThrow(QueryException::class);
    });
});

it('el borrado suave libera la clave natural', function () {
    $first = makeCarrier($this->tenantA->id, '9950001', 'Primero');

    $this->context->runAs($this->tenantA->id, function () use ($first) {
        // Mientras esté vivo, el DOT está tomado.
        expect(fn () => Carrier::create([
            'legal_name' => 'Clon', 'dot_number' => '9950001',
            'contact_first_name' => 'C', 'contact_last_name' => 'L',
            'email' => 'c@l.test', 'phone' => '+15550122',
            'onboarding_status' => OnboardingStatus::Draft,
        ]))->toThrow(QueryException::class);

        $first->delete();

        // Borrado en suave: el número vuelve a estar disponible.
        $reborn = Carrier::create([
            'legal_name' => 'Renacido', 'dot_number' => '9950001',
            'contact_first_name' => 'R', 'contact_last_name' => 'N',
            'email' => 'r@n.test', 'phone' => '+15550123',
            'onboarding_status' => OnboardingStatus::Draft,
        ]);
        expect($reborn->exists)->toBeTrue();
        expect(Carrier::where('dot_number', '9950001')->count())->toBe(1);
        expect(Carrier::withTrashed()->where('dot_number', '9950001')->count())->toBe(2);
    });
});

it('el mismo DOT en dos empresas son dos transportistas independientes', function () {
    makeCarrier($this->tenantA->id, '9960001', 'En A');
    makeCarrier($this->tenantB->id, '9960001', 'En B');

    $this->context->withoutTenant(function () {
        expect(Carrier::where('dot_number', '9960001')->count())->toBe(2);
    });
});

/* ── El ámbito de plataforma ────────────────────────────────────────────── */

it('el ámbito de plataforma ve solo lo que no pertenece a ninguna empresa', function () {
    // `leads` admite tenant_id NULL: un formulario en el sitio público de
    // Goliath produce un lead de la plataforma; el mismo formulario en el
    // dominio propio de una empresa produce un lead de esa empresa.
    $this->context->set(null);
    $platformLead = Lead::create([
        'first_name' => 'Plat', 'last_name' => 'Form',
        'email' => 'plat-'.Str::random(6).'@example.test',
        'source' => 'contact_form',
    ]);
    expect($platformLead->tenant_id)->toBeNull();

    $tenantLead = $this->context->runAs($this->tenantA->id, fn () => Lead::create([
        'first_name' => 'Ten', 'last_name' => 'Ant',
        'email' => 'ten-'.Str::random(6).'@example.test',
        'source' => 'contact_form',
    ]));
    expect($tenantLead->tenant_id)->toBe($this->tenantA->id);

    // La plataforma ve el suyo y NO el de la empresa.
    $this->context->set(null);
    $ids = Lead::pluck('id')->all();
    expect($ids)->toContain($platformLead->id);
    expect($ids)->not->toContain($tenantLead->id);

    // Y la empresa ve el suyo y no el de la plataforma.
    $this->context->runAs($this->tenantA->id, function () use ($platformLead, $tenantLead) {
        $ids = Lead::pluck('id')->all();
        expect($ids)->toContain($tenantLead->id);
        expect($ids)->not->toContain($platformLead->id);
    });

    // withoutTenant los ve los dos: eso es lo que significa «sin frontera».
    $this->context->withoutTenant(function () use ($platformLead, $tenantLead) {
        $ids = Lead::pluck('id')->all();
        expect($ids)->toContain($platformLead->id)->toContain($tenantLead->id);
    });
});

it('plataforma y sin-frontera son estados distintos', function () {
    $this->context->set(null);
    expect($this->context->isPlatform())->toBeTrue();
    expect($this->context->isUnscoped())->toBeFalse();

    $this->context->withoutTenant(function () {
        expect($this->context->isPlatform())->toBeFalse();
        expect($this->context->isUnscoped())->toBeTrue();
    });

    $this->context->forget();
    // Sin definir NO es plataforma: sigue lanzando.
    expect($this->context->isPlatform())->toBeFalse();
    expect(fn () => Lead::count())->toThrow(MissingTenantContextException::class);
});
