<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use App\Support\Tracking\CustomerLink;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Mail\Events\MessageSending;
use Illuminate\Support\Facades\Event;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    // Sin `Mail::fake()`: el transporte de pruebas ya es `array` —no sale nada
    // de la máquina— y falsearlo además impide que se dispare `MessageSending`,
    // que es el único sitio donde se puede mirar un correo mandado con
    // `Mail::raw()`.
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Los campos mínimos para guardar un cliente por HTTP. */
function camposDeCliente(array $extra = []): array
{
    return [
        'company_name' => 'Cliente de prueba LLC',
        'status' => 'active',
        'physical_country' => 'US',
        'billing_country' => 'US',
        'billing_same_as_physical' => true,
        'payment_terms_days' => 30,
        ...$extra,
    ];
}

it('se puede dar de alta un cliente con sus contactos', function () {
    signIn($this->scenario, Role::Admin);

    // El defecto original: `customer_contacts` se leía en dos sitios y no la
    // escribía nadie. No había forma de llegar aquí.
    $this->post('/customers', camposDeCliente([
        'contacts' => [
            ['first_name' => 'Marisol', 'last_name' => 'Delgado', 'email' => 'marisol@cliente.test',
             'position' => 'traffic', 'preferred_locale' => 'es'],
            ['first_name' => 'Kim', 'last_name' => 'Reed', 'email' => 'ap@cliente.test',
             'position' => 'billing', 'preferred_locale' => 'en'],
        ],
    ]))->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        $contactos = DB::table('customer_contacts')->orderByDesc('is_primary')->get();

        expect($contactos)->toHaveCount(2)
            ->and($contactos[0]->first_name)->toBe('Marisol')
            ->and((bool) $contactos[0]->is_primary)->toBeTrue()
            ->and($contactos[0]->preferred_locale)->toBe('es')
            ->and((bool) $contactos[1]->is_primary)->toBeFalse();

        // El idioma de la ficha es el ESPEJO del principal.
        expect(DB::table('customers')->where('company_name', 'Cliente de prueba LLC')->value('preferred_locale'))
            ->toBe('es');
    });
});

it('un cargo fuera de la lista no entra', function () {
    signIn($this->scenario, Role::Admin);

    // Texto libre es cómo se acaba con «tráfico», «Trafico» y «OPS» en la misma
    // base, y entonces el cargo deja de poder elegir destinatario.
    $this->post('/customers', camposDeCliente([
        'contacts' => [
            ['first_name' => 'A', 'last_name' => 'B', 'email' => 'a@b.test',
             'position' => 'OPS', 'preferred_locale' => 'en'],
        ],
    ]))->assertSessionHasErrors('contacts.0.position');
});

it('un idioma que la aplicación no habla no entra', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/customers', camposDeCliente([
        'contacts' => [
            ['first_name' => 'A', 'last_name' => 'B', 'email' => 'a@b.test',
             'position' => 'traffic', 'preferred_locale' => 'fr'],
        ],
    ]))->assertSessionHasErrors('contacts.0.preferred_locale');
});

it('quitar un contacto lo borra en suave y deja el resto', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/customers', camposDeCliente([
        'contacts' => [
            ['first_name' => 'Uno', 'last_name' => 'Uno', 'email' => 'uno@cliente.test', 'position' => 'traffic', 'preferred_locale' => 'en'],
            ['first_name' => 'Dos', 'last_name' => 'Dos', 'email' => 'dos@cliente.test', 'position' => 'dock', 'preferred_locale' => 'es'],
        ],
    ]))->assertSessionHasNoErrors();

    [$clienteId, $unoId] = app(TenantContext::class)->runAs($this->scenario->tenant->id, fn (): array => [
        (string) DB::table('customers')->where('company_name', 'Cliente de prueba LLC')->value('id'),
        (string) DB::table('customer_contacts')->where('email', 'uno@cliente.test')->value('id'),
    ]);

    $this->patch("/customers/{$clienteId}", camposDeCliente([
        'contacts' => [
            ['id' => $unoId, 'first_name' => 'Uno', 'last_name' => 'Uno', 'email' => 'uno@cliente.test',
             'position' => 'traffic', 'preferred_locale' => 'en'],
        ],
    ]))->assertSessionHasNoErrors();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        // En suave: un contacto nombrado en el historial de una carga tiene que
        // poder seguir nombrándose.
        expect(DB::table('customer_contacts')->whereNull('deleted_at')->count())->toBe(1)
            ->and(DB::table('customer_contacts')->whereNotNull('deleted_at')->count())->toBe(1);
    });
});

