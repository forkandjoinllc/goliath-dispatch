<?php

declare(strict_types=1);

use App\Enums\LoadStatus;
use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    Storage::fake('local');
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Abre el hilo de la carga del escenario por el camino que usa la aplicación. */
function abrirHiloDeLaCarga(Scenario $scenario): string
{
    $id = app(TenantContext::class)->withoutTenant(fn () => DB::table('conversations')
        ->where('load_id', $scenario->load->id)
        ->where('kind', 'load')
        ->value('id'));

    return (string) $id;
}

/* ── El hilo de una carga ────────────────────────────────────────────────── */

it('abrir el hilo de una carga lo crea y mete dentro al transportista', function () {
    // Es el arreglo de fondo. Hoy «¿le avisaste al transportista de que la cita
    // cambió?» se contesta por teléfono. Un hilo con un solo lado no sirve de
    // nada, así que crear el hilo y meter al otro lado es la misma operación.
    signIn($this->scenario, Role::Dispatcher);

    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();

    $hilo = abrirHiloDeLaCarga($this->scenario);

    expect($hilo)->not->toBe('');

    $participantes = app(TenantContext::class)->withoutTenant(fn () => DB::table('conversation_participants')
        ->where('conversation_id', $hilo)
        ->pluck('role')
        ->all());

    expect($participantes)->toContain('dispatcher')->toContain('carrier');
});

it('abrirlo dos veces devuelve el mismo hilo', function () {
    // Dos hilos de la misma carga es peor que ninguno: la mitad de la
    // conversación queda en el otro y nadie sabe cuál mirar.
    signIn($this->scenario, Role::Dispatcher);

    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();
    $primero = abrirHiloDeLaCarga($this->scenario);

    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();

    $cuantos = app(TenantContext::class)->withoutTenant(fn () => DB::table('conversations')
        ->where('load_id', $this->scenario->load->id)->count());

    expect($cuantos)->toBe(1);
    expect(abrirHiloDeLaCarga($this->scenario))->toBe($primero);
});

it('no se abre el hilo de una carga que no llevas', function () {
    // Se comprueba el alcance de la CARGA, no el de los mensajes. Sin eso un
    // despachador podría abrir el hilo de una carga ajena y meterse dentro — y a
    // partir de ahí la regla de pertenencia le daría acceso legítimamente.
    signIn($this->scenario, Role::Dispatcher);

    $this->post("/loads/{$this->scenario->otherLoad->id}/messages")->assertNotFound();

    expect(app(TenantContext::class)->withoutTenant(fn () => DB::table('conversations')
        ->where('load_id', $this->scenario->otherLoad->id)->count()))->toBe(0);
});

it('avisa cuando no hay nadie del transportista en el hilo', function () {
    // Lo encontró el navegador. El transportista está dado de alta pero su gente
    // no tiene cuenta todavía —el estado normal las primeras semanas—, así que
    // `addCarrierUsers()` no encuentra a nadie y el hilo queda con un solo lado.
    // Nada fallaba: la única señal era que la lista de participantes era corta,
    // y eso es pedirle a alguien que note una ausencia.
    app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => DB::table('user_tenant_memberships')
        ->where('carrier_id', $this->scenario->assignedCarrier->id)
        ->update(['deleted_at' => now(), 'updated_at' => now()]));

    signIn($this->scenario, Role::Dispatcher);
    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();
    $hilo = abrirHiloDeLaCarga($this->scenario);

    $this->get("/messages/{$hilo}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('carrierMissing', $this->scenario->assignedCarrier->legal_name));
});

it('con el transportista dentro no avisa nada', function () {
    signIn($this->scenario, Role::Dispatcher);
    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();
    $hilo = abrirHiloDeLaCarga($this->scenario);

    $this->get("/messages/{$hilo}")
        ->assertInertia(fn (Assert $page) => $page->where('carrierMissing', null));
});

/* ── Escribir y leer ─────────────────────────────────────────────────────── */

it('la bandeja enseña solo los hilos en los que estás', function () {
    signIn($this->scenario, Role::Dispatcher);
    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();

    // Un hilo ajeno, en la misma empresa.
    app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => DB::table('conversations')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'subject' => 'Cosas de contabilidad',
        'kind' => 'direct',
        'created_at' => now(),
        'updated_at' => now(),
    ]));

    $this->get('/messages')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Messages/Index')
            ->has('threads.data', 1)
            ->where('threads.data.0.loadNumber', $this->scenario->load->load_number)
        );
});

it('lo que se escribe aparece en el hilo', function () {
    signIn($this->scenario, Role::Dispatcher);
    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();
    $hilo = abrirHiloDeLaCarga($this->scenario);

    $this->post("/messages/{$hilo}", ['body' => 'La cita se mueve a las 14:00.'])->assertRedirect();

    $this->get("/messages/{$hilo}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Messages/Show')
            ->has('messages', 1)
            ->where('messages.0.body', 'La cita se mueve a las 14:00.')
            ->where('messages.0.origin', 'user')
        );
});

it('escribir mueve el hilo al principio de la bandeja', function () {
    // `conversations.last_message_at` está desnormalizado y el esquema lo dice
    // con un índice. Se escribe en la misma transacción que el mensaje: fuera
    // de ella, un fallo entre las dos dejaría el hilo enterrado justo cuando
    // acaba de moverse.
    signIn($this->scenario, Role::Dispatcher);
    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();
    $hilo = abrirHiloDeLaCarga($this->scenario);

    expect(app(TenantContext::class)->withoutTenant(fn () => DB::table('conversations')
        ->where('id', $hilo)->value('last_message_at')))->toBeNull();

    $this->post("/messages/{$hilo}", ['body' => 'Algo.'])->assertRedirect();

    expect(app(TenantContext::class)->withoutTenant(fn () => DB::table('conversations')
        ->where('id', $hilo)->value('last_message_at')))->not->toBeNull();
});

