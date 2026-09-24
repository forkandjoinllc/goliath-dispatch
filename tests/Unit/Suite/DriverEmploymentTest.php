<?php

declare(strict_types=1);

use App\Enums\AuditAction;
use App\Enums\DriverStatus;
use App\Support\Drivers\Employment;
use Tests\Support\Source;

/**
 * Quién puede llevar una carga, decidido en un solo sitio.
 *
 * ## El defecto que esto vigila
 *
 * La respuesta estaba escrita CUATRO veces —`Loads\Guards`, la puerta de
 * asignación, el aviso del selector de conductores y el filtro de la lista— y
 * las cuatro comparaban contra `'inactive'` a mano. Mientras hubo un solo
 * estado que bloqueaba, cuatro copias no hacían daño. Al entrar «en espera» y
 * «dado de baja», cuatro copias son cuatro sitios donde falta uno: un conductor
 * dado de baja habría seguido saliendo en el selector, y la única señal habría
 * sido alguien preguntando por qué le aparece quien ya no trabaja aquí.
 */
function fuenteDelEmpleo(string $ruta): string
{
    return Source::sinComentarios(Source::root().'/'.$ruta);
}

it('las cuatro puertas preguntan al mismo sitio', function (): void {
    foreach ([
        'app/Support/Loads/Guards.php',
        'app/Http/Controllers/App/LoadAssignmentController.php',
        'app/Http/Controllers/App/LoadController.php',
    ] as $ruta) {
        test()->assertStringContainsString(
            'Employment::',
            fuenteDelEmpleo($ruta),
            "`{$ruta}` volvió a decidir por su cuenta quién puede trabajar.",
        );
    }

    // Y el filtro de la lista sale del enum, DOS veces: el que recorta la
    // consulta y el que cuenta las pestañas. Comprobar que aparece «alguna
    // vez» dejaba pasar que uno de los dos volviera a una lista a mano, y el
    // que se quedara corto enseñaría una pestaña que no cuenta nada.
    expect(substr_count(
        fuenteDelEmpleo('app/Http/Controllers/App/DriverController.php'),
        'DriverStatus::values()',
    ))->toBe(2);
});

it('ninguna puerta compara contra «inactive» a mano', function (): void {
    foreach ([
        'app/Support/Loads/Guards.php',
        'app/Http/Controllers/App/LoadAssignmentController.php',
        'app/Http/Controllers/App/LoadController.php',
    ] as $ruta) {
        test()->assertStringNotContainsString(
            "'inactive'",
            fuenteDelEmpleo($ruta),
            "`{$ruta}` volvió a nombrar un estado de conductor a mano.",
        );
    }
});

it('los tres estados que bloquean tienen su aviso', function (): void {
    // «No está disponible» a secas manda a buscar el motivo a otra pantalla.
    expect(Employment::bloqueantes())->toBe(['inactive', 'on_hold', 'terminated']);

    foreach (Employment::bloqueantes() as $estado) {
        expect(Employment::bloquea($estado))->toBeTrue();
        expect(Employment::motivo($estado))->toBeString();
    }

    // Fuera de servicio NO bloquea: es el estado de quien está fuera de turno,
    // y planificar mañana la carga de quien hoy descansa es lo normal.
    expect(Employment::bloquea(DriverStatus::OffDuty))->toBeFalse();
    expect(Employment::bloquea(DriverStatus::Available))->toBeFalse();
});

it('cada aviso existe en los dos idiomas', function (): void {
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(Source::root()."/lang/{$idioma}/loads.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        foreach (Employment::bloqueantes() as $estado) {
            $clave = (string) Employment::motivo($estado);

            expect($d['assign'][$clave] ?? null)->toBeString("Falta loads.assign.{$clave} en {$idioma}.");
        }
    }
});

it('la nota es obligatoria y la recontratación se elige al dar de baja', function (): void {
    $codigo = fuenteDelEmpleo('app/Http/Controllers/App/DriverEmploymentController.php');

    // La nota, en los tres casos: `required` en la regla, no un `nullable` con
    // una comprobación que alguien pueda quitar sin darse cuenta.
    test()->assertStringContainsString("'note' => ['required'", $codigo);
    test()->assertStringContainsString("__('drivers.employment.noteRequired')", $codigo);

    // Y la decisión de recontratación, solo exigida con la baja.
    test()->assertStringContainsString("__('drivers.employment.rehireRequired')", $codigo);
    test()->assertStringContainsString('Employment::esBaja(', $codigo);
});

it('la baja suelta el equipo y la espera no', function (): void {
    // Un camión atado a alguien que ya no trabaja aquí no se le puede dar a
    // nadie. En espera es temporal y el camión sigue siendo el suyo.
    $codigo = fuenteDelEmpleo('app/Http/Controllers/App/DriverEmploymentController.php');

    test()->assertStringContainsString(
        "if (\$esBaja) {\n                StandingAssignment::terminarVigentes(",
        $codigo,
    );
});

it('el cambio deja rastro con su propia acción de auditoría', function (): void {
    // Y la acción está en el enum, que es de donde la migración reconstruye la
    // restricción de la base: una acción que no esté en la lista la rechaza
    // MySQL, que es donde se quiere que se rechace.
    expect(AuditAction::DriverEmploymentChanged->value)->toBe('driver.employment_changed');

    test()->assertStringContainsString(
        'AuditAction::DriverEmploymentChanged',
        fuenteDelEmpleo('app/Http/Controllers/App/DriverEmploymentController.php'),
    );

    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(Source::root()."/lang/{$idioma}/audit.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        expect($d['action']['driver']['employment_changed'] ?? null)->toBeString();
    }
});

it('el alta elige el equipo por el mismo camino que la ficha', function (): void {
    // Si el alta escribiera la fila por su cuenta, sería la puerta de atrás de
    // una regla que no tiene red debajo en la base.
    $codigo = fuenteDelEmpleo('app/Http/Controllers/App/DriverController.php');

    test()->assertStringContainsString('StandingAssignment::crear(', $codigo);

    // Y solo se ofrecen los camiones libres, con su transportista, para que la
    // pantalla enseñe los del que se acaba de marcar.
    test()->assertStringContainsString("'carrierId' => (string) \$r->carrier_id,", $codigo);
    test()->assertStringContainsString("'takenTrucks' => count(\$ocupados),", $codigo);
});
