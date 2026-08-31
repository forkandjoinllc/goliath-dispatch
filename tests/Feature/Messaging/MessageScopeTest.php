<?php

declare(strict_types=1);

use App\Authorization\ActorFactory;
use App\Enums\Role;
use App\Enums\Scope;
use App\Models\Conversation;
use App\Support\Messaging\MessageScope;
use App\Support\Messaging\Threads;
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
 * El Actor de un rol, construido como lo construye la aplicación.
 *
 * Con ActorFactory y NO cogiéndolo de CurrentActor después de un signIn(). El
 * Actor vive dentro de una petición: fuera de ella, `role` y `tenantId` llegan
 * en nulo y todo lo que dependa de ellos se comporta distinto que en la
 * aplicación. Costó media hora descubrirlo — ver docs/testing.md.
 */
function actorDeRol(Scenario $scenario, Role $rol): App\Authorization\Actor
{
    app(TenantContext::class)->set((string) $scenario->tenant->id);

    // `fresh()` y no el modelo que Scenario tiene en memoria: ese se construyó
    // con los atributos del insert, y `locale` lo rellena la base de datos.
    // ActorFactory hace `Locale::from()` sobre él y una cadena vacía revienta.
    $usuario = $scenario->user($rol)->fresh();

    return app(ActorFactory::class)->for($usuario, (string) $scenario->tenant->id);
}

