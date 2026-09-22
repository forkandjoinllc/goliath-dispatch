<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * El formulario de alta de equipo, en las dos cosas que se le pidieron.
 *
 * 1. El transportista se busca escribiendo, no se recorre.
 * 2. El VIN rellena marca, modelo y año — y SOLO lo que está en blanco.
 *
 * Lo que mide el comportamiento del servidor es
 * `tests/Feature/Fleet/VinLookupTest.php`. Esto fija la forma de la pantalla,
 * que es donde vive la mitad que el servidor no puede comprobar.
 */
function raizFormulario(): string
{
    return Source::root();
}

function pantallaDeEquipo(): string
{
    return (string) file_get_contents(raizFormulario().'/resources/js/pages/App/Equipment/Form.tsx');
}

it('el transportista se busca escribiendo', function (): void {
    $pantalla = pantallaDeEquipo();

    test()->assertStringContainsString(
        '<SearchableSelect',
        $pantalla,
        'El transportista volvió a ser un desplegable que hay que recorrer.',
    );

    // El MISMO componente que el alta de conductores. Dos comboboxes escritos
    // por separado acaban comportándose distinto, y el segundo siempre peor.
    test()->assertStringContainsString("from '@/components/Form/SearchableSelect'", $pantalla);
});

it('lo elegido se ve y se puede cambiar', function (): void {
    // Un buscador que no enseña lo que ya está elegido obliga a recordarlo, y
    // en un formulario largo eso es adivinar.
    $pantalla = pantallaDeEquipo();

    test()->assertStringContainsString('selected={elegido}', $pantalla);
    test()->assertStringContainsString('onClear=', $pantalla);
});

it('el VIN solo se consulta cuando está completo', function (): void {
    // Consultar a cada tecla serían diecisiete llamadas y dieciséis respuestas
    // que no sirven.
    $pantalla = pantallaDeEquipo();

    test()->assertStringContainsString('limpio.length !== 17', $pantalla);
});

it('el VIN no pisa lo que la persona escribió', function (): void {
    // Es la regla de este lote: rellenar SOLO lo vacío. En equipos viejos el
    // dato del fabricante y el de la placa no siempre coinciden, y quien
    // corrigió uno a mano tenía una razón.
    $pantalla = pantallaDeEquipo();

    foreach (["form.data.make === ''", "form.data.model === ''", 'form.data.year === null'] as $condicion) {
        test()->assertStringContainsString(
            $condicion,
            $pantalla,
            "El VIN rellena un campo sin comprobar antes que esté vacío: {$condicion}",
        );
    }
});

it('se dice qué se rellenó y se puede deshacer', function (): void {
    // Rellenar campos sin decirlo es la clase de ayuda que deja a alguien
    // guardando un dato que no escribió ni leyó.
    $pantalla = pantallaDeEquipo();

    test()->assertStringContainsString('equipment.form.vinUndo', $pantalla);
    test()->assertStringContainsString('deshacerVin', $pantalla);
});

it('una respuesta vieja no pisa a una nueva', function (): void {
    // Se escribe deprisa y el orden de vuelta no está garantizado: sin esto,
    // corregir el último carácter del VIN podía dejar los datos del número
    // anterior.
    $pantalla = pantallaDeEquipo();

    test()->assertStringContainsString('mio !== pedido.current', $pantalla);
});

it('los textos del VIN existen en los dos idiomas', function (): void {
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(raizFormulario()."/lang/{$idioma}/equipment.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        foreach ([
            'carrierSearchPlaceholder', 'noCarrierMatches',
            'vinLooking', 'vinChecksum', 'vinFilledLive', 'vinFilledOffline', 'vinUndo',
        ] as $clave) {
            expect($d['form'][$clave] ?? null)->toBeString("Falta equipment.form.{$clave} en {$idioma}.");
        }

        // El aviso del respaldo tiene que decir por qué falta el modelo: sin
        // esa frase, el campo vacío se lee como un fallo.
        expect($d['form']['vinFilledOffline'])->toContain($idioma === 'es' ? 'modelo' : 'model');
    }
});
