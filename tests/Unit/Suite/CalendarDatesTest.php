<?php

declare(strict_types=1);

use App\Support\Time\CalendarDates;
use App\Support\Time\Pending;
use Tests\Support\Source;

use function PHPUnit\Framework\assertSame;
use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertStringNotContainsString;

/**
 * Un día del calendario no es un instante.
 *
 * ## El defecto
 *
 * `drivers.license_expires_at` la teclea una persona en un `<input type="date">`:
 * es «1 de junio de 2026», sin hora y sin huso. El servidor la mandaba con
 * `toIso8601String()` —`2026-06-01T00:00:00+00:00`— y la pantalla hacía
 * `new Date(eso)`, que el navegador lleva a SU huso. Con el reloj en Chicago:
 *
 * ```
 * /drivers              31 may 2026
 * /drivers/{id}/edit    2026-06-01
 * ```
 *
 * Un día de diferencia sobre el papel que permite que un camión salga. Y la
 * insignia «Vence pronto» la calcula el servidor sobre la fecha de verdad, así
 * que puede salir pegada a una fecha que ya pasó.
 *
 * ## Lo que hace que sea un descuido y no una decisión
 *
 * La forma correcta ya estaba escrita en la pantalla de Documentos
 * —`new Date(\`${v}T00:00:00\`)` sobre un día suelto— y no se aplicó en las otras
 * cuatro. Y dentro del MISMO método de `DriverController`, dos de estas columnas
 * salían con `toDateString()` y dos con `toIso8601String()`.
 *
 * ## Por qué el registro de husos no lo cazó
 *
 * `Time\Pending::SIN_CONVERTIR` cuenta las horas que salen EN CRUDO, con
 * `substr(…, 0, 16)`. Estas salían perfectamente formateadas en ISO 8601, con su
 * huso: estar mal de otra forma es lo que las dejó fuera de la lista que existe
 * para que no se olvide nada.
 */
function raizDias(): string
{
    return Source::root();
}

/**
 * Una pantalla sin sus comentarios.
 *
 * `Source::compacta()` usa `token_get_all()` y solo sabe de PHP. Aquí hace
 * falta lo mismo para TSX y por el mismo motivo: el comentario que explica el
 * defecto NOMBRA el defecto —«no un `new Date(value)` local»— y una aguja en
 * negativo lo encontraba ahí. La prueba se ponía roja por su propia
 * explicación.
 *
 * Se quitan los bloques `/* … *{@literal /}` y las líneas que empiezan por `//`.
 * Solo al principio de línea: un `https://` dentro de una cadena no es un
 * comentario.
 */
function pantallaSinComentarios(string $ruta): string
{
    $texto = (string) file_get_contents(raizDias().'/'.$ruta);

    $texto = (string) preg_replace('#/\*.*?\*/#s', '', $texto);

    return (string) preg_replace('#^\s*//.*$#m', '', $texto);
}

it('cada columna declarada dice por qué es un día', function (): void {
    expect(CalendarDates::SON_DIAS)->not->toBe([]);

    foreach (CalendarDates::SON_DIAS as $columna => $motivo) {
        expect(strlen($motivo))->toBeGreaterThan(30, "la columna «{$columna}» no dice por qué es un día");
    }

    // El criterio se comprueba mirando el formulario, así que las columnas que
    // se declaran días tienen que ser las que escribe un selector de fecha.
    foreach (['license_expires_at', 'medical_card_expires_at', 'registration_expires_at', 'next_inspection_due_at'] as $columna) {
        expect(CalendarDates::esDia($columna))->toBeTrue("«{$columna}» dejó de estar declarada");
    }

    // Y una que NO lo es: `created_at` la escribe el servidor y sí hay que
    // convertirla al huso de quien mira.
    expect(CalendarDates::esDia('created_at'))->toBeFalse();
});

it('el día se queda en diez caracteres, venga como venga', function (): void {
    // Los dos caminos: el modelo devuelve Carbon, y una consulta cruda devuelve
    // texto. Los dos tienen que dar lo mismo, porque los dos existen en este
    // código —`DriverController` usa el modelo y `EquipmentController` lee
    // atributos sueltos.
    assertSame('2026-06-01', CalendarDates::dia(new DateTimeImmutable('2026-06-01 00:00:00')));
    assertSame('2026-06-01', CalendarDates::dia('2026-06-01 00:00:00.000'));
    assertSame('2026-06-01', CalendarDates::dia('2026-06-01T00:00:00+00:00'));
    assertSame(null, CalendarDates::dia(null));
    assertSame(null, CalendarDates::dia(''));

    // Y NO arrastra un «00:00» que no significa nada: dieciséis caracteres
    // invitan a volver a tratarlo como una hora, que es de donde viene el
    // defecto.
    expect(strlen((string) CalendarDates::dia('2026-06-01 00:00:00')))->toBe(10);
});

