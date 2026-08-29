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
 * Mete un prospecto directamente en la tabla.
 *
 * A mano y no pasando por el formulario público porque estas pruebas son de la
 * PANTALLA: necesitan poner un prospecto de otra empresa, uno de la plataforma
 * (sin empresa) o uno de hace un año, y ninguna de las tres cosas se puede
 * montar enviando el formulario.
 */
function prospecto(?string $tenantId, array $overrides = []): string
{
    $id = (string) Str::uuid();

    DB::table('leads')->insert([
        'id' => $id,
        'tenant_id' => $tenantId,
        'first_name' => 'Ana',
        'last_name' => 'Ruiz',
        'email' => 'ana-'.Str::random(6).'@ejemplo.test',
        'phone' => '+1 555 0111',
        'company_name' => 'Transportes Ruiz LLC',
        'message' => 'Necesito despacho.',
        'locale' => 'es',
        'source' => 'contact_form',
        'status' => 'new',
        'created_at' => now(),
        'updated_at' => now(),
        ...$overrides,
    ]);

    return $id;
}

/**
 * Un envío válido del formulario público de contacto.
 *
 * Se repite aquí en vez de reutilizar el de `PublicFormsTest`: Pest carga los
 * ficheros de prueba en un espacio global común, así que tomarlo prestado ata
 * este fichero a que aquel esté cargado, y ejecutar este solo —que es lo que se
 * hace al depurar— fallaría con «función no definida».
 */
function envioDeContacto(array $overrides = []): array
{
    $payload = json_encode(['f' => 'lead', 't' => (int) ((microtime(true) - 10) * 1000)]);
    $body = rtrim(strtr(base64_encode((string) $payload), '+/', '-_'), '=');

    $key = (string) config('app.key');

    if (str_starts_with($key, 'base64:')) {
        $key = (string) base64_decode(substr($key, 7), true);
    }

    return [
        'first_name' => 'Ana',
        'last_name' => 'Ruiz',
        'email' => 'web-'.Str::random(6).'@ejemplo.test',
        'phone' => '+1 555 0100',
        'company_name' => 'Desde La Web LLC',
        'message' => 'Necesito despacho para cargas sobredimensionadas.',
        'lead_consent' => true,
        'hp_field' => '',
        // El sello va envejecido diez segundos: el formulario rechaza los
        // envíos instantáneos, y dormir tres segundos por prueba no es opción.
        'form_token' => $body.'.'.hash_hmac('sha256', $body, $key),
        ...$overrides,
    ];
}

