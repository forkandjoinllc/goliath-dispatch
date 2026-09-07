<?php

declare(strict_types=1);

use App\Authorization\Permissions;
use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    Storage::fake('local');
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Cuelga un papel del expediente de la carga y devuelve el id de su vínculo.
 *
 * Lo sube el ADMIN, que es quien puede en los dos mundos —antes y después de
 * este lote—, para que lo que se mida sea quién puede QUITARLO.
 */
function papelEnElExpediente(Scenario $scenario): string
{
    $loadId = (string) $scenario->load->id;

    signIn($scenario, Role::Admin);

    test()->post("/loads/{$loadId}/documents", [
        'file' => UploadedFile::fake()->create('bol.pdf', 40, 'application/pdf'),
        'document_type' => 'bol',
    ])->assertRedirect();

    return (string) DB::table('load_documents')
        ->where('load_id', $loadId)
        ->whereNull('deleted_at')
        ->orderByDesc('created_at')
        ->value('id');
}

/* ── La frontera que la matriz dibuja ────────────────────────────────────── */

it('el transportista NO puede quitar un documento del expediente', function () {
    // La matriz le da `document:delete` solo al admin. La acción autorizaba
    // contra `load:document:upload`, que el transportista tiene con
    // Scope::Carrier — y esta carga es de SU transportista. O sea que antes de
    // este lote podía quitar del expediente un papel que había subido la casa.
    //
    // Se prueba con el transportista y con el despachador, y NO con el
    // conductor: el conductor tiene `load:read` con Scope::Own y esta carga no
    // es suya, así que recibiría un 404 por ámbito y la prueba estaría midiendo
    // otra cosa. Un 404 por ámbito también es una negativa correcta, pero no es
    // la que este lote arregla.
    $loadId = (string) $this->scenario->load->id;
    $link = papelEnElExpediente($this->scenario);

    signIn($this->scenario, Role::Carrier);

    // `assertRedirect` y no `assertForbidden`: una acción denegada (POST,
    // PATCH, DELETE) vuelve atrás con el motivo en el flash, a propósito —
    // bootstrap/app.php lo explica. El 403 con pantalla propia es para las
    // PÁGINAS. Lo que importa de todas formas es lo de abajo: el papel sigue.
    $this->delete("/loads/{$loadId}/documents/{$link}")
        ->assertRedirect()
        ->assertSessionHas('error');

    expect(DB::table('load_documents')->where('id', $link)->whereNull('deleted_at')->count())->toBe(1);
});

it('el despachador tampoco, aunque sí pueda subir', function () {
    // Subir y quitar son cosas distintas, y la matriz las separa. Que el
    // despachador siga pudiendo subir es parte de lo que se comprueba.
    $loadId = (string) $this->scenario->load->id;
    $link = papelEnElExpediente($this->scenario);

    signIn($this->scenario, Role::Dispatcher);

    $this->delete("/loads/{$loadId}/documents/{$link}")
        ->assertRedirect()
        ->assertSessionHas('error');

    expect(DB::table('load_documents')->where('id', $link)->whereNull('deleted_at')->count())->toBe(1);

    $this->post("/loads/{$loadId}/documents", [
        'file' => UploadedFile::fake()->create('pod.pdf', 30, 'application/pdf'),
        'document_type' => 'pod',
    ])->assertRedirect();
});

it('el admin sí puede, que es lo que dice la matriz', function () {
    $loadId = (string) $this->scenario->load->id;
    $link = papelEnElExpediente($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->delete("/loads/{$loadId}/documents/{$link}", ['reason' => 'Se subió a la carga equivocada.'])
        ->assertRedirect();

    // Borrado BLANDO: la fila sigue, con su fecha. Un expediente del que
    // desaparecen papeles sin rastro no sirve para lo que existe.
    expect(DB::table('load_documents')->where('id', $link)->whereNull('deleted_at')->count())->toBe(0)
        ->and(DB::table('load_documents')->where('id', $link)->count())->toBe(1);
});

/* ── Y la pantalla no ofrece lo que va a rechazar ────────────────────────── */

it('al transportista no se le pinta el botón de quitar', function () {
    $loadId = (string) $this->scenario->load->id;
    papelEnElExpediente($this->scenario);

    signIn($this->scenario, Role::Carrier);

    $this->get("/loads/{$loadId}/documents")->assertOk()->assertInertia(
        fn ($p) => expect($p->toArray()['props']['can']['detach'])->toBeFalse()
    );
});

it('al admin sí', function () {
    $loadId = (string) $this->scenario->load->id;
    papelEnElExpediente($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->get("/loads/{$loadId}/documents")->assertOk()->assertInertia(
        fn ($p) => expect($p->toArray()['props']['can']['detach'])->toBeTrue()
    );
});

/* ── Las preferencias de aviso también piden su permiso ──────────────────── */

it('guardar preferencias de aviso comprueba el permiso', function () {
    // Lo tienen los cinco roles, así que esto no le quita la casilla a nadie.
    // Lo que cambia es que ahora una denegación explícita sirve para algo.
    signIn($this->scenario, Role::Dispatcher);

    $this->post('/notification-preferences', [
        'preferences' => [
            ['event_key' => 'invoice.overdue', 'in_app' => true, 'email' => false],
        ],
    ])->assertRedirect();

    expect(DB::table('notification_preferences')->where('event_key', 'invoice.overdue')->count())->toBe(1);
});

it('una denegación explícita de las preferencias ahora sirve para algo', function () {
    // Antes, denegar `notification:preference:update` era escribir una fila que
    // no leía nadie: la acción no comprobaba nada.
    signIn($this->scenario, Role::Dispatcher);

    $usuario = $this->scenario->user(Role::Dispatcher);

    // La tabla es `user_permission_overrides` y no guarda la CLAVE del permiso
    // sino su id en `permissions` — la tabla que siembra el catálogo.
    // El catálogo NO está sembrado en la base de pruebas —lo copia el seeder, y
    // estas pruebas no lo corren— así que la fila se pone aquí. Es la mínima
    // que hace falta para que ActorFactory pueda unir la excepción con su
    // clave.
    $permisoId = DB::table('permissions')->where('key', 'notification:preference:update')->value('id');

    if ($permisoId === null) {
        $permisoId = (string) Str::uuid();
        DB::table('permissions')->insert([
            'id' => $permisoId,
            'key' => 'notification:preference:update',
            'resource' => 'notification',
            'action' => 'preference:update',
            'description_en' => Permissions::describe('notification:preference:update'),
            'description_es' => 'Cambiar sus preferencias de aviso',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    DB::table('user_permission_overrides')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'user_id' => $usuario->id,
        'permission_id' => $permisoId,
        'effect' => 'deny',
        'scope' => 'tenant',
        'reason' => 'Prueba: una denegación explícita tiene que servir para algo.',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $this->post('/notification-preferences', [
        'preferences' => [
            ['event_key' => 'invoice.overdue', 'in_app' => false, 'email' => false],
        ],
    ])->assertRedirect()->assertSessionHas('error');

    // Y no se guardó nada: la denegación no es cosmética.
    expect(DB::table('notification_preferences')->where('user_id', $usuario->id)->count())->toBe(0);
});
