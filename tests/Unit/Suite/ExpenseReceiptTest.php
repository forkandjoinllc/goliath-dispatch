<?php

declare(strict_types=1);

/**
 * «El revisor no puede aprobar un gasto al que le falte un recibo obligatorio.»
 *
 * ## El defecto
 *
 * Esa frase llevaba en el diccionario portado desde el primer día y no había
 * nada detrás. `expenses.receipt_document_id` existía y no la escribía nadie:
 * no había forma de adjuntar un recibo a un gasto en toda la aplicación. Y
 * `expense_categories.requires_receipt` está sembrada con valores de verdad
 * —el combustible y las reparaciones lo exigen, los peajes no—, se CONSULTABA
 * en la pantalla de alta, y se tiraba en el `map()` justo antes de mandarla al
 * navegador. El cliente nunca la vio.
 *
 * Lo que lo hace peor que un ajuste inerte es qué guarda. Un gasto aprobado se
 * rebota al cliente en la factura o se descuenta de la liquidación del
 * transportista: aprobar sin papel es firmar un agujero que aparece meses
 * después, cuando alguien lo discute.
 *
 * ## Qué sujeta este guardián
 *
 * 1. Que la puerta exista y mire la copia congelada, no la categoría de hoy.
 * 2. Que solo cierre al APROBAR — rechazar un gasto sin recibo es justo lo que
 *    hay que poder hacer con él.
 * 3. Que el recibo se pueda escribir de verdad.
 * 4. Que la pantalla enseñe lo mismo que exige la puerta.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código, como en los demás
 * guardianes de esta carpeta.
 */
function raizRecibo(): string
{
    return dirname(__DIR__, 3);
}

function codigoDeReciboSinComentarios(string $ruta): string
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

it('sin recibo no se aprueba', function (): void {
    $codigo = codigoDeReciboSinComentarios(raizRecibo().'/app/Http/Controllers/App/ExpenseController.php');

    expect(str_contains($codigo, "__('expenses.errors.receiptRequired')"))->toBeTrue(
        'La puerta del recibo desapareció. «El revisor no puede aprobar un gasto al que le falte un recibo '
        .'obligatorio» vuelve a ser una frase sin nada detrás, y lo que se aprueba se rebota al cliente o se '
        .'descuenta de la liquidación del transportista.'
    );

    // La condición entera, no solo el mensaje: tiene que mirar las TRES cosas.
    expect(str_contains(
        $codigo,
        "\$nuevo === 'approved' && \$model->requires_receipt_snapshot && \$model->receipt_document_id === null",
    ))->toBeTrue(
        'La condición de la puerta cambió. Tiene que cerrar solo al aprobar, solo si el gasto exigía recibo '
        .'cuando se presentó, y solo si no lo tiene.'
    );
});

it('la puerta mira la copia congelada y no la categoría de hoy', function (): void {
    $codigo = codigoDeReciboSinComentarios(raizRecibo().'/app/Http/Controllers/App/ExpenseController.php');

    // Marcar «peajes» como categoría con recibo el mes que viene no puede dejar
    // mal aprobados los peajes de este. Es la misma decisión que ya tomó
    // `treatment_snapshot`, y por la misma razón.
    expect(str_contains($codigo, 'requires_receipt_snapshot'))->toBeTrue();

    expect(str_contains($codigo, "'requires_receipt_snapshot' => (bool) \$categoria->requires_receipt"))->toBeTrue(
        'El gasto dejó de congelar si su categoría exigía recibo. Sin la copia, la puerta juzga los gastos '
        .'viejos con la regla de hoy.'
    );
});

it('rechazar y reembolsar no pasan por la puerta', function (): void {
    $codigo = codigoDeReciboSinComentarios(raizRecibo().'/app/Http/Controllers/App/ExpenseController.php');

    // Un gasto sin recibo hay que poder RECHAZARLO — es lo que hay que hacer
    // con él— y uno ya aprobado hay que poder reembolsarlo: esa decisión se
    // tomó con el papel delante.
    preg_match("/if \(\\\$nuevo === 'approved' && .*?\n        \}/s", $codigo, $m);

    expect($m)->not->toBeEmpty('No se encontró la puerta del recibo.');

    expect(str_contains($m[0], "'rejected'"))->toBeFalse(
        'La puerta del recibo empezó a cerrarle el paso al rechazo. Un gasto sin recibo tiene que poder '
        .'rechazarse: es exactamente lo que hay que hacer con él.'
    );
});

it('el recibo se puede escribir', function (): void {
    $codigo = codigoDeReciboSinComentarios(raizRecibo().'/app/Support/Documents/ExpenseFile.php');

    // El defecto original: la columna existía y no la escribía nadie.
    expect(str_contains($codigo, "'receipt_document_id' => \$document->id"))->toBeTrue(
        'Ya no hay forma de adjuntar un recibo a un gasto. La columna vuelve a existir sin que nadie la '
        .'escriba, y la puerta se convierte en un muro sin puerta.'
    );

    // Y como documento de verdad, no en un almacén aparte: así hereda la
    // retención, el barrido de huérfanos y el enlace firmado.
    expect(str_contains($codigo, "owner_type = 'expense'"))->toBeTrue();
});

it('la pantalla enseña lo que la puerta exige', function (): void {
    $controlador = codigoDeReciboSinComentarios(raizRecibo().'/app/Http/Controllers/App/ExpenseController.php');
    $tsx = (string) file_get_contents(raizRecibo().'/resources/js/pages/App/Expenses/Index.tsx');

    // `requires_receipt` se consultaba y se tiraba en el map(): el navegador
    // nunca la veía. Que la puerta exista y la pantalla no lo diga es peor que
    // no tener puerta — quien aprueba se choca con un error que no vio venir.
    expect(str_contains($controlador, "'requiresReceipt' => (bool) \$c->requires_receipt"))->toBeTrue(
        'La categoría volvió a tirar `requires_receipt` antes de mandarla. Quien presenta un gasto no se entera '
        .'de que hace falta recibo.'
    );

    expect(str_contains($controlador, "'requiresReceipt' => (bool) \$e->requires_receipt_snapshot"))->toBeTrue(
        'La fila del gasto dejó de decir si exige recibo.'
    );

    expect(str_contains($tsx, 'expenses.receipt.missing'))->toBeTrue(
        'La lista de gastos dejó de avisar de que falta el recibo.'
    );
});
