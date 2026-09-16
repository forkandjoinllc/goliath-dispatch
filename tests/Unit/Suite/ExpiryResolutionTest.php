<?php

declare(strict_types=1);

use Tests\Support\Source;

use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertStringNotContainsString;

/**
 * Un aviso materializado se cierra cuando deja de ser verdad.
 *
 * ## El defecto
 *
 * Cerrar los avisos de `document_expirations` estaba repartido en dos sitios y
 * ninguno de los dos veía lo mismo:
 *
 *  - `Expirations::resolveOrphans()` cerraba los documentos borrados o sin
 *    caducidad.
 *  - El barrido cerraba, al materializar, los de fecha ANTERIOR:
 *    `whereDate('expiration_date', '<', $vence)`.
 *
 * Entre las dos quedaron dos agujeros que suman al mismo contador de Salud de
 * plataforma: la TRANSICIÓN de «por vencer» a «vencido», donde la fecha es la
 * misma y solo cambia el tipo —el mismo documento contaba en los dos cubos—, y
 * la RENOVACIÓN, que saca al documento de la consulta del barrido y deja sus
 * filas colgadas para siempre.
 *
 * ## Lo que vigila
 *
 * Que la regla sea UNA y esté en un sitio, que corra DESPUÉS de materializar
 * —antes cerraría la fila que se acaba de escribir— y que la consulta compare
 * las tres cosas que hacen falta: la fecha, el plazo y el tipo.
 */
function raizVencimientos(): string
{
    return Source::root();
}

it('cerrar los avisos vive en un solo sitio', function (): void {
    $barrido = Source::compacta(raizVencimientos().'/app/Console/Commands/SweepNotifications.php');

    // La consulta que se quedaba corta ya no está en el barrido.
    assertStringNotContainsString("whereDate('expiration_date','<',\$vence)", $barrido);

    // Y `materializar()` solo inserta.
    assertStringContainsString("DB::table('document_expirations')->insertOrIgnore([", $barrido);
    assertStringContainsString('Expirations::resolveStale($tenantId,TenantPolicy::for($tenantId)->documentWarningDays)', $barrido);
});

it('se cierra DESPUÉS de materializar, no antes', function (): void {
    $barrido = Source::compacta(raizVencimientos().'/app/Console/Commands/SweepNotifications.php');

    $materializa = strpos($barrido, "\$totales['documents']+=\$this->documentosQueCaducan(");
    $cierra = strpos($barrido, 'Expirations::resolveStale(');

    expect($materializa)->not->toBeFalse();
    expect($cierra)->not->toBeFalse();

    // Antes cerraría la fila que el barrido acaba de escribir: el aviso
    // aparecería y desaparecería en la misma pasada.
    expect($cierra)->toBeGreaterThan($materializa, 'los avisos se cierran antes de escribirlos');
});

it('la regla compara la fecha, el plazo y el tipo', function (): void {
    $fuente = Source::sinComentarios(raizVencimientos().'/app/Support/Platform/Expirations.php');

    // La misma fecha: si el documento se renovó, la fila vieja habla de un
    // vencimiento que ya no existe.
    assertStringContainsString(
        'date(documents.expiration_date) = date(document_expirations.expiration_date)',
        $fuente,
    );

    // Dentro del plazo: un papel que caduca dentro de un año no tiene aviso
    // vivo, aunque su fila siga ahí.
    assertStringContainsString('date(documents.expiration_date) <= ?', $fuente);

    // Y el mismo tipo, que es lo que cierra la transición.
    assertStringContainsString(
        "document_expirations.kind = case when date(documents.expiration_date) < ? then 'expired' else 'warning' end",
        $fuente,
    );

    // Se sigue exigiendo que el documento exista y tenga caducidad: los
    // huérfanos eran un caso particular de la misma regla, no otra.
    assertStringContainsString('whereNull(\'documents.deleted_at\')', $fuente);
    assertStringContainsString('whereNotNull(\'documents.expiration_date\')', $fuente);
});

it('la función vieja ya no existe con su nombre', function (): void {
    $fuente = Source::compacta(raizVencimientos().'/app/Support/Platform/Expirations.php');

    // Dejarla al lado de la nueva sería tener dos reglas otra vez, y la vieja
    // es un subconjunto de la nueva.
    assertStringNotContainsString('functionresolveOrphans', $fuente);
    assertStringContainsString('functionresolveStale(string$tenantId,int$diasDeAviso)', $fuente);
});
