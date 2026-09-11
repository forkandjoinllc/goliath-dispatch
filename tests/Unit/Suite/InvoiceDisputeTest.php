<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * La disputa tiene que llegar a la factura, y tiene que saber irse.
 *
 * ## El defecto
 *
 * `PaymentLedger::dispute()` escribía la disputa en la fila de `payments` y ahí
 * se quedaba. La factura no se enteraba. Tres consecuencias, y la tercera es la
 * que tenía la guarda ya escrita:
 *
 * 1. La barredora nocturna la reclamaba como a un moroso corriente, cuando el
 *    dinero había llegado y quien lo retiró fue el banco.
 * 2. `PeriodReport::aging()` lleva desde el primer día con la cláusula
 *    `whereNull('i.disputed_at')`, y esa columna no la escribía NADIE: la
 *    cartera contaba como deuda corriente un dinero en litigio.
 * 3. `PaymentLedger::SIN_SALDO` incluía `'disputed'` precisamente para que un
 *    cobro posterior no pasara la factura a «pagada» con la disputa viva. Como
 *    `invoices.status` nunca llegaba a `'disputed'`, la guarda no podía
 *    dispararse nunca.
 *
 * La forma de siempre: el diagnóstico estaba escrito —en un comentario, en una
 * lista de estados y hasta en una cláusula de una consulta financiera— y no se
 * había aplicado donde hacía falta.
 *
 * ## Lo que vigila este fichero
 *
 * Que la disputa se DEDUZCA de los cobros en cada recálculo (no se recuerde por
 * su cuenta), que exista la salida, y que los dos sitios que dejaban de contar
 * una factura en disputa sigan sin contarla.
 */
function raizDisputa(): string
{
    return Source::root();
}

it('la disputa de la factura se deduce de sus cobros en cada recálculo', function (): void {
    // Deducirla es lo que hace que las dos direcciones funcionen sin que nadie
    // tenga que acordarse de la de bajada. Un estado guardado por su cuenta se
    // queda encendido cuando la disputa termina.
    $libro = Source::compacta(raizDisputa().'/app/Support/Finance/PaymentLedger.php');

    expect($libro)->toContain('privatestaticfunctiondisputaViva(');
    expect($libro)->toContain("->where('status','disputed')");

    // Y se llama desde `resync()`, que es el único sitio que escribe la
    // factura desde sus cobros.
    $resync = cuerpoDeDisputa($libro, 'publicstaticfunctionresync(', 'privatestaticfunctionstatusFor(');
    expect($resync)->toContain('self::disputaViva($tenantId,$invoiceId)');
});

it('resync escribe la marca de disputa en la factura, en las dos direcciones', function (): void {
    // `?->` y no un `if`: la misma expresión pone la marca cuando hay disputa y
    // la quita cuando no la hay. Con dos ramas, una de las dos se olvida.
    $libro = Source::compacta(raizDisputa().'/app/Support/Finance/PaymentLedger.php');
    $resync = cuerpoDeDisputa($libro, 'publicstaticfunctionresync(', 'privatestaticfunctionstatusFor(');

    expect($resync)->toContain("'disputed_at'=>\$disputa?->disputed_at");
    expect($resync)->toContain("'dispute_reason'=>\$disputa?->dispute_reason");
});

it('«disputed» ya no es un estado pegajoso de la factura', function (): void {
    // Estaba en SIN_SALDO, que es la lista de los estados que el dinero no
    // mueve. Un estado deducido no puede además ser pegajoso: se quedaría
    // encendido para siempre después de resolverse la disputa.
    $libro = Source::compacta(raizDisputa().'/app/Support/Finance/PaymentLedger.php');

    expect($libro)->toContain("SIN_SALDO=['voided','uncollectable','draft']");
    expect($libro)->toContain("VUELVEN_A_ENVIADA=['paid','disputed']");
});

it('anulada manda sobre en disputa, y no al revés', function (): void {
    // El orden dentro de statusFor ES la regla: una factura anulada no debe
    // nada, la esté reclamando el banco o no. Invertirlo haría que una disputa
    // resucitara el saldo de algo anulado.
    $libro = Source::compacta(raizDisputa().'/app/Support/Finance/PaymentLedger.php');
    $cuerpo = cuerpoDeDisputa($libro, 'privatestaticfunctionstatusFor(', 'privatestaticfunctiondisputaViva(');

    $sinSaldo = strpos($cuerpo, 'in_array($actual,self::SIN_SALDO,true)');
    $disputa = strpos($cuerpo, 'if($enDisputa)');

    expect($sinSaldo)->not->toBeFalse();
    expect($disputa)->not->toBeFalse();
    expect($sinSaldo)->toBeLessThan($disputa);

    // Y la disputa manda sobre el saldo: si no, un cobro posterior la pasaría
    // a «pagada» — el defecto exacto de este lote.
    expect($disputa)->toBeLessThan(strpos($cuerpo, 'if($saldo<=0)'));
});

