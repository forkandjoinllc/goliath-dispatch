<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Storage\DocumentStore;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\Support\Scenario;

/**
 * Un adjunto de mensaje se puede bajar.
 *
 * Hasta este lote no se podía: `Posting::attach()` guardaba el fichero y su
 * fila, la pantalla pintaba «papel.pdf · 240 KB» como texto, y no existía
 * ninguna ruta a la que enlazar. Ni quien lo recibía ni quien lo había subido
 * podían abrirlo jamás.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Abre el hilo de la carga y cuelga un papel de él. Devuelve [hilo, adjunto]. */
function hiloConPapel(Scenario $s, Role $quien = Role::Dispatcher): array
{
    test()->post("/loads/{$s->load->id}/messages")->assertRedirect();

    $hilo = (string) app(TenantContext::class)->withoutTenant(fn () => DB::table('conversations')
        ->where('load_id', $s->load->id)->value('id'));

    $ruta = tempnam(sys_get_temp_dir(), 'gd').'.pdf';
    file_put_contents($ruta, "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");

    test()->post("/messages/{$hilo}", [
        'body' => 'Te mando el comprobante.',
        'file' => new UploadedFile($ruta, 'comprobante.pdf', 'application/pdf', null, true),
    ])->assertRedirect();

    $adjunto = (string) app(TenantContext::class)->withoutTenant(fn () => DB::table('message_attachments as a')
        ->join('messages as m', 'm.id', '=', 'a.message_id')
        ->where('m.conversation_id', $hilo)
        ->value('a.id'));

    return [$hilo, $adjunto];
}

/* ── Que se pueda bajar, que es lo que no se podía ───────────────────────── */

it('la pantalla del hilo manda una ruta para cada adjunto', function (): void {
    // ESTE ES EL FALLO. Antes llegaban nombre, tipo y peso, y nada más: la
    // pantalla no tenía a dónde enlazar porque no había ruta.
    signIn($this->scenario, Role::Dispatcher);
    [$hilo, $adjunto] = hiloConPapel($this->scenario);

    $this->get("/messages/{$hilo}")->assertInertia(fn ($page) => $page
        ->where('messages', function ($mensajes) use ($hilo, $adjunto): bool {
            $adjuntos = collect($mensajes)->pluck('attachments')->flatten(1);

            return $adjuntos->count() === 1
                && $adjuntos->first()['href'] === "/messages/{$hilo}/attachments/{$adjunto}";
        }));
});

it('quien está en el hilo se lo baja', function (): void {
    signIn($this->scenario, Role::Dispatcher);
    [$hilo, $adjunto] = hiloConPapel($this->scenario);

    // Redirige a la ruta firmada del almacén, y esa sirve el fichero.
    $r = $this->get("/messages/{$hilo}/attachments/{$adjunto}");
    $r->assertRedirect();

    $this->get($r->headers->get('Location'))->assertOk();
});

it('la clave del almacén NO viaja a la pantalla', function (): void {
    // Lo que se manda es el id del adjunto; la clave la resuelve el servidor.
    // Mandarla sería darle la dirección del fichero a quien quizá no puede
    // abrirlo.
    signIn($this->scenario, Role::Dispatcher);
    [$hilo] = hiloConPapel($this->scenario);

    $this->get("/messages/{$hilo}")->assertInertia(fn ($page) => $page
        ->where('messages', function ($mensajes): bool {
            foreach (collect($mensajes)->pluck('attachments')->flatten(1) as $a) {
                if (array_key_exists('storageKey', $a) || array_key_exists('storage_key', $a)) {
                    return false;
                }
            }

            return true;
        }));
});

/* ── Y que no se lo baje quien no debe ───────────────────────────────────── */

it('quien no está en el hilo no lo baja', function (): void {
    signIn($this->scenario, Role::Dispatcher);
    [$hilo, $adjunto] = hiloConPapel($this->scenario);

    // 404 y no 403: un 403 confirmaría que ese hilo y ese adjunto existen.
    signIn($this->scenario, Role::Accounting);

    $this->get("/messages/{$hilo}/attachments/{$adjunto}")->assertNotFound();
});