/** Concede un permiso suelto a un rol del escenario, como excepción por usuario. */
function concedePermiso(Scenario $scenario, Role $role, string $permiso): void
{
    // `permissions` es una tabla ESPEJO —la autorización de verdad vive en
    // RoleMatrix, en PHP— y la suite no corre el seeder que la rellena. Se
    // inserta la fila que hace falta: `user_permission_overrides` apunta a ella
    // por clave foránea y sin fila no hay excepción que conceder.
    $permissionId = DB::table('permissions')->where('key', $permiso)->value('id');

    if ($permissionId === null) {
        $permissionId = (string) Str::uuid();
        [$resource, $action] = array_pad(explode(':', $permiso, 2), 2, '');

        DB::table('permissions')->insert([
            'id' => $permissionId,
            'key' => $permiso,
            'resource' => $resource,
            'action' => $action,
            'description_en' => $permiso,
            'description_es' => $permiso,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    DB::table('user_permission_overrides')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $scenario->tenant->id,
        'user_id' => $scenario->user($role)->id,
        'permission_id' => $permissionId,
        'effect' => 'grant',
        'scope' => 'tenant',
        'reason' => 'Prueba del corte entre leer y mover prospectos.',
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

/* ── Quién puede mirar ──────────────────────────────────────────────────── */

it('deja mirar el embudo al administrador', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/leads')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('App/Leads/Index'));
});

it('no deja mirar el embudo al despachador', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/leads')
        ->assertForbidden()
        ->assertInertia(fn (Assert $page) => $page->component('App/Denied'));
});

it('no deja mirar el embudo al transportista', function () {
    signIn($this->scenario, Role::Carrier);

    $this->get('/leads')->assertForbidden();
});

/* ── La frontera de empresa ─────────────────────────────────────────────── */

it('no enseña los prospectos de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    $mio = prospecto($this->scenario->tenant->id, ['company_name' => 'MIA SA']);
    prospecto($otra->tenant->id, ['company_name' => 'AJENA SA']);

    signIn($this->scenario, Role::Admin);

    $this->get('/leads')->assertInertia(function (Assert $page) use ($mio) {
        $filas = collect($page->toArray()['props']['leads']['data']);

        expect($filas->pluck('id')->all())->toContain($mio);
        expect($filas->pluck('companyName')->all())->not->toContain('AJENA SA');
    });
});

it('no enseña los prospectos de la plataforma, que no son de ninguna empresa', function () {
    // `tenant_id` nulo = envío desde goliathdispatch.com. Que no aparezca aquí
    // es la otra mitad de la regla de que el dominio decide de quién es el
    // prospecto: si se colara, cualquier empresa vería los de la plataforma.
    prospecto(null, ['company_name' => 'DE LA PLATAFORMA SA']);

    signIn($this->scenario, Role::Admin);

    $this->get('/leads')->assertInertia(function (Assert $page) {
        $empresas = collect($page->toArray()['props']['leads']['data'])->pluck('companyName')->all();

        expect($empresas)->not->toContain('DE LA PLATAFORMA SA');
    });
});

it('devuelve 404 al abrir un prospecto de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    $ajeno = prospecto($otra->tenant->id);

    signIn($this->scenario, Role::Admin);

    $this->get("/leads/{$ajeno}")->assertNotFound();
});

it('no deja mover un prospecto de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    $ajeno = prospecto($otra->tenant->id);

    signIn($this->scenario, Role::Admin);

    $this->post("/leads/{$ajeno}/status", ['status' => 'lost', 'reason' => 'nada'])
        ->assertNotFound();

    expect(DB::table('leads')->where('id', $ajeno)->value('status'))->toBe('new');
});

/* ── Filtros ────────────────────────────────────────────────────────────── */

it('filtra por estado, origen y sin asignar', function () {
    prospecto($this->scenario->tenant->id, ['status' => 'lost', 'company_name' => 'PERDIDA SA']);
    prospecto($this->scenario->tenant->id, ['source' => 'quote_form', 'company_name' => 'PRESUPUESTO SA']);
    prospecto($this->scenario->tenant->id, [
        'assigned_to_user_id' => $this->scenario->user(Role::Admin)->id,
        'company_name' => 'ASIGNADA SA',
    ]);

    signIn($this->scenario, Role::Admin);

    $empresas = function (string $url): array {
        $salida = [];

        test()->get($url)->assertInertia(function (Assert $page) use (&$salida) {
            $salida = collect($page->toArray()['props']['leads']['data'])->pluck('companyName')->all();
        });

        return $salida;
    };

    expect($empresas('/leads?status=lost'))->toContain('PERDIDA SA')->not->toContain('PRESUPUESTO SA');
    expect($empresas('/leads?source=quote_form'))->toContain('PRESUPUESTO SA')->not->toContain('PERDIDA SA');
    expect($empresas('/leads?assigned=unassigned'))->toContain('PERDIDA SA')->not->toContain('ASIGNADA SA');
});

it('busca por nombre, correo, empresa y DOT', function () {
    prospecto($this->scenario->tenant->id, ['company_name' => 'Aceros Delta LLC', 'dot_number' => '3141592']);
    prospecto($this->scenario->tenant->id, ['company_name' => 'Otra Cosa LLC']);

    signIn($this->scenario, Role::Admin);

    $this->get('/leads?q=3141592')->assertInertia(function (Assert $page) {
        $empresas = collect($page->toArray()['props']['leads']['data'])->pluck('companyName')->all();

        expect($empresas)->toContain('Aceros Delta LLC')->not->toContain('Otra Cosa LLC');
    });
});