/** Un hilo suelto de la empresa, sin nadie dentro. */
function hiloSuelto(Scenario $scenario, ?string $loadId = null, ?string $carrierId = null): string
{
    $id = (string) Str::uuid();

    DB::table('conversations')->insert([
        'id' => $id,
        'tenant_id' => $scenario->tenant->id,
        'subject' => 'Un asunto',
        'kind' => $loadId === null ? 'direct' : 'load',
        'load_id' => $loadId,
        'carrier_id' => $carrierId,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

/* ── La regla: se ve desde dentro ────────────────────────────────────────── */

it('un hilo en el que no estás no se ve, aunque seas administrador', function () {
    // Es LA decisión de este módulo. Si `message:read` con alcance de empresa
    // dejara leer cualquier hilo, «hablar en privado con contabilidad» no
    // existiría en este producto y la gente se iría a WhatsApp — que es
    // exactamente lo que este módulo viene a evitar.
    $actor = actorDeRol($this->scenario, Role::Admin);
    $hilo = hiloSuelto($this->scenario);

    expect(MessageScope::apply(Conversation::query(), app(App\Authorization\PermissionChecker::class), $actor, Scope::Tenant)
        ->where('conversations.id', $hilo)->exists())->toBeFalse();
});

it('el mismo hilo se ve en cuanto te meten dentro', function () {
    $actor = actorDeRol($this->scenario, Role::Admin);
    $hilo = hiloSuelto($this->scenario);

    Threads::addParticipant($actor, $hilo, $actor);

    expect(MessageScope::apply(Conversation::query(), app(App\Authorization\PermissionChecker::class), $actor, Scope::Tenant)
        ->where('conversations.id', $hilo)->exists())->toBeTrue();
});

it('meterse en un hilo queda en la bitácora', function () {
    // Sin este rastro la regla no valdría nada: bastaría entrar, leer y salirse.
    $actor = actorDeRol($this->scenario, Role::Admin);
    $hilo = hiloSuelto($this->scenario);

    Threads::addParticipant($actor, $hilo, $actor);

    $evento = app(TenantContext::class)->withoutTenant(fn () => DB::table('audit_events')
        ->where('entity_type', 'conversation')
        ->where('entity_id', $hilo)
        ->where('action', 'message.participant_added')
        ->first());

    expect($evento)->not->toBeNull();
    expect((string) $evento->actor_user_id)->toBe((string) $actor->userId);
});

it('volver a añadir a quien ya está no repite el evento', function () {
    // Un acto repetido no es un acto nuevo. Una bitácora que anota lo mismo
    // cinco veces se vuelve imposible de leer, que es como no tenerla.
    $actor = actorDeRol($this->scenario, Role::Admin);
    $hilo = hiloSuelto($this->scenario);

    Threads::addParticipant($actor, $hilo, $actor);
    Threads::addParticipant($actor, $hilo, $actor);
    Threads::addParticipant($actor, $hilo, $actor);

    $n = app(TenantContext::class)->withoutTenant(fn () => DB::table('audit_events')
        ->where('entity_id', $hilo)
        ->where('action', 'message.participant_added')
        ->count());

    expect($n)->toBe(1);

    // Y una sola fila de participante: el único (conversation_id, user_id) del
    // esquema reventaría con dos.
    expect(DB::table('conversation_participants')->where('conversation_id', $hilo)->count())->toBe(1);
});

it('quien vuelve reutiliza su fila en vez de insertar otra', function () {
    // El único (conversation_id, user_id) no admite una fila nueva. Si
    // addParticipant insertara siempre, volver a entrar sería un error de clave
    // duplicada — y el sitio donde se descubriría sería producción.
    $actor = actorDeRol($this->scenario, Role::Admin);
    $hilo = hiloSuelto($this->scenario);

    Threads::addParticipant($actor, $hilo, $actor);
    Threads::removeParticipant($actor, $hilo, (string) $actor->userId);

    expect(MessageScope::apply(Conversation::query(), app(App\Authorization\PermissionChecker::class), $actor, Scope::Tenant)
        ->where('conversations.id', $hilo)->exists())->toBeFalse();

    Threads::addParticipant($actor, $hilo, $actor);

    expect(MessageScope::apply(Conversation::query(), app(App\Authorization\PermissionChecker::class), $actor, Scope::Tenant)
        ->where('conversations.id', $hilo)->exists())->toBeTrue();

    expect(DB::table('conversation_participants')->where('conversation_id', $hilo)->count())->toBe(1);
});

it('meter a alguien sin rol conocido revienta, no calla', function () {
    // Quien llama a esto está CONCEDIENDO ACCESO. Un retorno callado deja al que
    // llama creyendo que metió a alguien cuando no lo hizo: el despachador manda
    // el mensaje, el transportista no lo recibe nunca, y nadie se entera hasta
    // que hay una reclamación.
    $actor = actorDeRol($this->scenario, Role::Admin);
    $hilo = hiloSuelto($this->scenario);

    Threads::addParticipant($actor, $hilo, (string) Str::uuid());
})->throws(RuntimeException::class);

/* ── Y además el alcance ─────────────────────────────────────────────────── */

it('el alcance corta aunque la pertenencia diga que sí', function () {
    // Las dos mitades no son redundantes. La pertenencia contesta «¿me
    // metieron?»; el alcance contesta «¿me PODÍAN meter?». Una fila mal escrita
    // en `conversation_participants` —un fallo al añadir, un hilo creado desde
    // la carga equivocada— le enseñaría a un transportista la conversación de
    // otro. Con las dos hace falta equivocarse dos veces.
    $actor = actorDeRol($this->scenario, Role::Carrier);

    $hilo = hiloSuelto(
        $this->scenario,
        loadId: (string) $this->scenario->otherLoad->id,
        carrierId: (string) $this->scenario->otherCarrier->id,
    );

    // La fila que no debería existir, escrita a mano.
    DB::table('conversation_participants')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'conversation_id' => $hilo,
        'user_id' => $actor->userId,
        'role' => 'carrier',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    expect(MessageScope::apply(Conversation::query(), app(App\Authorization\PermissionChecker::class), $actor, Scope::Carrier)
        ->where('conversations.id', $hilo)->exists())->toBeFalse();
});

it('el hilo de su propia carga sí lo ve el transportista', function () {
    $actor = actorDeRol($this->scenario, Role::Carrier);

    $hilo = hiloSuelto(
        $this->scenario,
        loadId: (string) $this->scenario->load->id,
        carrierId: (string) $this->scenario->assignedCarrier->id,
    );

    Threads::addParticipant($actor, $hilo, $actor);

    expect(MessageScope::apply(Conversation::query(), app(App\Authorization\PermissionChecker::class), $actor, Scope::Carrier)
        ->where('conversations.id', $hilo)->exists())->toBeTrue();
});

it('el despachador de la carga ve su hilo aunque no lleve al transportista', function () {
    // ESTE ES EL FALLO QUE ENCONTRÓ EL NAVEGADOR, y no lo vio ninguna de las
    // ocho pruebas de arriba.
    //
    // Un despachador alcanza una carga por dos caminos —el transportista que
    // lleva, o ser él mismo el `dispatcher_user_id`— y `ScopeFilter` los une con
    // un OR. La primera versión de MessageScope solo miraba el primero, así que
    // un despachador que abría el hilo de SU PROPIA carga recibía un 404 en el
    // hilo que acababa de crear.
    //
    // No se veía porque el escenario asigna el despachador al transportista: el
    // primer camino tapaba siempre al segundo. Aquí se le quita la asignación, y
    // así queda —como en los datos de demostración, donde el despachador no
    // lleva ningún transportista.
    $actor = actorDeRol($this->scenario, Role::Dispatcher);

    DB::table('dispatcher_resource_assignments')
        ->where('dispatcher_user_id', $actor->userId)
        ->update(['deleted_at' => now(), 'updated_at' => now()]);

    // Y el Actor se reconstruye: las asignaciones se calculan al construirlo.
    $actor = actorDeRol($this->scenario, Role::Dispatcher);

    expect($actor->assignments->carrierIds)->toBe([]);

    // El otro camino: es SU carga. Es como están los datos de demostración —
    // toda carga sembrada lleva `dispatcher_user_id`, y el despachador no tiene
    // ninguna asignación de transportista.
    DB::table('loads')->where('id', $this->scenario->load->id)->update([
        'dispatcher_user_id' => $actor->userId,
        'updated_at' => now(),
    ]);

    $hilo = hiloSuelto(
        $this->scenario,
        loadId: (string) $this->scenario->load->id,
        carrierId: (string) $this->scenario->assignedCarrier->id,
    );

    Threads::addParticipant($actor, $hilo, $actor);

    expect(MessageScope::apply(Conversation::query(), app(App\Authorization\PermissionChecker::class), $actor, Scope::Assigned)
        ->where('conversations.id', $hilo)->exists())->toBeTrue();
});

it('un hilo de carga sin transportista se ve por la carga', function () {
    // `conversations.carrier_id` puede estar vacío en un hilo abierto antes de
    // asignar transportista. Si el alcance mirara solo esa columna, el hilo
    // desaparecería para el despachador que lo abrió — justo cuando la carga
    // todavía no tiene a nadie y hay más que hablar, no menos.
    $actor = actorDeRol($this->scenario, Role::Dispatcher);

    $hilo = hiloSuelto($this->scenario, loadId: (string) $this->scenario->load->id, carrierId: null);

    Threads::addParticipant($actor, $hilo, $actor);

    expect(MessageScope::apply(Conversation::query(), app(App\Authorization\PermissionChecker::class), $actor, Scope::Assigned)
        ->where('conversations.id', $hilo)->exists())->toBeTrue();
});
