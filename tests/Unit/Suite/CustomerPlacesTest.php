<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * Que los sitios del cliente se puedan escribir, que una parada no pueda
 * apuntar al sitio de otro, y que un sitio usado no desaparezca.
 *
 * ## El defecto
 *
 * `customer_locations` —las instalaciones del cliente— se LEÍA en ocho sitios:
 * la ficha del cliente, la confirmación de tarifa que firma el transportista,
 * los documentos de la carga, los permisos, el panel de rastreo (dos veces) y
 * la página pública que abre el cliente. No la escribía nadie: ni una ruta, ni
 * un formulario, ni un método. Solo el sembrador del demo.
 *
 * Y la otra punta estaba igual de rota: `load_stops.customer_location_id` se
 * validaba y se guardaba en el servidor, y el formulario de carga no lo mandaba
 * nunca porque no existía el campo. O sea que en una instalación de verdad no
 * había ni un sitio, cada parada llevaba la dirección tecleada otra vez, y el
 * nombre de la instalación que sale en un papel FIRMADO era lo que alguien
 * hubiera escrito ese día.
 *
 * ## Y una frontera que no estaba
 *
 * `customer_location_id` se validaba como «una cadena de 36 caracteres». Nada
 * comprobaba que el sitio fuera de ese cliente ni de esa empresa. Los ocho
 * lectores hacen `leftJoin`, así que el identificador de una instalación ajena
 * habría enseñado su nombre y su dirección en el papel del transportista y en
 * la página pública. Es exactamente lo que la regla de la casa prohíbe: no
 * fiarse del cliente para decidir a qué fila apunta una clave foránea.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código, como en los demás
 * guardianes de esta carpeta.
 */
function raizSitios(): string
{
    return dirname(__DIR__, 3);
}

function codigoDeSitiosSinComentarios(string $ruta): string
{
    // El cuerpo vivía copiado en quince ficheros. Ver Tests\Support\Source:
    // no quitaba los espacios, y por eso varias agujas de esta carpeta no
    // podían casar con nada.
    return Source::sinComentarios($ruta);
}

it('los sitios del cliente se pueden escribir', function (): void {
    $codigo = codigoDeSitiosSinComentarios(raizSitios().'/app/Http/Controllers/App/CustomerController.php');

    expect(str_contains($codigo, "DB::table('customer_locations')->insert"))->toBeTrue(
        'Ya no hay forma de dar de alta un sitio del cliente. Vuelve a haber ocho pantallas leyendo una tabla '
        .'que nadie escribe, y cada parada con la dirección tecleada otra vez.'
    );

    expect(str_contains($codigo, 'syncLocations'))->toBeTrue();
});

it('una parada no puede apuntar al sitio de otro cliente', function (): void {
    $codigo = codigoDeSitiosSinComentarios(raizSitios().'/app/Http/Controllers/App/LoadController.php');

    // La comprobación tiene que mirar las DOS cosas. Solo la empresa dejaría
    // que una carga de un cliente enseñara la planta de otro; solo el cliente
    // no es suficiente porque el identificador viene del navegador.
    expect(str_contains($codigo, "->where('tenant_id', \$actor->tenantId)"))->toBeTrue();

    preg_match(
        '/customer_location_id.*?locationNotOfCustomer/s',
        $codigo,
        $m,
    );

    expect($m)->not->toBeEmpty(
        'La validación de `customer_location_id` dejó de comprobar de quién es el sitio. Con solo la longitud, '
        .'el navegador puede apuntar una parada a la instalación de otro cliente o de otra empresa, y ocho '
        .'lectores la enseñarían — incluido el papel que firma el transportista.'
    );

    expect(str_contains($m[0], 'customer_id'))->toBeTrue(
        'La comprobación del sitio ya no mira el cliente de la carga.'
    );
});

it('borrar un sitio es en suave', function (): void {
    $codigo = codigoDeSitiosSinComentarios(raizSitios().'/app/Http/Controllers/App/CustomerController.php');

    // Un borrado duro dejaría la parada de una carga entregada hace un año sin
    // el nombre de la instalación donde se entregó, y ese nombre está en un
    // papel firmado. Ocho lectores hacen `leftJoin` con esta tabla.
    preg_match('/private function syncLocations.*?\n    }/s', $codigo, $m);

    expect($m)->not->toBeEmpty();

    expect(str_contains($m[0], "'deleted_at' => \$ahora"))->toBeTrue(
        'Los sitios que se quitan del formulario dejaron de borrarse en suave.'
    );

    expect(str_contains($m[0], '->delete()'))->toBeFalse(
        'Aparecio un borrado duro de sitios. Una carga entregada tiene que poder seguir diciendo dónde se '
        .'entregó.'
    );
});

it('el aviso va antes al del sitio de destino', function (): void {
    $codigo = codigoDeSitiosSinComentarios(raizSitios().'/app/Support/Tracking/CustomerLink.php');

    // Un cliente con cuatro plantas tiene a alguien en cada una. Sin esto, el
    // aviso de que un camión va a Odessa se le manda siempre a quien lleva el
    // tráfico de toda la empresa desde otra ciudad.
    expect(str_contains($codigo, 'contactosDelDestino'))->toBeTrue(
        'El enlace de rastreo dejó de preferir a quien lleva el sitio donde se entrega.'
    );

    expect(str_contains($codigo, "where('stop_type', 'delivery')"))->toBeTrue(
        'Se mira la parada equivocada: el enlace es para quien ESPERA la carga, o sea la entrega.'
    );
});

it('el formulario de carga manda el sitio elegido', function (): void {
    $tsx = (string) file_get_contents(raizSitios().'/resources/js/pages/App/Loads/Form.tsx');

    // El servidor lo validaba y lo guardaba desde el principio; el que no lo
    // mandaba nunca era el formulario. Es la mitad del defecto que más cuesta
    // ver, porque el código del servidor parece completo.
    // La ASIGNACIÓN, no la simple aparición del nombre. La primera versión de
    // esta prueba buscaba `customer_location_id` a secas y pasaba con el
    // defecto puesto: el nombre sigue estando en la interfaz del borrador y en
    // los `disabled`, así que el grep encontraba algo aunque nadie rellenara el
    // campo. Lo descubrió el sabotaje. Es la misma lección del lote 64: una
    // aserción que pasa por el motivo equivocado no prueba nada.
    expect(str_contains($tsx, 'customer_location_id: sitio.id'))->toBeTrue(
        'El formulario de carga volvió a no rellenar el sitio del cliente al elegirlo. El servidor lo guarda y '
        .'ocho pantallas lo leen: sin esa línea, todas leen null para siempre.'
    );

    expect(str_contains($tsx, "customer_location_id: ''"))->toBeTrue(
        'El borrador de parada dejó de llevar el campo, así que no viaja en el envío.'
    );
});