it('trata el comodín de LIKE como texto y no como comodín', function () {
    prospecto($this->scenario->tenant->id, ['company_name' => 'Aceros Delta LLC']);

    signIn($this->scenario, Role::Admin);

    $this->get('/leads?q=%25')->assertInertia(function (Assert $page) {
        expect($page->toArray()['props']['leads']['data'])->toBeEmpty();
    });
});

it('cuenta el embudo entero, sin los filtros aplicados', function () {
    prospecto($this->scenario->tenant->id, ['status' => 'new']);
    prospecto($this->scenario->tenant->id, ['status' => 'lost']);

    signIn($this->scenario, Role::Admin);

    // Los recuadros de arriba sirven para navegar; si cambiaran con el filtro,
    // al pinchar «perdido» los demás se pondrían a cero y no se podría volver.
    $this->get('/leads?status=lost')->assertInertia(function (Assert $page) {
        $counts = $page->toArray()['props']['counts'];

        expect($counts['new'])->toBeGreaterThan(0);
        expect($counts['lost'])->toBeGreaterThan(0);
    });
});

/* ── Mover el prospecto ─────────────────────────────────────────────────── */

it('cambia el estado y lo deja en la pista de auditoría', function () {
    $id = prospecto($this->scenario->tenant->id);

    signIn($this->scenario, Role::Admin);

    $this->post("/leads/{$id}/status", ['status' => 'contacted'])
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    expect(DB::table('leads')->where('id', $id)->value('status'))->toBe('contacted');

    $evento = DB::table('audit_events')
        ->where('entity_id', $id)
        ->where('action', 'lead.status_changed')
        ->first();

    expect($evento)->not->toBeNull();
    expect(json_decode((string) $evento->before_summary, true))->toBe(['status' => 'new']);
    expect(json_decode((string) $evento->after_summary, true))->toBe(['status' => 'contacted']);
});

it('exige un motivo para darlo por perdido', function () {
    $id = prospecto($this->scenario->tenant->id);

    signIn($this->scenario, Role::Admin);

    $this->post("/leads/{$id}/status", ['status' => 'lost'])
        ->assertSessionHasErrors('reason');

    expect(DB::table('leads')->where('id', $id)->value('status'))->toBe('new');

    $this->post("/leads/{$id}/status", ['status' => 'lost', 'reason' => 'Se fue con la competencia'])
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    expect(DB::table('leads')->where('id', $id)->value('status'))->toBe('lost');

    $motivo = DB::table('audit_events')
        ->where('entity_id', $id)
        ->where('action', 'lead.status_changed')
        ->orderByDesc('occurred_at')
        ->value('reason');

    expect($motivo)->toBe('Se fue con la competencia');
});

it('rechaza un estado que no está en el embudo', function () {
    $id = prospecto($this->scenario->tenant->id);

    signIn($this->scenario, Role::Admin);

    // `leads.status` no tiene CHECK en el esquema: la única defensa es la
    // validación, así que se comprueba de verdad.
    $this->post("/leads/{$id}/status", ['status' => 'facturado'])
        ->assertSessionHasErrors('status');

    expect(DB::table('leads')->where('id', $id)->value('status'))->toBe('new');
});

it('no deja mover el embudo a quien solo puede leerlo', function () {
    $id = prospecto($this->scenario->tenant->id);

    // Ningún rol trae `lead:read` sin `lead:update` —los dos son de
    // administrador—, así que el corte entre mirar y mover se prueba con una
    // excepción por usuario, que es como se concedería de verdad a un comercial.
    concedePermiso($this->scenario, Role::Accounting, 'lead:read');

    signIn($this->scenario, Role::Accounting);

    $this->get("/leads/{$id}")->assertOk();

    // Una acción denegada vuelve atrás con el motivo; no es un 403. Ver
    // bootstrap/app.php: la pantalla sí da 403, el botón no.
    $this->post("/leads/{$id}/status", ['status' => 'contacted'])->assertRedirect();

    expect(DB::table('leads')->where('id', $id)->value('status'))->toBe('new');
});

/* ── Asignar ────────────────────────────────────────────────────────────── */