// ────────────────────────────────────────────────────── a quién y en qué idioma

/** Pone contactos a mano en el cliente del escenario. */
function contactosDe(Scenario $s, array $filas): void
{
    app(TenantContext::class)->runAs($s->tenant->id, function () use ($s, $filas): void {
        foreach ($filas as $i => [$email, $cargo, $idioma]) {
            DB::table('customer_contacts')->insert([
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'tenant_id' => $s->tenant->id,
                'customer_id' => $s->customer->id,
                'first_name' => 'C'.$i,
                'last_name' => 'X',
                'email' => $email,
                'position' => $cargo,
                'preferred_locale' => $idioma,
                'is_primary' => $i === 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    });
}

it('el enlace va a quien espera la carga, no a contabilidad', function () {
    // El principal es el de facturación a propósito: sin la preferencia por
    // cargo, el enlace se le iría a él.
    contactosDe($this->scenario, [
        ['ap@cliente.test', 'billing', 'en'],
        ['trafico@cliente.test', 'traffic', 'es'],
    ]);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        expect(CustomerLink::sendForLoad(
            (string) $this->scenario->tenant->id,
            (string) $this->scenario->load->id,
            null,
        ))->toBe('sent');

        $enlace = DB::table('public_tracking_links')->where('load_id', $this->scenario->load->id)->first();

        expect($enlace->recipient_email)->toBe('trafico@cliente.test')
            ->and($enlace->sent_at)->not->toBeNull();
    });
});

it('el correo sale en el idioma del contacto y no en el de la empresa', function () {
    // La empresa del escenario trabaja en inglés; este cliente lee español.
    contactosDe($this->scenario, [['trafico@cliente.test', 'traffic', 'es']]);

    // `Mail::fake()` no sirve aquí: solo registra Mailables, y este correo se
    // manda con `Mail::raw()`. El suceso `MessageSending` sí lo dispara también
    // el envío en crudo, y trae el mensaje entero.
    Event::fake([MessageSending::class]);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        CustomerLink::sendForLoad((string) $this->scenario->tenant->id, (string) $this->scenario->load->id, null);
    });

    // El prefijo del idioma viaja EN la dirección: el cliente la abre desde su
    // correo, sin sesión ni cookie, y sin él leería lo que diga el navegador de
    // su oficina.
    Event::assertDispatched(MessageSending::class, function (MessageSending $e): bool {
        // `getBody()` devuelve una parte MIME, no una cadena: `getTextBody()`
        // es el texto que le llega a la persona.
        return str_contains((string) $e->message->getTextBody(), '/es/t/');
    });
});

it('sin ningún contacto con correo se dice que no hay a quién', function () {
    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        // El cliente del escenario no tiene correo propio ni contactos.
        DB::table('customers')->where('id', $this->scenario->customer->id)->update(['email' => null]);

        // Antes esto devolvía `false` y quien despachaba no se enteraba de
        // nada. El motivo es la diferencia entre «arréglelo» y «ya está bien».
        expect(CustomerLink::sendForLoad(
            (string) $this->scenario->tenant->id,
            (string) $this->scenario->load->id,
            null,
        ))->toBe('noRecipient');
    });
});

it('no se manda un segundo enlace para la misma carga', function () {
    contactosDe($this->scenario, [['trafico@cliente.test', 'traffic', 'es']]);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): void {
        expect(CustomerLink::sendForLoad((string) $this->scenario->tenant->id, (string) $this->scenario->load->id, null))
            ->toBe('sent')
            // Dos enlaces distintos para la misma carga es cómo se consigue que
            // el cliente abra el que ya no vale.
            ->and(CustomerLink::sendForLoad((string) $this->scenario->tenant->id, (string) $this->scenario->load->id, null))
            ->toBe('alreadySent');
    });
});