it('el adjunto se cruza con SU hilo, no se coge por su id suelto', function (): void {
    // Sin el cruce, el id de un adjunto de otra conversación emparejado con un
    // hilo que sí se puede leer bajaría el fichero: la comprobación estaría
    // hecha sobre una cosa y el fichero sería de otra.
    //
    // Por eso la prueba la hace un ADMINISTRADOR y con DOS hilos que puede
    // leer los dos. Con un hilo ajeno no mediría nada: `find()` daría 404 antes
    // de llegar al cruce, y el sabotaje que lo quita se quedaría en verde.
    signIn($this->scenario, Role::Admin);

    [, $adjunto] = hiloConPapel($this->scenario);

    $this->post("/loads/{$this->scenario->otherLoad->id}/messages")->assertRedirect();

    $segundo = (string) app(TenantContext::class)->withoutTenant(fn () => DB::table('conversations')
        ->where('load_id', $this->scenario->otherLoad->id)->value('id'));

    // Lo puede leer: es suyo y está dentro.
    $this->get("/messages/{$segundo}")->assertOk();

    // Y aun así el adjunto del OTRO hilo no baja por aquí.
    $this->get("/messages/{$segundo}/attachments/{$adjunto}")->assertNotFound();
});

/* ── Cuando el fichero no está ───────────────────────────────────────────── */

it('si el fichero no está en el almacén, lo dice', function (): void {
    // La pantalla de retención lleva contando «filas que nombran un fichero que
    // no está» y diciendo de ellas que «cada una es un botón de descarga que va
    // a fallar». Desde hoy esos botones existen, así que el fallo se dice en
    // vez de reventar.
    signIn($this->scenario, Role::Dispatcher);
    [$hilo, $adjunto] = hiloConPapel($this->scenario);

    $clave = (string) app(TenantContext::class)->withoutTenant(fn () => DB::table('message_attachments')
        ->where('id', $adjunto)->value('storage_key'));

    app(DocumentStore::class)->delete($clave);

    $this->get("/messages/{$hilo}/attachments/{$adjunto}")
        ->assertSessionHas('error', __('messages.errors.attachmentMissing'));
});

/* ── Y que vuelva con su nombre ──────────────────────────────────────────── */

it('el fichero se entrega con el nombre con el que se subió', function (): void {
    // La clave de almacenamiento es un UUID. Sin esto, quien se baja un
    // comprobante se encuentra «b29a564e-73e0-….pdf» en su carpeta de
    // descargas, y quien se baja tres no los distingue. El nombre llevaba
    // guardado desde siempre, con un comentario que decía «el nombre original
    // es un DATO, no un nombre de fichero». Lo era, y al devolverlo tampoco se
    // usaba como dato.
    signIn($this->scenario, Role::Dispatcher);
    [$hilo, $adjunto] = hiloConPapel($this->scenario);

    $r = $this->get("/messages/{$hilo}/attachments/{$adjunto}");

    $fichero = $this->get($r->headers->get('Location'));

    expect($fichero->headers->get('content-disposition'))
        ->toContain('comprobante.pdf');
});

it('el nombre viaja dentro de la firma', function (): void {
    // Si el nombre fuese un parámetro suelto, cualquiera podría servir un
    // fichero ajeno con el nombre que quisiera — una factura llamada
    // «contrato.pdf», por ejemplo.
    signIn($this->scenario, Role::Dispatcher);
    [$hilo, $adjunto] = hiloConPapel($this->scenario);

    $firmada = $this->get("/messages/{$hilo}/attachments/{$adjunto}")->headers->get('Location');

    $manipulada = preg_replace('/name=[^&]+/', 'name='.base64_encode('otra-cosa.pdf'), (string) $firmada);

    expect($manipulada)->not->toBe($firmada);

    $this->get((string) $manipulada)->assertForbidden();
});

/* ── Y que quede anotado ─────────────────────────────────────────────────── */

it('bajarse un adjunto queda en la bitácora', function (): void {
    signIn($this->scenario, Role::Dispatcher);
    [$hilo, $adjunto] = hiloConPapel($this->scenario);

    $this->get("/messages/{$hilo}/attachments/{$adjunto}");

    $evento = app(TenantContext::class)->withoutTenant(fn () => DB::table('audit_events')
        ->where('entity_type', 'message_attachment')
        ->where('entity_id', $adjunto)
        ->first(['action', 'entity_label']));

    expect($evento)->not->toBeNull();
    expect((string) $evento->action)->toBe('document.downloaded');
    expect((string) $evento->entity_label)->toBe('comprobante.pdf');
});