it('asigna un responsable y lo deja en la pista', function () {
    $id = prospecto($this->scenario->tenant->id);
    $admin = $this->scenario->user(Role::Admin);

    signIn($this->scenario, Role::Admin);

    $this->post("/leads/{$id}/assign", ['assigned_to_user_id' => $admin->id])
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    expect(DB::table('leads')->where('id', $id)->value('assigned_to_user_id'))->toBe($admin->id);

    expect(DB::table('audit_events')
        ->where('entity_id', $id)
        ->where('action', 'lead.assigned')
        ->exists())->toBeTrue();
});

it('deja desasignar', function () {
    $admin = $this->scenario->user(Role::Admin);
    $id = prospecto($this->scenario->tenant->id, ['assigned_to_user_id' => $admin->id]);

    signIn($this->scenario, Role::Admin);

    $this->post("/leads/{$id}/assign", ['assigned_to_user_id' => ''])
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    expect(DB::table('leads')->where('id', $id)->value('assigned_to_user_id'))->toBeNull();
});

it('no deja asignar a alguien de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    $id = prospecto($this->scenario->tenant->id);
    $ajeno = $otra->user(Role::Admin);

    signIn($this->scenario, Role::Admin);

    // La clave foránea apunta a `users`, que NO lleva tenant_id: sin la
    // comprobación de pertenencia, la base aceptaría este id encantada y el
    // prospecto quedaría asignado a alguien que ni siquiera puede verlo.
    $this->post("/leads/{$id}/assign", ['assigned_to_user_id' => $ajeno->id])
        ->assertRedirect()
        ->assertSessionHas('error');

    expect(DB::table('leads')->where('id', $id)->value('assigned_to_user_id'))->toBeNull();
});

/* ── La ficha ───────────────────────────────────────────────────────────── */

it('enseña la solicitud de presupuesto que vino con el prospecto', function () {
    $id = prospecto($this->scenario->tenant->id, ['source' => 'quote_form']);

    DB::table('quote_requests')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'lead_id' => $id,
        'contact_name' => 'Ana Ruiz',
        'email' => 'ana@ejemplo.test',
        'commodity' => 'Turbina eólica',
        'weight_pounds' => 84000,
        'length_inches' => 1560,
        'origin_city' => 'Laredo',
        'origin_state' => 'TX',
        'destination_city' => 'Amarillo',
        'destination_state' => 'TX',
        'is_oversize_suspected' => 1,
        'locale' => 'es',
        'status' => 'new',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    signIn($this->scenario, Role::Admin);

    $this->get("/leads/{$id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Leads/Show')
            ->where('quotes.0.commodity', 'Turbina eólica')
            ->where('quotes.0.oversizeSuspected', true)
            ->where('quotes.0.origin', 'Laredo, TX'));
});

it('avisa de que el prospecto ya está en la casa', function () {
    $id = prospecto($this->scenario->tenant->id, [
        // Escrito con puntos; el cliente del escenario está sin ellos. Casan
        // porque se compara contra la columna normalizada.
        'company_name' => 'Cliente Escenario L.L.C.',
    ]);

    signIn($this->scenario, Role::Admin);

    $this->get("/leads/{$id}")->assertInertia(function (Assert $page) {
        $clientes = collect($page->toArray()['props']['matches']['customers'])->pluck('name')->all();

        expect($clientes)->toContain('Cliente Escenario LLC');
    });
});

it('no propone clientes de otra empresa como coincidencia', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    // Los dos escenarios crean un cliente con el mismo nombre. Sin frontera,
    // la ficha enseñaría el de la otra empresa como «ya está en la casa».
    $id = prospecto($this->scenario->tenant->id, ['company_name' => 'Cliente Escenario LLC']);

    signIn($this->scenario, Role::Admin);

    $this->get("/leads/{$id}")->assertInertia(function (Assert $page) use ($otra) {
        $ids = collect($page->toArray()['props']['matches']['customers'])->pluck('id')->all();

        expect($ids)->not->toContain($otra->customer->id);
    });
});

/* ── El alta de cliente con los datos del prospecto ─────────────────────── */

