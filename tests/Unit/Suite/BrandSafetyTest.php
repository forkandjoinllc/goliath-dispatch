<?php

declare(strict_types=1);

use App\Support\Branding\Brand;
use App\Support\Branding\Templates;

/**
 * Lo que una empresa escribe sobre su marca no puede hacer daño a quien lo lee.
 *
 * ## Por qué hace falta un guardián aquí
 *
 * Este lote abre, por primera vez, una puerta para que un cliente nuestro meta
 * contenido que leerá un TERCERO que no nos conoce: el pie del correo y el texto
 * del aviso que recibe el cliente de la casa de despacho.
 *
 * Las columnas del esquema se llaman `email_header_html` y `email_footer_html`.
 * El nombre invita a guardar HTML, y guardar HTML ahí sería regalar un vector de
 * suplantación —un bloque «confirme sus datos bancarios» con el aspecto del
 * resto del mensaje— a cambio de dejar poner negritas. Es la clase de decisión
 * que alguien deshace dentro de seis meses «para que se vea mejor», y por eso
 * está aquí y no solo en un comentario.
 *
 * ## Qué comprueba
 *
 * 1. Que el pie se limpie AL LEER y no solo al escribir: una defensa que solo
 *    está en el formulario se salta con un `update`.
 * 2. Que el color se compruebe al leer, por lo mismo.
 * 3. Que las plantillas NO puedan reescribir avisos internos. Que una empresa
 *    escriba lo que le manda a su cliente es suyo; que reescriba lo que lee su
 *    propio equipo convierte cada informe de soporte en una adivinanza.
 *
 * `tests/Unit` no arranca la aplicación: la raíz sube tres niveles.
 */
function raizMarca(): string
{
    return dirname(__DIR__, 3);
}

function codigoDeMarcaSinComentarios(string $ruta): string
{
    $codigo = '';

    foreach (token_get_all((string) file_get_contents($ruta)) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }

        $codigo .= is_array($token) ? $token[1] : $token;
    }

    return $codigo;
}

it('el pie y el color se limpian al leer, no solo al escribir', function (): void {
    $codigo = codigoDeMarcaSinComentarios(raizMarca().'/app/Support/Branding/Brand.php');

    expect(str_contains($codigo, 'strip_tags'))->toBeTrue(
        'El pie del correo ya no se limpia de marcado al leerlo. Ese texto lo escribe una empresa '
        .'y lo lee un tercero que no nos conoce: una defensa que solo está en el formulario se salta con un `update`.'
    )->and(str_contains($codigo, 'preg_match'))->toBeTrue(
        'El color ya no se comprueba al leerlo. Por lo mismo.'
    );
});

it('solo se pueden reescribir los avisos que salen fuera', function (): void {
    expect(Templates::EDITABLES)->toBe([Templates::ENLACE_DE_RASTREO]);

    // Si mañana se añade alguno, que sea una decisión y no un descuido: los
    // avisos internos los lee el propio equipo, y dejar que cada empresa los
    // reescriba convierte cada informe de soporte en una adivinanza.
    foreach (Templates::EDITABLES as $evento) {
        expect(Templates::FICHAS)->toHaveKey($evento);
    }
});

it('la marca por defecto es un color de verdad', function (): void {
    foreach (Brand::POR_DEFECTO as $color) {
        expect(preg_match('/^#[0-9A-Fa-f]{6}$/', $color))->toBe(1);
    }
});
