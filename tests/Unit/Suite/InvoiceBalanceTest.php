<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * El saldo de una factura lo escribe un solo sitio.
 *
 * ## El defecto
 *
 * `PaymentLedger::resync()` decía en su comentario ser «el único sitio que toca
 * `amount_paid_cents`, `balance_cents`, `status` y `paid_at` por causa de un
 * cobro». No lo era. `InvoicePayments` tenía su propio `aplicarALaFactura()`
 * que escribía las mismas cuatro columnas por la vía de la pasarela, y con dos
 * diferencias que importan:
 *
 *  1. SUMABA sobre la columna en vez de recalcular desde las filas de
 *     `payments`. Dos caminos que dan el mismo número por casualidad dejan de
 *     darlo en cuanto se cruzan.
 *  2. No pasaba por `statusFor()`, que existe literalmente para que «una
 *     factura anulada, en disputa o dada por incobrable no vuelva a pagada».
 *
 * Consecuencia: si la oficina anulaba una factura mientras un cobro iba de
 * camino, el cobro aterrizaba y la marcaba PAGADA. Y desde el lote 68 arrastraba
 * además sus cargas a «Pagada», con su fila de historial.
 *
 * ## Por qué existía el segundo escritor
 *
 * Porque `resync()` pedía un `Actor` para usar de él una sola cosa: su empresa.
 * El webhook de la pasarela no tiene actor, así que el método parecía
 * inalcanzable desde ahí y alguien escribió otro. Ahora pide un `tenantId`, que
 * es lo que siempre necesitó. Una firma que pide de más fabrica duplicados.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código.
 */
function raizSaldo(): string
{
    return Source::root();
}

it('la pasarela no vuelve a tener su propio escritor', function (): void {
    $codigo = Source::compacta(raizSaldo().'/app/Support/Finance/InvoicePayments.php');

    expect(str_contains($codigo, 'aplicarALaFactura'))->toBeFalse(
        'Volvió el segundo escritor del saldo. Un cobro que aterrice después de anular la factura la '
        .'marcará pagada, que es justo lo que statusFor() existe para impedir.'
    );

    expect(str_contains($codigo, 'PaymentLedger::resync('))->toBeTrue(
        'La pasarela dejó de recalcular la factura con el escritor de verdad.'
    );
});

it('nadie más escribe las cuatro columnas del saldo', function (): void {
    $sospechosas = [];

    $iterador = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(raizSaldo().'/app', RecursiveDirectoryIterator::SKIP_DOTS)
    );

    foreach ($iterador as $fichero) {
        if ($fichero->getExtension() !== 'php') {
            continue;
        }

        $ruta = (string) $fichero->getPathname();

        // El escritor legítimo. Y `InvoiceBuilder`, que las ESTRENA al emitir:
        // eso no es «por causa de un cobro», que es lo que la regla acota.
        if (str_ends_with($ruta, 'Finance/PaymentLedger.php') || str_ends_with($ruta, 'Finance/InvoiceBuilder.php')) {
            continue;
        }

        foreach (explode(';', Source::compacta($ruta)) as $sentencia) {
            if (! str_contains($sentencia, "DB::table('invoices')")) {
                continue;
            }

            foreach (["'amount_paid_cents'=>", "'balance_cents'=>", "'paid_at'=>"] as $aguja) {
                if (str_contains($sentencia, $aguja)) {
                    $sospechosas[] = basename($ruta).' → '.$aguja;
                }
            }
        }
    }

    // `InvoiceController::void()` escribe `balance_cents => 0` a propósito y por
    // eso está aquí: anular no es un cobro, y poner el saldo a cero es lo que
    // significa anular. Si aparece otro, es un segundo escritor otra vez.
    expect($sospechosas)->toBe(["InvoiceController.php → 'balance_cents'=>"],
        'Alguien más volvió a escribir el saldo de una factura: '.implode(', ', $sospechosas).'. Con dos '
        .'escritores las columnas y las filas de `payments` se separan, y la que se equivoque es la que se '
        .'está mirando.'
    );
});

it('el saldo de una factura que no depende del dinero no se recalcula', function (): void {
    $codigo = Source::compacta(raizSaldo().'/app/Support/Finance/PaymentLedger.php');

    expect(str_contains($codigo, 'self::SIN_SALDO'))->toBeTrue(
        'El recalculador volvió a darle saldo vivo a una factura anulada. La pantalla de vencidos la '
        .'contaría otra vez.'
    );

    // La MISMA lista que protege el estado protege el saldo. Con dos listas,
    // una factura podría quedar «anulada» y con saldo, o al revés.
    expect(substr_count($codigo, 'SIN_SALDO'))->toBeGreaterThanOrEqual(3);
});

it('recalcular no pide un actor que no necesita', function (): void {
    $codigo = Source::compacta(raizSaldo().'/app/Support/Finance/PaymentLedger.php');

    expect(str_contains($codigo, 'functionresync(Actor$actor'))->toBeFalse(
        'resync() volvió a pedir un Actor. Del actor solo usaba su empresa, y pedirlo entero la volvía '
        .'inalcanzable desde el webhook — que es por lo que alguien escribió un segundo escritor.'
    );

    expect(str_contains($codigo, 'functionresync(string$tenantId,string$invoiceId)'))->toBeTrue();
});

it('el cobro que entra por la pasarela deja rastro', function (): void {
    $codigo = Source::compacta(raizSaldo().'/app/Support/Finance/InvoicePayments.php');

    // Este camino no escribía NADA en la bitácora: la pista de auditoría
    // enseñaba solo los cobros que anota la oficina a mano.
    expect(str_contains($codigo, 'AuditAction::PaymentRecorded'))->toBeTrue(
        'Los cobros de la pasarela volvieron a entrar sin dejar una sola fila en la bitácora.'
    );

    expect(str_contains($codigo, 'actor:null'))->toBeTrue(
        'El cobro de la pasarela se atribuyó a una persona. No lo anotó nadie: lo mandó el proveedor.'
    );
});
