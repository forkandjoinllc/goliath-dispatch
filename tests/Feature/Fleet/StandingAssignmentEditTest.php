<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Fleet\StandingAssignment;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\FleetFixtures;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    $this->scenario->approveCarrierDocuments();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Terminar una asignación de equipo, cancelarla y corregirla.
 *
 * ## Lo que hacía el botón de terminar
 *
 * Ponía la fecha de fin a HOY. Y `ends_on` es el último día en que la
 * asignación VALE, así que seguía vigente: la ficha seguía diciendo «en
 * vigor», el aviso decía «asignación terminada», y el camión no se le podía
 * dar al relevo hasta el día siguiente. Lo que se mide aquí no es que la
 * columna cambie, sino que el camión QUEDA LIBRE.
 */
function asignacion(Scenario $s, string $conductor, string $camion, ?string $remolque, string $desde, ?string $hasta = null): string
{
    $choques = StandingAssignment::crear(
        (string) $s->tenant->id, $conductor, $camion, $remolque, $desde, $hasta,
    );

    expect($choques)->toBe([]);

    return (string) DB::table('driver_equipment_assignments')
        ->where('driver_id', $conductor)->where('truck_id', $camion)
        ->whereNull('deleted_at')->orderByDesc('created_at')->value('id');
}

/* ── Terminar ───────────────────────────────────────────────────────────── */

it('terminar deja el camión libre el mismo día, no el siguiente', function () {
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'L-1');
    $sale = FleetFixtures::conductor($this->scenario, 'Aurelio', 'Vidal');
    $entra = FleetFixtures::conductor($this->scenario, 'Noor', 'Haddad');

    $id = asignacion($this->scenario, $sale, $camion, null, now()->subMonths(2)->toDateString());

    $this->post("/drivers/{$sale}/equipment/{$id}/end")
        ->assertRedirect()
        ->assertSessionHas('success', __('drivers.standing.ended'));

    // Ya no es suyo…
    expect(StandingAssignment::deConductor((string) $this->scenario->tenant->id, $sale))->toBeNull();

    // …y el relevo lo puede coger HOY. Esta es la línea que fallaba.
    expect(StandingAssignment::crear(
        (string) $this->scenario->tenant->id,
        $entra,
        $camion,
        null,
        now()->toDateString(),
    ))->toBe([]);
});

it('una que empezó hoy dura hoy, y el aviso lo dice', function () {
    // La base no admite terminar antes de empezar, así que el suelo es el día
    // de comienzo. Decir «terminada» a secas sería mentir ese día.
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'L-2');
    $conductor = FleetFixtures::conductor($this->scenario, 'Petra', 'Losada');
    $id = asignacion($this->scenario, $conductor, $camion, null, now()->toDateString());

    // El aviso dice cuál de las dos cosas ha pasado, y lo dice con palabras:
    // una fecha en bruto dentro de una frase traducida se lee como un error.
    $this->post("/drivers/{$conductor}/equipment/{$id}/end")
        ->assertRedirect()
        ->assertSessionHas('success', __('drivers.standing.endedToday'));

    expect(DB::table('driver_equipment_assignments')->where('id', $id)->value('ends_on'))
        ->toStartWith(now()->toDateString());

    $vigente = StandingAssignment::deConductor((string) $this->scenario->tenant->id, $conductor);
    expect($vigente)->not->toBeNull();
    expect($vigente['endsOn'])->toBe(now()->toDateString());
});

it('lo que ya terminó no se vuelve a terminar', function () {
    // Sin esto, pulsar «Terminar» sobre una asignación de marzo le movería el
    // fin a ayer y la dejaría vigente cinco meses después de acabar.
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'L-3');
    $conductor = FleetFixtures::conductor($this->scenario, 'Íker', 'Monzón');
    $id = asignacion(
        $this->scenario, $conductor, $camion, null,
        now()->subMonths(5)->toDateString(),
        now()->subMonths(4)->toDateString(),
    );

    $antes = DB::table('driver_equipment_assignments')->where('id', $id)->value('ends_on');

    $this->post("/drivers/{$conductor}/equipment/{$id}/end")->assertNotFound();

    expect(DB::table('driver_equipment_assignments')->where('id', $id)->value('ends_on'))->toBe($antes);
});