it('abrir el hilo lo marca leído, y lo propio nunca cuenta como no leído', function () {
    signIn($this->scenario, Role::Dispatcher);
    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();
    $hilo = abrirHiloDeLaCarga($this->scenario);

    $this->post("/messages/{$hilo}", ['body' => 'Lo mío.'])->assertRedirect();

    $this->get('/messages')->assertInertia(fn (Assert $page) => $page
        ->where('threads.data.0.unread', 0));
});

it('lo que escribe otro sí cuenta como no leído', function () {
    signIn($this->scenario, Role::Dispatcher);
    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();
    $hilo = abrirHiloDeLaCarga($this->scenario);

    // El transportista contesta.
    signIn($this->scenario, Role::Carrier);
    $this->post("/messages/{$hilo}", ['body' => 'Recibido.'])->assertRedirect();

    // Y el despachador lo ve pendiente sin abrirlo.
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/messages')->assertInertia(fn (Assert $page) => $page
        ->where('threads.data.0.unread', 1));

    // Al abrirlo deja de estarlo.
    $this->get("/messages/{$hilo}")->assertOk();

    $this->get('/messages')->assertInertia(fn (Assert $page) => $page
        ->where('threads.data.0.unread', 0));
});

it('un hilo ajeno contesta 404, no 403', function () {
    // Aquí importa más que en ningún otro sitio: un 403 sobre un hilo privado
    // confirmaría que esa conversación existe, que es la mitad de lo que quien
    // fisgonea quiere saber.
    signIn($this->scenario, Role::Dispatcher);
    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();
    $hilo = abrirHiloDeLaCarga($this->scenario);

    signIn($this->scenario, Role::Accounting);

    $this->get("/messages/{$hilo}")->assertNotFound();
    $this->post("/messages/{$hilo}", ['body' => 'Hola'])->assertNotFound();
});

it('un adjunto se guarda con su huella', function () {
    signIn($this->scenario, Role::Dispatcher);
    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();
    $hilo = abrirHiloDeLaCarga($this->scenario);

    $ruta = tempnam(sys_get_temp_dir(), 'gd').'.pdf';
    file_put_contents($ruta, "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");

    $this->post("/messages/{$hilo}", [
        'body' => 'Te mando el papel.',
        'file' => new Illuminate\Http\UploadedFile($ruta, 'papel.pdf', 'application/pdf', null, true),
    ])->assertRedirect();

    $adjunto = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('message_attachments')->first()
    );

    expect($adjunto)->not->toBeNull();
    expect((string) $adjunto->filename)->toBe('papel.pdf');
    // El hash del contenido, igual que en `document_versions`: es lo que
    // responde «¿este PDF es el que me mandaste?» sin depender del nombre.
    expect((string) $adjunto->sha256)->toHaveLength(64);
});

/* ── Los mensajes de sistema ─────────────────────────────────────────────── */

it('un cambio de estado se cuenta en el hilo, con clave y no con frase', function () {
    // El motivo entero de que el esquema guarde `system_key` y `system_params`:
    // en el hilo hay despacho en español y un transportista que puede trabajar
    // en inglés. Una frase ya redactada dejaría a uno de los dos leyendo el
    // idioma del otro.
    signIn($this->scenario, Role::Dispatcher);
    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();
    $hilo = abrirHiloDeLaCarga($this->scenario);

    // `in_transit` → `at_delivery`: un paso del grafo que no tiene puerta de
    // cumplimiento detrás. `pod_received` la tiene —exige el comprobante— y la
    // prueba estaría midiendo la puerta en vez del mensaje de sistema.
    app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => DB::table('loads')
        ->where('id', $this->scenario->load->id)
        ->update(['status' => LoadStatus::InTransit->value, 'updated_at' => now()]));

    $this->post("/loads/{$this->scenario->load->id}/status/at_delivery")
        ->assertRedirect();

    $sistema = app(TenantContext::class)->withoutTenant(fn () => DB::table('messages')
        ->where('conversation_id', $hilo)
        ->where('origin', 'system')
        ->first());

    expect($sistema)->not->toBeNull();
    expect((string) $sistema->system_key)->toBe('loadStatusChanged');
    expect($sistema->sender_user_id)->toBeNull();

    $params = json_decode((string) $sistema->system_params, true);

    // Las CLAVES de los estados, no sus etiquetas: se traducen al pintarlas.
    expect($params['from'])->toBe('in_transit');
    expect($params['to'])->toBe('at_delivery');
});

it('sin hilo abierto, un cambio de estado no crea ninguno', function () {
    // Si narrar creara el hilo, cada cambio de estado de cada carga abriría una
    // conversación: una empresa con seiscientas cargas al mes tendría una
    // bandeja de seiscientos hilos que nadie ha abierto nunca, con los cinco
    // que importan enterrados debajo.
    signIn($this->scenario, Role::Dispatcher);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => DB::table('loads')
        ->where('id', $this->scenario->load->id)
        ->update(['status' => LoadStatus::InTransit->value, 'updated_at' => now()]));

    $this->post("/loads/{$this->scenario->load->id}/status/at_delivery")
        ->assertRedirect();

    expect(app(TenantContext::class)->withoutTenant(fn () => DB::table('conversations')->count()))->toBe(0);
});
