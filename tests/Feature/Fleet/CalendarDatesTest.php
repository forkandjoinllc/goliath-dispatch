<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Lo que sale por el cable es un día, no un instante.
 *
 * El guardián de `tests/Unit/Suite/CalendarDatesTest.php` sujeta la estructura.
 * Esto pide las pantallas y mira la CADENA que viaja: diez caracteres y ni uno
 * más. Es donde estaba el defecto —`2026-06-01T00:00:00+00:00`— y es lo único
 * que el navegador puede volver a mover.
 */
function conductorConPapeles(Scenario $s, string $licencia = '2026-06-01', string $medica = '2026-07-15'): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $licencia, $medica): string {
        $id = (string) Str::uuid();

        DB::table('drivers')->insert([
            'id' => $id,
            'tenant_id' => $s->tenant->id,
            'first_name' => 'Eduardo',
            'last_name' => 'Salas',
            'license_state' => 'TX',
            'license_number_hash' => hash('sha256', Str::random(16)),
            'license_number_last4' => '0042',
            'cdl_class' => 'A',
            // A medianoche, que es como las escribe el formulario.
            'license_expires_at' => $licencia.' 00:00:00',
            'medical_card_expires_at' => $medica.' 00:00:00',
            'twic_expires_at' => '2027-03-09 00:00:00',
            'record_checked_at' => '2026-02-28 00:00:00',
            'status' => 'available',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    });
}

function camionConPapeles(Scenario $s): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s): string {
        $id = (string) Str::uuid();

        DB::table('trucks')->insert([
            'id' => $id,
            'tenant_id' => $s->tenant->id,
            'carrier_id' => $s->assignedCarrier->id,
            'unit_number' => 'U-4242',
            'vin' => Str::upper(Str::random(17)),
            'vin_normalized' => Str::upper(Str::random(17)),
            'status' => 'active',
            'registration_expires_at' => '2026-06-01 00:00:00',
            'next_inspection_due_at' => '2026-06-30 00:00:00',
            'last_inspection_at' => '2025-06-30 00:00:00',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    });
}

/* ── Conductores ───────────────────────────────────────────────────────── */

it('la caducidad de la licencia viaja como día, no como instante', function () {
    conductorConPapeles($this->scenario);
    signIn($this->scenario, Role::Admin);

    $this->get('/drivers')
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $filas = collect($page->toArray()['props']['drivers']['data']);
            $nuestro = $filas->firstWhere('licenseLast4', '0042');

            expect($nuestro)->not->toBeNull();

            // Diez caracteres. Con el instante —`2026-06-01T00:00:00+00:00`—
            // el navegador de cualquiera al oeste de Greenwich pintaba «31
            // may», un día antes que el formulario del mismo conductor.
            expect($nuestro['licenseExpiresAt'])->toBe('2026-06-01');
            expect($nuestro['medicalCardExpiresAt'])->toBe('2026-07-15');
        });
});

it('la ficha del conductor dice lo mismo que el listado', function () {
    $id = conductorConPapeles($this->scenario);
    signIn($this->scenario, Role::Admin);

    // Las dos pantallas y el formulario salían del mismo dato y decían dos
    // cosas. Que coincidan es media prueba; la otra media es que coincidan con
    // lo que hay en la base.
    $this->get("/drivers/{$id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('driver.licenseExpiresAt', '2026-06-01')
            ->where('driver.medicalCardExpiresAt', '2026-07-15')
            ->where('driver.twicExpiresAt', '2027-03-09')
            ->where('driver.recordCheckedAt', '2026-02-28'));
});

it('el formulario de edición lleva el mismo día', function () {
    $id = conductorConPapeles($this->scenario);
    signIn($this->scenario, Role::Admin);

    // El `<input type="date">` corta a diez caracteres, así que aquí nunca
    // falló. Es la pantalla contra la que se descubrió la diferencia.
    $this->get("/drivers/{$id}/edit")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('driver.licenseExpiresAt', '2026-06-01'));
});

it('el aviso de vencimiento lo sigue calculando el servidor', function () {
    // Una licencia vencida ayer y una que vence dentro de un año.
    conductorConPapeles(
        $this->scenario,
        licencia: now()->subDay()->toDateString(),
        medica: now()->addYear()->toDateString(),
    );

    signIn($this->scenario, Role::Admin);

    $this->get('/drivers')
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $fila = collect($page->toArray()['props']['drivers']['data'])
                ->firstWhere('licenseLast4', '0042');

            // La insignia no se calcula en el navegador, y por eso mandar el
            // día no la toca: el color y la fecha tienen que seguir contando lo
            // mismo. Antes podían contradecirse en la frontera.
            expect($fila['expiries']['license'])->toBe('expired');
            expect($fila['expiries']['medical'])->toBeNull();
        });
});

/* ── Equipos ───────────────────────────────────────────────────────────── */

it('la matrícula y la inspección viajan como día', function () {
    camionConPapeles($this->scenario);
    signIn($this->scenario, Role::Admin);

    $this->get('/equipment/trucks')
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $fila = collect($page->toArray()['props']['units']['data'])
                ->firstWhere('unitNumber', 'U-4242');

            expect($fila)->not->toBeNull();
            expect($fila['registrationExpiresAt'])->toBe('2026-06-01');
            expect($fila['nextInspectionDueAt'])->toBe('2026-06-30');
        });
});

it('la ficha del camión también, y su alta sigue siendo un instante', function () {
    $id = camionConPapeles($this->scenario);
    signIn($this->scenario, Role::Admin);

    $this->get("/equipment/trucks/{$id}")
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $unidad = $page->toArray()['props']['unit'];

            expect($unidad['registrationExpiresAt'])->toBe('2026-06-01');
            expect($unidad['lastInspectionAt'])->toBe('2025-06-30');

            // Y `createdAt` NO: cuándo se metió la unidad en el sistema es un
            // instante, y ese sí hay que convertirlo al huso de quien mira. Un
            // lote que convierte días en días y de paso aplana los instantes
            // cambia un defecto por otro.
            expect($unidad['createdAt'])->toContain('T');
        });
});