/* ── Cancelar lo que no ha empezado ─────────────────────────────────────── */

it('lo que empieza más adelante se cancela, y no se termina', function () {
    // Terminarla la dejaría escrita como un tramo de un día en el futuro: un
    // camión ocupado el lunes por un conductor que nunca lo cogió.
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'L-4');
    $conductor = FleetFixtures::conductor($this->scenario, 'Sonia', 'Arrieta');
    $id = asignacion($this->scenario, $conductor, $camion, null, now()->addDays(7)->toDateString());

    $this->post("/drivers/{$conductor}/equipment/{$id}/end")->assertNotFound();

    $this->post("/drivers/{$conductor}/equipment/{$id}/cancel")->assertRedirect();

    expect(DB::table('driver_equipment_assignments')->where('id', $id)->value('deleted_at'))->not->toBeNull();

    // Y el camión queda libre para el lunes que viene.
    $otro = FleetFixtures::conductor($this->scenario, 'Tomás', 'Iriarte');
    expect(StandingAssignment::crear(
        (string) $this->scenario->tenant->id, $otro, $camion, null, now()->addDays(7)->toDateString(),
    ))->toBe([]);
});

it('lo que ya empezó no se cancela', function () {
    // Ahí sí hay historia: una carga de marzo se mira con el camión que se
    // llevó en marzo.
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'L-5');
    $conductor = FleetFixtures::conductor($this->scenario, 'Bruno', 'Cifuentes');
    $id = asignacion($this->scenario, $conductor, $camion, null, now()->subDay()->toDateString());

    $this->post("/drivers/{$conductor}/equipment/{$id}/cancel")->assertNotFound();

    expect(DB::table('driver_equipment_assignments')->where('id', $id)->value('deleted_at'))->toBeNull();
});

/* ── Corregir ───────────────────────────────────────────────────────────── */

it('corregir el remolque no deja dos tramos donde solo hubo uno', function () {
    // Antes había que terminar y crear otra. La ficha quedaba contando una
    // historia que no pasó.
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'L-6');
    $malo = FleetFixtures::remolque($this->scenario, 'RM-1');
    $bueno = FleetFixtures::remolque($this->scenario, 'RM-2');
    $conductor = FleetFixtures::conductor($this->scenario, 'Celia', 'Bermúdez');
    $desde = now()->subMonth()->toDateString();
    $id = asignacion($this->scenario, $conductor, $camion, $malo, $desde);

    $this->patch("/drivers/{$conductor}/equipment/{$id}", [
        'truck_id' => $camion,
        'trailer_id' => $bueno,
        'starts_on' => $desde,
        'notes' => 'Se apuntó mal el remolque al darlo de alta.',
    ])->assertRedirect();

    $vigente = StandingAssignment::deConductor((string) $this->scenario->tenant->id, $conductor);
    expect($vigente['trailerId'])->toBe($bueno);

    expect(DB::table('driver_equipment_assignments')
        ->where('driver_id', $conductor)->whereNull('deleted_at')->count())->toBe(1);

    expect(DB::table('driver_equipment_assignments')->where('id', $id)->value('notes'))
        ->toBe('Se apuntó mal el remolque al darlo de alta.');
});

it('corregir sin cambiar de camión no choca consigo misma', function () {
    // `choques()` sabía excluir una fila desde que nació y nadie lo usaba: sin
    // eso, cambiar solo la nota diría que ese camión ya está ocupado — por ella.
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'L-7');
    $conductor = FleetFixtures::conductor($this->scenario, 'Hugo', 'Barragán');
    $desde = now()->subMonth()->toDateString();
    $id = asignacion($this->scenario, $conductor, $camion, null, $desde);

    $this->patch("/drivers/{$conductor}/equipment/{$id}", [
        'truck_id' => $camion,
        'starts_on' => $desde,
        'notes' => 'Solo la nota.',
    ])->assertSessionHasNoErrors();
});