it('rellena el alta de cliente con lo que el prospecto contó', function () {
    $id = prospecto($this->scenario->tenant->id, [
        'company_name' => 'Aceros Delta LLC',
        'email' => 'compras@acerosdelta.test',
        'phone' => '+1 555 0199',
    ]);

    signIn($this->scenario, Role::Admin);

    $this->get("/customers/create?fromLead={$id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('prefill.company_name', 'Aceros Delta LLC')
            ->where('prefill.email', 'compras@acerosdelta.test')
            ->where('prefill.phone', '+1 555 0199'));
});

it('no rellena el alta con un prospecto de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    $ajeno = prospecto($otra->tenant->id, ['company_name' => 'AJENA SA']);

    signIn($this->scenario, Role::Admin);

    // Sin frontera aquí, la dirección de alta de cliente sería una mirilla a
    // los prospectos de cualquier empresa: basta con probar identificadores.
    $this->get("/customers/create?fromLead={$ajeno}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('prefill', null));
});

it('aguanta un fromLead que no existe', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/customers/create?fromLead='.Str::uuid())
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('prefill', null));
});

/* ── Que lo que escriben los formularios públicos llegue aquí ───────────── */

it('enseña el prospecto que dejó un envío real del formulario de contacto', function () {
    // El formulario público bajo el dominio de una empresa produce un prospecto
    // de ESA empresa. Es el camino entero, de la web a la pantalla.
    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.7'])
        ->post('/leads', envioDeContacto([
            'company_name' => 'Desde La Web LLC',
            'email' => 'web-'.Str::random(6).'@ejemplo.test',
        ]))
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    // El envío llegó sin dominio de empresa, así que es de la plataforma: se
    // le pone la empresa a mano para comprobar la pantalla, no el enrutado.
    DB::table('leads')
        ->where('company_name', 'Desde La Web LLC')
        ->update(['tenant_id' => $this->scenario->tenant->id]);

    signIn($this->scenario, Role::Admin);

    $this->get('/leads')->assertInertia(function (Assert $page) {
        $filas = collect($page->toArray()['props']['leads']['data']);
        $fila = $filas->firstWhere('companyName', 'Desde La Web LLC');

        expect($fila)->not->toBeNull();
        expect($fila['source'])->toBe('contact_form');
        expect($fila['status'])->toBe('new');
    });
});

/* ── El idioma en el que escribió ───────────────────────────────────────── */

it('guarda el idioma de la página desde la que se envió el formulario', function () {
    // Los tres formularios públicos van a rutas SIN prefijo de idioma
    // (`/leads`, `/quote-requests`, `/carrier-signup`), así que el prefijo de la
    // URL de destino no dice nada. Sin mirar el referente, alguien que rellena
    // la página en español con el navegador en inglés entra como `en` — y
    // `leads.locale` es justo la columna que decide en qué idioma se le
    // contesta.
    $this->withHeaders([
        'referer' => url('/es/contact'),
        'Accept-Language' => 'en-US,en;q=0.9',
    ])->post('/leads', envioDeContacto(['company_name' => 'Vino En Español LLC']))
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    expect(DB::table('leads')->where('company_name', 'Vino En Español LLC')->value('locale'))
        ->toBe('es');
});

it('no deja que un referente de otro sitio decida el idioma', function () {
    $this->withHeaders([
        'referer' => 'https://otro-sitio.example/es/lo-que-sea',
        'Accept-Language' => 'en-US,en;q=0.9',
    ])->post('/leads', envioDeContacto(['company_name' => 'Referente Ajeno LLC']))
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    expect(DB::table('leads')->where('company_name', 'Referente Ajeno LLC')->value('locale'))
        ->toBe('en');
});

it('el idioma elegido a mano gana sobre la página en la que se estaba', function () {
    // Quien eligió idioma eligió: la página en la que estuviera no le
    // contradice.
    $this->withCookie(\App\Support\Locales::COOKIE, 'en')
        ->withHeaders(['referer' => url('/es/contact')])
        ->post('/leads', envioDeContacto(['company_name' => 'Eligió A Mano LLC']))
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    expect(DB::table('leads')->where('company_name', 'Eligió A Mano LLC')->value('locale'))
        ->toBe('en');
});
