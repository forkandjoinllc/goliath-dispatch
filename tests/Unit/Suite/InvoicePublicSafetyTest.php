<?php

declare(strict_types=1);

use App\Support\Branding\Templates;
use App\Support\Finance\InvoiceLink;
use Tests\Support\Source;

/**
 * La página pública de una factura no puede enseñar de más, ni cobrar dos veces.
 *
 * ## Por qué un guardián y no solo pruebas
 *
 * Las dos cosas que este módulo puede hacer mal son silenciosas.
 *
 * **Enseñar de más.** La página la abre el transportista, y en `invoices` viven
 * columnas que no son suyas. Hoy la consulta pide las columnas una a una; el día
 * que alguien la cambie por un `select *` «para simplificar», la filtración no
 * da ningún error — sale bien y de más. Por eso esto mira el fichero.
 *
 * **Cobrar dos veces.** La idempotencia la da el índice único de
 * `payment_attempts`, no una comprobación en PHP: entre un «¿ya existe?» y un
 * insert hay una ventana, y las pasarelas reintentan justo ahí. Si alguien
 * sustituye el índice por un `if`, las pruebas siguen pasando —en un solo hilo
 * no hay carrera— y el fallo aparece en producción un viernes.
 *
 * `tests/Unit` no arranca la aplicación: la raíz sube tres niveles.
 */
function raizFactura(): string
{
    return dirname(__DIR__, 3);
}

function codigoDeFacturaSinComentarios(string $ruta): string
{
    // El cuerpo vivía copiado en quince ficheros. Ver Tests\Support\Source:
    // no quitaba los espacios, y por eso varias agujas de esta carpeta no
    // podían casar con nada.
    return Source::sinComentarios($ruta);
}

it('la página pública pide las columnas una a una', function (): void {
    $codigo = codigoDeFacturaSinComentarios(
        raizFactura().'/app/Http/Controllers/Public/InvoiceController.php'
    );

    // `first()` y `get()` sin lista de columnas traen la fila entera.
    expect(preg_match('/->(first|get)\(\s*\)/', $codigo))->toBe(
        0,
        'La página pública de la factura trae filas enteras. En `invoices` hay columnas que no son del '
        .'transportista que la abre, y una consulta sin lista de columnas se convierte en una filtración '
        .'el día que alguien añada una.'
    );
});

it('la idempotencia se apoya en el índice, no en un if', function (): void {
    $codigo = codigoDeFacturaSinComentarios(
        raizFactura().'/app/Support/Finance/InvoicePayments.php'
    );

    expect(str_contains($codigo, 'UniqueConstraintViolationException'))->toBeTrue(
        'El registro de intentos ya no se apoya en el índice único. Un `if (existe)` seguido de un insert '
        .'tiene una ventana entre los dos, y las pasarelas reintentan justo ahí: en un solo hilo las pruebas '
        .'pasan y el doble cobro aparece en producción.'
    );
});

it('el esquema mantiene el índice único de idempotencia', function (): void {
    // Y el índice tiene que seguir estando: la defensa de arriba no vale nada
    // sin él.
    $ddl = (string) file_get_contents(
        raizFactura().'/database/schema/05_finance_messaging_tracking_tables.sql'
    );

    expect(str_contains($ddl, 'payment_attempts_idempotency_uq'))->toBeTrue();
});

it('el correo de la factura es un evento de plantilla declarado', function (): void {
    // Si se puede reescribir, tiene que estar en la lista y tener sus fichas
    // documentadas — es lo que comprueba BrandSafetyTest para los demás.
    expect(InvoiceLink::EVENTO)->toBe('invoice.sent')
        ->and(Templates::FICHAS)->toHaveKey(InvoiceLink::EVENTO);
});