it('los dos controladores mandan día donde es día', function (): void {
    $conductores = Source::compacta(raizDias().'/app/Http/Controllers/App/DriverController.php');
    $equipos = Source::compacta(raizDias().'/app/Http/Controllers/App/EquipmentController.php');

    foreach ([
        ['licenseExpiresAt', $conductores, 'license_expires_at'],
        ['medicalCardExpiresAt', $conductores, 'medical_card_expires_at'],
        ['twicExpiresAt', $conductores, 'twic_expires_at'],
        ['recordCheckedAt', $conductores, 'record_checked_at'],
    ] as [$clave, $fuente, $columna]) {
        assertStringContainsString("'{$clave}'=>CalendarDates::dia(\$d->{$columna})", $fuente);
    }

    foreach (['next_inspection_due_at', 'registration_expires_at', 'last_inspection_at', 'last_maintenance_at', 'next_maintenance_due_at'] as $columna) {
        assertStringContainsString("CalendarDates::dia(\$g('{$columna}'))", $equipos);
    }

    // Y ninguna de las dos vías viejas sobrevive para estas columnas. Es la
    // comprobación que importa: el defecto era que la MISMA clase de dato salía
    // de dos formas en el mismo método.
    foreach (['license_expires_at', 'medical_card_expires_at', 'twic_expires_at'] as $columna) {
        assertStringNotContainsString("\$d->{$columna}?->toIso8601String()", $conductores);
        assertStringNotContainsString("\$d->{$columna}?->toDateString()", $conductores);
    }

    foreach (['next_inspection_due_at', 'registration_expires_at'] as $columna) {
        assertStringNotContainsString("\$this->iso(\$g('{$columna}'))", $equipos);
    }
});

it('ninguna pantalla construye una fecha con el instante que le mandan', function (): void {
    // `new Date(iso)` es CORRECTO para un instante —cuándo se aprobó algo— y es
    // el defecto para un día. Por eso la comprobación no prohíbe `new Date`:
    // exige que las cuatro pantallas de conductores y equipos usen las
    // funciones con nombre, que son las que distinguen las dos cosas.
    foreach ([
        'resources/js/pages/App/Drivers/Index.tsx',
        'resources/js/pages/App/Drivers/Show.tsx',
        'resources/js/pages/App/Equipment/Index.tsx',
        'resources/js/pages/App/Equipment/Show.tsx',
    ] as $ruta) {
        $pantalla = pantallaSinComentarios($ruta);

        assertStringContainsString('formatDay(', $pantalla, "{$ruta} dejó de usar formatDay");
        assertStringNotContainsString('new Date(', $pantalla, "{$ruta} volvió a construir una fecha a mano");
    }
});

it('el ayudante del cliente pega la medianoche local', function (): void {
    $format = pantallaSinComentarios('resources/js/lib/format.ts');

    // Sin `T00:00:00`, `new Date('2026-06-01')` es medianoche UTC y el navegador
    // la vuelve a mover. La aguja lleva la plantilla entera porque el defecto
    // cabe en los dos caracteres que faltan.
    assertStringContainsString('new Date(`${value.slice(0, 10)}T00:00:00`)', $format);

    // Y sin huso explícito: poner `timeZone` aquí sería elegir por el que mira.
    assertStringNotContainsString('timeZone:', $format);
});

it('la lista de husos pendientes no se contradice con esta', function (): void {
    // `Pending` cuenta las horas que salen en crudo y estas columnas nunca
    // estuvieron ahí: salían bien formateadas y mal entendidas. Si alguien
    // añadiera uno de estos ficheros a esa lista, estaría declarando como deuda
    // de huso algo que no tiene huso.
    foreach (['DriverController', 'EquipmentController'] as $fichero) {
        foreach (array_keys(Pending::SIN_CONVERTIR) as $ruta) {
            if (! str_contains($ruta, $fichero)) {
                continue;
            }

            // EquipmentController sigue teniendo UNA hora pendiente declarada
            // —la última verificación de una unidad— y esa no es un día. Lo que
            // no puede es crecer con las que este lote acaba de convertir.
            expect(Pending::SIN_CONVERTIR[$ruta][0])->toBeLessThanOrEqual(
                1,
                "«{$ruta}» declara más horas pendientes de las que quedan",
            );
        }
    }
});