it('la disputa tiene salida, y con sus dos desenlaces', function (): void {
    // Una disputa que no sabe terminar deja la factura fuera de la reclamación
    // y de la cartera para siempre. Abrir la puerta sin la salida es peor que
    // no abrirla.
    $libro = Source::compacta(raizDisputa().'/app/Support/Finance/PaymentLedger.php');

    expect($libro)->toContain('publicstaticfunctionresolveDispute(');
    expect($libro)->toContain("DISPUTA_GANADA='won'");
    expect($libro)->toContain("DISPUTA_PERDIDA='lost'");

    // Perdida deja el cobro FALLIDO: ni `refunded` —no lo devolvimos
    // nosotros— ni borrado —sí llegó—.
    $cierre = cuerpoDeDisputa($libro, 'publicstaticfunctionresolveDispute(', 'publicstaticfunctionresync(');
    expect($cierre)->toContain("?'succeeded':'failed'");

    // Y no decide el estado de la factura por su cuenta: lo recalcula quien
    // sabe si queda alguna otra disputa viva.
    expect($cierre)->toContain('self::resync(');
    expect($cierre)->not->toContain("DB::table('invoices')");
});

it('el desenlace se valida contra la lista, no contra el texto que llegue', function (): void {
    $control = Source::compacta(raizDisputa().'/app/Http/Controllers/App/PaymentController.php');

    expect($control)->toContain('Rule::in(PaymentLedger::DESENLACES)');
    // Y no se cierra lo que no está abierto.
    expect($control)->toContain("\$model->status->value!=='disputed'");
});

it('la barredora nocturna no reclama una factura en disputa', function (): void {
    // Perseguir al cliente por una factura cuyo cobro está reclamando el banco
    // es pedirle que pague dos veces.
    $barredora = Source::compacta(raizDisputa().'/app/Console/Commands/SweepNotifications.php');

    expect($barredora)->toContain("FUERA_DE_RECLAMACION=['draft','voided','paid','uncollectable','disputed']");
    expect($barredora)->toContain("->whereNotIn('status',self::FUERA_DE_RECLAMACION)");
});

it('la cartera sigue descontando las facturas en disputa', function (): void {
    // Esta cláusula llevaba desde el primer día escrita y sin poder
    // dispararse. Ahora sí se dispara, y quitarla volvería a inflar la cartera
    // con dinero en litigio.
    $informe = Source::compacta(raizDisputa().'/app/Support/Reports/PeriodReport.php');

    expect($informe)->toContain("whereNull('i.disputed_at')");
    expect($informe)->toContain("orWhere('i.disputed_at','>',\$corte)");

    // Y no cuenta el cobro en disputa como dinero recibido. Lo destapó un
    // sabotaje: quitar la cláusula de arriba no movía la cifra, porque la
    // factura entraba igual en la cartera pero con saldo cero. Dos mecanismos
    // que se tapan el uno al otro dan el número bueno por accidente.
    expect($informe)->toContain("NUNCA_FUE_DINERO=['pending','failed','cancelled','disputed']");
});

it('la ficha de factura enseña el motivo de la disputa, no solo la etiqueta', function (): void {
    // «En disputa» a secas obliga a ir a buscar a qué cobro y por qué.
    $control = Source::compacta(raizDisputa().'/app/Http/Controllers/App/InvoiceController.php');
    expect($control)->toContain("'disputeReason'=>\$model->dispute_reason");

    $pantalla = (string) file_get_contents(raizDisputa().'/resources/js/pages/App/Invoices/Show.tsx');
    expect($pantalla)->toContain("invoice.status === 'disputed'");
    expect($pantalla)->toContain("t('invoices.show.disputed')");

    // En los dos idiomas: un detector escrito solo en uno deja pasar el otro.
    foreach (['es', 'en'] as $idioma) {
        $dic = json_decode(
            (string) file_get_contents(raizDisputa()."/lang/{$idioma}/invoices.json"),
            true,
        );

        expect($dic['show']['disputed'] ?? null)->toBeString();
        expect($dic['show']['disputedHint'] ?? null)->toBeString();
    }
});

it('la pantalla de cobros ofrece cerrar la disputa', function (): void {
    // El botón no puede vivir en la barra de acciones: un cobro en disputa
    // cuenta como «cerrado» y esa barra no se pinta para los cerrados. Si
    // alguien lo mueve ahí, deja de verse y la salida desaparece.
    $pantalla = (string) file_get_contents(raizDisputa().'/resources/js/pages/App/Payments/Index.tsx');

    expect($pantalla)->toContain('canRefund && enDisputa');
    expect($pantalla)->toContain('/dispute/resolve');

    foreach (['es', 'en'] as $idioma) {
        $dic = json_decode(
            (string) file_get_contents(raizDisputa()."/lang/{$idioma}/payments.json"),
            true,
        );

        foreach (['resolveDispute', 'outcomeWon', 'outcomeLost', 'confirmResolve'] as $clave) {
            expect($dic['index'][$clave] ?? null)->toBeString();
        }
    }
});

/**
 * El cuerpo de un método, con sus DOS fronteras.
 *
 * Cortar desde el nombre hasta el final del fichero se traga los métodos de
 * abajo, y una aguja que vive tres métodos más allá hace pasar la prueba. Ver
 * `docs/testing.md`.
 */
function cuerpoDeDisputa(string $fuente, string $desde, string $hasta): string
{
    $i = strpos($fuente, $desde);
    $f = strpos($fuente, $hasta);

    expect($i)->not->toBeFalse();
    expect($f)->not->toBeFalse();
    expect($i)->toBeLessThan($f);

    return substr($fuente, $i, $f - $i);
}