it('corregir hacia un camión que lleva otro se rechaza', function () {
    signIn($this->scenario, Role::Admin);

    $suyo = FleetFixtures::camion($this->scenario, 'L-8');
    $ajeno = FleetFixtures::camion($this->scenario, 'L-9');
    $uno = FleetFixtures::conductor($this->scenario, 'Lucía', 'Pardo');
    $otro = FleetFixtures::conductor($this->scenario, 'Damián', 'Roca');
    $desde = now()->subMonth()->toDateString();

    $id = asignacion($this->scenario, $uno, $suyo, null, $desde);
    asignacion($this->scenario, $otro, $ajeno, null, $desde);

    $this->from("/drivers/{$uno}")->patch("/drivers/{$uno}/equipment/{$id}", [
        'truck_id' => $ajeno,
        'starts_on' => $desde,
    ])->assertSessionHasErrors('truck_id');

    expect(StandingAssignment::deConductor((string) $this->scenario->tenant->id, $uno)['truckId'])->toBe($suyo);
});

it('una asignación de otro conductor no se corrige desde esta ficha', function () {
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'L-10');
    $dueño = FleetFixtures::conductor($this->scenario, 'Marta', 'Elizalde');
    $ajeno = FleetFixtures::conductor($this->scenario, 'Óscar', 'Nieto');
    $desde = now()->subMonth()->toDateString();
    $id = asignacion($this->scenario, $dueño, $camion, null, $desde);

    // 404 y no 403: decir «no puedes» sobre algo que no es suyo lo confirma.
    $this->patch("/drivers/{$ajeno}/equipment/{$id}", [
        'truck_id' => $camion,
        'starts_on' => $desde,
    ])->assertNotFound();
});

/* ── Lo que viene no es historia ────────────────────────────────────────── */

it('lo que empieza más adelante sale aparte y no bajo el título de antes', function () {
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'L-11');
    $futuro = FleetFixtures::camion($this->scenario, 'L-12');
    $conductor = FleetFixtures::conductor($this->scenario, 'Emilia', 'Sandoval');

    asignacion($this->scenario, $conductor, $camion, null, now()->subMonth()->toDateString(), now()->addDays(3)->toDateString());
    asignacion($this->scenario, $conductor, $futuro, null, now()->addDays(10)->toDateString());

    $this->get("/drivers/{$conductor}")->assertInertia(
        fn (Assert $page) => $page
            ->where('standing.current.truck', 'L-11')
            ->where('standing.upcoming.0.truck', 'L-12')
            ->where('standing.past', []),
    );
});

it('el formulario de corregir ofrece el camión que ya lleva', function () {
    // Si no, la casilla nace vacía: el valor está puesto y la lista no lo
    // contiene. Y el camión es obligatorio.
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'L-13');
    $conductor = FleetFixtures::conductor($this->scenario, 'Nadia', 'Estévez');
    asignacion($this->scenario, $conductor, $camion, null, now()->subMonth()->toDateString());

    $this->get("/drivers/{$conductor}")->assertInertia(
        fn (Assert $page) => $page->where(
            'equipmentChoices.trucks',
            fn ($camiones) => collect($camiones)->contains(fn ($c) => $c['id'] === $camion),
        ),
    );
});

it('el camión de otro sigue sin ofrecerse', function () {
    // La regla de «un camión, un conductor a la vez» lo rechazaría al
    // guardar, y ofrecer algo que se va a rechazar es hacer perder el viaje.
    signIn($this->scenario, Role::Admin);

    $suyo = FleetFixtures::camion($this->scenario, 'L-14');
    $ajeno = FleetFixtures::camion($this->scenario, 'L-15');
    $conductor = FleetFixtures::conductor($this->scenario, 'Paula', 'Zúñiga');
    $otro = FleetFixtures::conductor($this->scenario, 'Rafa', 'Lozano');

    asignacion($this->scenario, $conductor, $suyo, null, now()->subMonth()->toDateString());
    asignacion($this->scenario, $otro, $ajeno, null, now()->subMonth()->toDateString());

    $this->get("/drivers/{$conductor}")->assertInertia(
        fn (Assert $page) => $page->where(
            'equipmentChoices.trucks',
            fn ($camiones) => ! collect($camiones)->contains(fn ($c) => $c['id'] === $ajeno),
        ),
    );
});
