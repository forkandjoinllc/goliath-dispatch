<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * La cartera se lee a la fecha del periodo, no a la de hoy.
 *
 * ## El defecto
 *
 * El rótulo del informe, encima mismo de los contadores, dice:
 *
 * > Estas cifras salen del trabajo FACTURADO y de la instantánea congelada que
 * > usó cada factura — nunca de un recálculo. **Un periodo cerrado dice siempre
 * > lo mismo.**
 *
 * `billed()` filtra por el periodo. `invoices()` —de donde salen la antigüedad
 * del cobro y el contador «Pendiente de cobro»— no filtraba por nada: eran
 * todas las facturas abiertas de la historia, repartidas por tramos contra el
 * día de hoy.
 *
 * Medido: el informe de enero decía 0 de pendiente; se emitió una factura con
 * fecha de septiembre y el informe de ENERO pasó a decir 250.000.
 *
 * Y sin emitir nada, la misma factura de enero iba saltando de tramo cada mes,
 * porque los días se contaban contra hoy.
 */
function raizCartera(): string
{
    return Source::root();
}

it('la cartera no se lee del saldo de hoy', function (): void {
    // `invoices.balance_cents` es el saldo de HOY: usarlo para una foto de
    // enero dice que en enero no se debía lo que se cobró en junio.
    $fuente = Source::compacta(raizCartera().'/app/Support/Reports/PeriodReport.php');

    $cartera = substr($fuente, strpos($fuente, 'publicfunctionaging()'));

    test()->assertStringNotContainsString(
        "where('i.balance_cents'",
        $cartera,
        'La antigüedad del cobro tiene que reconstruir el saldo, no leer la caché de hoy.',
    );

    test()->assertStringContainsString('$this->paidAsOf(', $cartera);
});

it('el saldo se reconstruye de las filas de cobros', function (): void {
    // Es la regla de la casa de PaymentLedger —«la columna es una CACHÉ de la
    // suma, no la verdad; la verdad son las filas»— llevada a una fecha.
    $fuente = Source::compacta(raizCartera().'/app/Support/Reports/PeriodReport.php');

    test()->assertStringContainsString("DB::table('payments')", $fuente);

    // Los dos momentos, cada uno con su fecha: un cobro que entró en enero y se
    // devolvió en marzo estaba en casa en enero.
    test()->assertStringContainsString("where('received_at','<=',\$corte)", $fuente);
    test()->assertStringContainsString('refunded_at<=?', $fuente);
});

it('las tres fechas de la factura se respetan', function (): void {
    // Anular en marzo no borra que en enero se debía. Las tres llevan columna
    // con fecha, así que no hay excusa para mirar solo el estado de hoy.
    $fuente = Source::compacta(raizCartera().'/app/Support/Reports/PeriodReport.php');

    foreach (['voided_at', 'disputed_at', 'uncollectable_at'] as $columna) {
        test()->assertStringContainsString(
            "orWhere('i.{$columna}','>',\$corte)",
            $fuente,
            "Una factura marcada con {$columna} DESPUÉS de la fecha sí se debía a esa fecha.",
        );
    }

    // Y no se cuenta la que aún no se había emitido.
    test()->assertStringContainsString("whereDate('i.issue_date','<=',", $fuente);
});

it('los tramos se cuentan contra la fecha del periodo', function (): void {
    // Contra hoy, la misma factura de enero cambia de tramo cada mes y el
    // informe de enero es distinto en cada visita.
    $fuente = Source::compacta(raizCartera().'/app/Support/Reports/PeriodReport.php');

    $cartera = substr($fuente, strpos($fuente, 'publicfunctionaging()'));

    test()->assertStringNotContainsString(
        'diffInDays($hoy,false)',
        $cartera,
        'Los días vencidos se cuentan contra la fecha de la foto, no contra hoy.',
    );

    test()->assertStringContainsString('diffInDays($fecha->startOfDay(),false)', $cartera);
});

it('la foto no se va al futuro', function (): void {
    // Una cartera no puede decir lo que se deberá el mes que viene.
    $fuente = Source::compacta(raizCartera().'/app/Support/Reports/PeriodReport.php');

    test()->assertStringContainsString('$this->to->lessThan($hoy)?$this->to:$hoy', $fuente);
});

it('la pantalla dice a qué fecha está la foto', function (): void {
    // Un tramo de antigüedad sin fecha obliga a suponerla, y la suposición
    // natural —hoy— es falsa en cuanto alguien pide un mes cerrado.
    $controlador = Source::compacta(raizCartera().'/app/Http/Controllers/App/ReportController.php');
    test()->assertStringContainsString("'agingAsOf'=>\$informe->agingAsOf()", $controlador);

    // En los DOS sitios. Comprobar que la clave aparece «en alguna parte» del
    // fichero dejaba pasar quitarla del título de la sección, porque seguía
    // estando en el contador: un sabotaje que la quitó del título salió verde.
    $pantalla = Source::sinComentarios(raizCartera().'/resources/js/pages/App/Reports/Index.tsx');

    expect(substr_count($pantalla, "t('reports.aging.asOf'"))->toBe(
        2,
        'La fecha va en el contador «Pendiente de cobro» y en el título de la antigüedad.',
    );

    test()->assertStringContainsString(
        "reports.aging.title')} · \${t('reports.aging.asOf'",
        $pantalla,
        'El título de la antigüedad lleva su fecha al lado.',
    );

    foreach (['es', 'en'] as $idioma) {
        $d = json_decode((string) file_get_contents(raizCartera()."/lang/{$idioma}/reports.json"), true);

        expect($d['aging']['asOf'] ?? null)->toBeString("Falta reports.aging.asOf en {$idioma}.");
        test()->assertStringContainsString('{date}', (string) $d['aging']['asOf']);
    }
});

it('la cartera se calcula una sola vez por petición', function (): void {
    // Reconstruir saldos lee las filas de cobros. Llamarlo desde `summary()` y
    // otra vez al pintar lo hacía dos veces, y ahora cuesta el doble.
    $fuente = Source::compacta(raizCartera().'/app/Http/Controllers/App/ReportController.php');

    expect(substr_count($fuente, '$informe->aging()'))->toBe(1);
});
