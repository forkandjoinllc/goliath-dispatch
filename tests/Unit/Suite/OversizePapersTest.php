<?php

declare(strict_types=1);

use App\Support\Oversize\Papers;

/**
 * «Los papeles están todos» tiene que querer decir eso.
 *
 * ## El defecto
 *
 * Una carga sobredimensionada no se despacha hasta que alguien con
 * `permit:approve_ready` declara que los papeles están completos. Esa puerta
 * existe y funciona desde el lote 55.
 *
 * Lo que no existía era el papel. `permits.document_id`,
 * `permits.route_survey_document_id` y `escorts.document_id` estaban en el
 * esquema desde el primer día y no las escribía nadie, y los tres rótulos
 * —«Documento del permiso», «Documento del estudio de ruta», «Documento de la
 * escolta»— llevaban escritos en el diccionario VIVO sin que ninguna pantalla
 * los pidiera.
 *
 * O sea que la oficina marcaba el permiso como emitido, declaraba los papeles
 * completos, y el conductor salía sin ninguno. Un permiso de sobredimensión es
 * exactamente el papel que le piden en una báscula.
 *
 * Y `expires_at` se guardaba desde el principio sin que lo mirara nadie: un
 * permiso válido hasta el jueves en una carga que entrega el sábado no es un
 * permiso, es un permiso vencido esperando a que lo paren.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código, como en los demás
 * guardianes de esta carpeta.
 */
function raizPapeles(): string
{
    return dirname(__DIR__, 3);
}

function codigoDePapelesSinComentarios(string $ruta): string
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

it('la puerta de los papeles los comprueba de verdad', function (): void {
    $codigo = codigoDePapelesSinComentarios(raizPapeles().'/app/Http/Controllers/App/PermitController.php');

    expect(str_contains($codigo, 'Papers::faltan('))->toBeTrue(
        'La puerta volvió a dar los papeles por completos sin mirarlos. «Los papeles están todos» vuelve a '
        .'querer decir «ningún permiso está pendiente», y el conductor sale sin el papel que le piden en una '
        .'báscula.'
    );

    // Y la comprobación tiene que ir ANTES de escribir la aprobación.
    $posFaltan = strpos($codigo, 'Papers::faltan(');
    $posAprueba = strpos($codigo, "'permit_ready_approved_at' => CarbonImmutable::now()");

    expect($posFaltan)->toBeLessThan(
        (int) $posAprueba,
        'La comprobación de los papeles quedó DESPUÉS de aprobar. Aprobar y luego mirar no es una puerta.'
    );
});

it('un permiso emitido sin papel es una falta', function (): void {
    $codigo = codigoDePapelesSinComentarios(raizPapeles().'/app/Support/Oversize/Papers.php');

    expect(str_contains($codigo, "'reason' => 'permitWithoutDocument'"))->toBeTrue(
        'Se dejó de exigir el documento de un permiso emitido, que es el defecto entero de este lote.'
    );

    // Solo los EMITIDOS. Los pendientes ya los cuenta la comprobación de
    // siempre, y exigirles papel diría que falta el papel de algo que ni
    // siquiera se ha pedido.
    expect(str_contains($codigo, 'self::EMITIDO'))->toBeTrue();
});

it('el vencimiento se mira contra la entrega', function (): void {
    $codigo = codigoDePapelesSinComentarios(raizPapeles().'/app/Support/Oversize/Papers.php');

    expect(str_contains($codigo, "'reason' => 'permitExpiresBeforeDelivery'"))->toBeTrue(
        '`expires_at` volvió a guardarse sin que lo mire nadie. Un permiso que caduca antes de entregar es un '
        .'permiso vencido esperando a que lo paren.'
    );

    expect(str_contains($codigo, 'isBefore($entregaPlanificada)'))->toBeTrue(
        'El vencimiento dejó de compararse con la entrega planificada.'
    );
});

it('la ranura del papel es una lista cerrada', function (): void {
    // La ranura llega del NAVEGADOR y decide qué tabla y qué columna se
    // escriben. Sin lista cerrada, el cliente elige la columna de un `update()`.
    expect(array_keys(Papers::RANURAS))->toBe(['permit', 'route_survey', 'escort']);

    foreach (Papers::RANURAS as $ranura => $config) {
        expect($config)->toHaveKeys(['tabla', 'columna', 'tipo'])
            ->and($config['tabla'])->toBeIn(['permits', 'escorts']);
    }

    expect(Papers::conoce('permit'))->toBeTrue()
        ->and(Papers::conoce('../../loads'))->toBeFalse()
        ->and(Papers::conoce('status'))->toBeFalse();
});

it('la escritura del documento está en un solo sitio', function (): void {
    // Tercera vez que hacía falta: cargas, recibos y ahora papeles. La regla de
    // la casa dice que antes de copiar una escritura por tercera vez hay que
    // comparar las dos que existen.
    foreach (['LoadFile', 'ExpenseFile'] as $clase) {
        $codigo = codigoDePapelesSinComentarios(raizPapeles()."/app/Support/Documents/{$clase}.php");

        expect(str_contains($codigo, 'Attachment::store'))->toBeTrue(
            "{$clase} volvió a escribir el documento por su cuenta. Son ya tres copias de la misma escritura."
        );

        expect(str_contains($codigo, "DB::table('document_versions')->insert"))->toBeFalse(
            "{$clase} volvió a insertar la versión del documento a mano."
        );
    }

    $papeles = codigoDePapelesSinComentarios(raizPapeles().'/app/Support/Oversize/Papers.php');
    expect(str_contains($papeles, 'Attachment::store'))->toBeTrue();
});
