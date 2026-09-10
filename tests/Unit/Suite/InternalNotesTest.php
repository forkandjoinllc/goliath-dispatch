<?php

declare(strict_types=1);

use App\Authorization\Actor;
use App\Enums\Locale;
use App\Enums\Role;
use App\Support\Privacy\Internal;
use Tests\Support\Source;

/**
 * Lo que la pantalla declara interno no puede salir en la respuesta del otro.
 *
 * ## El defecto
 *
 * Dos campos llevan la promesa escrita en su propia etiqueta:
 *
 * | Campo | Lo que dice |
 * |---|---|
 * | `carriers.notes` | «Visibles para su equipo. No se le muestran al transportista.» |
 * | `loads.internal_notes` | «Solo para su equipo. Nunca se le muestran al transportista ni al cliente.» |
 *
 * Los dos salían. Medido: el transportista entra, abre SU ficha y SU carga, y
 * los dos textos vienen dentro de la respuesta —200, con el contenido—.
 *
 * En la carga era peor. La pantalla pintaba `specialInstructions ??
 * internalNotes` bajo un rótulo que dice «Notas» a secas, así que una carga sin
 * instrucciones para el conductor enseñaba las notas internas en el hueco de
 * las instrucciones. Ni el transportista sabía que leía algo que no era para
 * él, ni el despachador que lo que escribía acababa ahí.
 *
 * ## Lo que hace peor el hallazgo
 *
 * El resto de la familia cumplía. Ni el enlace público de rastreo, ni la
 * factura pública, ni el papel de la tarifa emiten una sola nota; las notas del
 * cliente tampoco salen. Las dos únicas que fallaban eran las dos que lo
 * prometen por escrito — otra vez la regla que se cumple en todas partes menos
 * donde está más dicha.
 */
function raizNotas(): string
{
    return Source::root();
}

function actorCon(?Role $rol): Actor
{
    return new Actor(
        userId: 'u1',
        email: 'a@b.test',
        firstName: 'A',
        lastName: 'B',
        locale: Locale::Es,
        timezone: 'America/Chicago',
        isPlatformSuperAdmin: $rol === Role::PlatformSuperAdmin,
        tenantId: 't1',
        role: $rol,
    );
}

/* ── El lado de la mesa ──────────────────────────────────────────────────── */

it('cada rol está clasificado', function (): void {
    // El reparto se hace por rol y no por si el actor trae `carrierId`, para
    // que un rol nuevo OBLIGUE a decidir de qué lado está. Si algún día se
    // añade Role::Customer y nadie lo clasifica, esta prueba lo dice con el
    // nombre antes de que `match` reviente en producción.
    foreach (Role::cases() as $rol) {
        $esEquipo = Internal::esEquipo(actorCon($rol));
        expect($esEquipo)->toBeBool("El rol {$rol->value} no está clasificado.");

        test()->assertSame(
            ! in_array($rol, Internal::CONTRAPARTES, true),
            $esEquipo,
            "El rol {$rol->value} dice una cosa en CONTRAPARTES y otra en esEquipo().",
        );
    }
});

it('el transportista y el conductor son la otra parte', function (): void {
    expect(Internal::CONTRAPARTES)->toBe([Role::Carrier, Role::Driver]);

    expect(Internal::esEquipo(actorCon(Role::Carrier)))->toBeFalse()
        ->and(Internal::esEquipo(actorCon(Role::Driver)))->toBeFalse()
        ->and(Internal::esEquipo(actorCon(Role::Dispatcher)))->toBeTrue()
        ->and(Internal::esEquipo(actorCon(Role::Admin)))->toBeTrue()
        ->and(Internal::esEquipo(actorCon(Role::Accounting)))->toBeTrue()
        ->and(Internal::esEquipo(actorCon(Role::PlatformSuperAdmin)))->toBeTrue();
});

it('sin rol no se es del equipo', function (): void {
    // Un actor a medio construir no hereda el beneficio de la duda: en un campo
    // que promete confidencialidad, la duda se resuelve callando.
    expect(Internal::esEquipo(actorCon(null)))->toBeFalse();
});

it('soloEquipo devuelve null, no el texto', function (): void {
    expect(Internal::soloEquipo(actorCon(Role::Carrier), 'secreto'))->toBeNull()
        ->and(Internal::soloEquipo(actorCon(Role::Dispatcher), 'secreto'))->toBe('secreto')
        ->and(Internal::soloEquipo(actorCon(Role::Dispatcher), null))->toBeNull();
});

/* ── El registro de promesas ─────────────────────────────────────────────── */

it('cada campo declarado sigue teniendo su promesa escrita en los dos idiomas', function (): void {
    // Las dos formas de descuadrarse: borrar la promesa y dejar de cerrar el
    // campo, o cerrar el campo y dejar la promesa sin dueño.
    foreach (Internal::DECLARADAS as $campo => $clave) {
        [$fichero, $resto] = explode('.', $clave, 2);

        foreach (['es', 'en'] as $idioma) {
            $d = json_decode((string) file_get_contents(raizNotas()."/lang/{$idioma}/{$fichero}.json"), true);

            $texto = $d;
            foreach (explode('.', $resto) as $paso) {
                $texto = $texto[$paso] ?? null;
            }

            expect($texto)->toBeString("Falta {$clave} en {$idioma}, y {$campo} la necesita.");

            test()->assertMatchesRegularExpression(
                '/(no se le muestran|nunca se le muestran|not shown|never shown)/i',
                (string) $texto,
                "La promesa de {$campo} en {$idioma} ya no dice a quién no se le muestra.",
            );
        }
    }
});

it('los dos campos declarados pasan por la puerta', function (): void {
    $sitios = [
        'carriers.notes' => ['app/Http/Controllers/App/CarrierController.php', "'notes'=>Internal::soloEquipo(\$actor,\$c->notes)"],
        'loads.internal_notes' => ['app/Http/Controllers/App/LoadController.php', "'internalNotes'=>Internal::soloEquipo(\$actor,\$l->internal_notes)"],
    ];

    expect(array_keys($sitios))->toBe(array_keys(Internal::DECLARADAS));

    foreach ($sitios as $campo => [$fichero, $aguja]) {
        $fuente = Source::compacta(raizNotas().'/'.$fichero);

        test()->assertStringContainsString($aguja, $fuente, "{$campo} se manda sin pasar por la puerta.");
    }
});

/* ── Las pantallas ───────────────────────────────────────────────────────── */

it('las notas internas ya no ocupan el hueco de las instrucciones', function (): void {
    // `specialInstructions ?? internalNotes` es lo que hacía que una carga sin
    // instrucciones enseñara las notas internas bajo el rótulo «Notas».
    $fuente = Source::sinComentarios(raizNotas().'/resources/js/pages/App/Loads/Show.tsx');

    test()->assertStringNotContainsString(
        'load.specialInstructions ?? load.internalNotes',
        $fuente,
        'Las instrucciones del conductor y las notas internas son dos textos distintos.',
    );
});

it('las dos tarjetas son del equipo', function (): void {
    foreach ([
        'resources/js/pages/App/Loads/Show.tsx' => 'loads.detail.internalNotes',
        'resources/js/pages/App/Carriers/Show.tsx' => 'carriers.detail.notes',
    ] as $fichero => $rotulo) {
        $fuente = Source::sinComentarios(raizNotas().'/'.$fichero);

        test()->assertStringContainsString(
            'can.readInternalNotes ?',
            $fuente,
            "La tarjeta de {$rotulo} se pinta sin mirar de qué lado está quien mira.",
        );

        test()->assertStringContainsString($rotulo, $fuente);
    }
});
