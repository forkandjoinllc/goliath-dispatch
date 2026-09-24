<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Http\Controllers\App\NotificationController;
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
 * El panel que se abre al pulsar la campana.
 *
 * Lo que aquí se mide es lo que el panel AFIRMA: que enseña lo de esta persona
 * y de nadie más, que lo sin leer va primero —quien abre la campana viene a ver
 * lo que no ha visto—, que pulsar un adelanto lo marca leído y lleva a donde
 * lleva el aviso, y que no lleva fuera del sitio.
 */
function avisoPara(Scenario $s, Role $rol, string $titulo, ?string $destino, bool $leido = false, int $haceMinutos = 0): string
{
    $id = (string) Str::uuid();

    DB::table('notifications')->insert([
        'id' => $id,
        'tenant_id' => (string) $s->tenant->id,
        'user_id' => (string) $s->user($rol)->id,
        'channel' => 'in_app',
        'event_key' => 'document.expiring',
        'dedupe_key' => 'prueba-'.$id,
        'title' => $titulo,
        'body' => 'El cuerpo de '.$titulo.'.',
        'action_url' => $destino,
        'read_at' => $leido ? now() : null,
        'created_at' => now()->subMinutes($haceMinutos),
        'updated_at' => now(),
    ]);

    return $id;
}

function campana(): array
{
    /** @var Assert $pagina */
    $pagina = null;

    test()->get('/home')->assertOk()->assertInertia(function (Assert $p) use (&$pagina): void {
        $pagina = $p;
    });

    return $pagina->toArray()['props']['shell']['notifications'];
}

/* ── Lo que enseña ──────────────────────────────────────────────────────── */

it('la campana trae los avisos de esta persona y de nadie más', function () {
    signIn($this->scenario, Role::Admin);

    $mio = avisoPara($this->scenario, Role::Admin, 'El mío', '/leads');
    $ajeno = avisoPara($this->scenario, Role::Accounting, 'El de otro', '/leads');

    $ids = collect(campana())->pluck('id');

    expect($ids)->toContain($mio);
    expect($ids)->not->toContain($ajeno);
});

it('lo sin leer va primero aunque sea más viejo', function () {
    signIn($this->scenario, Role::Admin);

    $viejoSinLeer = avisoPara($this->scenario, Role::Admin, 'Viejo sin leer', '/leads', leido: false, haceMinutos: 600);
    avisoPara($this->scenario, Role::Admin, 'Nuevo leído', '/leads', leido: true, haceMinutos: 1);

    // Quien abre la campana viene a ver lo que no ha visto. Ordenar solo por
    // fecha empuja lo nuevo fuera del panel en cuanto llegan seis ya leídos.
    expect(campana()[0]['id'])->toBe($viejoSinLeer);
});

it('el panel no manda la dirección del aviso a la pantalla', function () {
    signIn($this->scenario, Role::Admin);

    avisoPara($this->scenario, Role::Admin, 'Con destino', '/leads');

    $aviso = campana()[0];

    // La pantalla publica en `/notifications/{id}/open` y el servidor decide a
    // dónde. Una dirección que viaja es una dirección que se puede tocar.
    expect($aviso)->not->toHaveKey('actionUrl');
    expect($aviso['hasTarget'])->toBeTrue();
});

it('no trae más de los que caben en el panel', function () {
    signIn($this->scenario, Role::Admin);

    foreach (range(1, NotificationController::EN_LA_CAMPANA + 4) as $n) {
        avisoPara($this->scenario, Role::Admin, 'Aviso '.$n, '/leads');
    }

    expect(count(campana()))->toBe(NotificationController::EN_LA_CAMPANA);
});

/* ── Lo que pasa al pulsar un adelanto ──────────────────────────────────── */

it('abrir un adelanto lo marca leído y lleva a donde lleva el aviso', function () {
    signIn($this->scenario, Role::Admin);

    $id = avisoPara($this->scenario, Role::Admin, 'Un cliente potencial', '/leads');

    $this->post('/notifications/'.$id.'/open')->assertRedirect('/leads');

    expect(DB::table('notifications')->where('id', $id)->value('read_at'))->not->toBeNull();
});

it('un aviso sin destino lleva a la lista de avisos', function () {
    signIn($this->scenario, Role::Admin);

    $id = avisoPara($this->scenario, Role::Admin, 'Sin destino', null);

    $this->post('/notifications/'.$id.'/open')->assertRedirect('/notifications');

    // Y se marca leído igual: se ha abierto.
    expect(DB::table('notifications')->where('id', $id)->value('read_at'))->not->toBeNull();
});

it('no se abre el aviso de otra persona ni se le apaga la campana', function () {
    signIn($this->scenario, Role::Admin);

    $ajeno = avisoPara($this->scenario, Role::Accounting, 'El de otro', '/leads');

    $this->post('/notifications/'.$ajeno.'/open')->assertRedirect('/notifications');

    // Lo que se mide no es el 404 —no lo hay, a propósito, porque un 404
    // distinto de un 302 ya diría que existe—: es que su aviso sigue sin leer.
    expect(DB::table('notifications')->where('id', $ajeno)->value('read_at'))->toBeNull();
});

/* ── El destino no saca a nadie del sitio ───────────────────────────────── */

it('un destino que apunta fuera no se sigue', function () {
    signIn($this->scenario, Role::Admin);

    // `action_url` la escribe la aplicación y hoy siempre es una ruta de
    // dentro. Es una columna de texto: el día que algo escriba ahí una
    // dirección de fuera, el servidor mandaría a la gente con la sesión
    // abierta. Las dos barras son lo peligroso, porque tienen forma de ruta.
    foreach (['//otro-sitio.example/x', 'https://otro-sitio.example', 'javascript:alert(1)'] as $malo) {
        $id = avisoPara($this->scenario, Role::Admin, 'Malo', $malo);

        $this->post('/notifications/'.$id.'/open')->assertRedirect('/notifications');
    }
});

it('una ruta de dentro con parámetros sí se sigue', function () {
    signIn($this->scenario, Role::Admin);

    // La otra mitad: sin ella, «no sigue el destino» lo cumple igual de bien
    // un servidor que no sigue ninguno.
    $id = avisoPara($this->scenario, Role::Admin, 'Documentos', '/documents?expiring=1');

    $this->post('/notifications/'.$id.'/open')->assertRedirect('/documents?expiring=1');
});
