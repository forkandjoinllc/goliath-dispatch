<?php

declare(strict_types=1);

use App\Enums\CustomerContactPosition;

/**
 * Que al cliente se le escriba en SU idioma, y que se sepa cuando no se le
 * escribe.
 *
 * ## Los dos defectos
 *
 * **`customer_contacts` se leía y no la escribía nadie.** La ficha del cliente
 * enseñaba una sección de contactos que solo podía estar vacía, y
 * `CustomerLink` —que elige a quién mandarle el enlace de rastreo— buscaba un
 * contacto, no encontraba ninguno nunca, y se caía al correo general del
 * cliente: que suele ser el de facturación, la dirección menos indicada para
 * avisar de que una carga va de camino.
 *
 * **El idioma era de la empresa.** Ni `customers` ni `customer_contacts` tenían
 * columna, así que se usaba `tenants.default_locale`: una casa que trabaja en
 * inglés les escribía en inglés a sus clientes hispanohablantes. Los
 * transportistas y los conductores sí lo tenían. El propio
 * `docs/tracking-link.md` lo llevaba apuntado como pendiente.
 *
 * ## Y el tercero, que es de otra clase
 *
 * Cuando el correo no salía, no pasaba nada: `sent_at` en nulo, una línea en el
 * registro que no lee nadie, y el cliente esperando un aviso que el sitio
 * público le había prometido. Un fallo silencioso en una promesa pública es
 * peor que un fallo ruidoso en cualquier otro sitio.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código, como en los demás
 * guardianes de esta carpeta.
 */
function raizVoz(): string
{
    return dirname(__DIR__, 3);
}

function codigoDeVozSinComentarios(string $ruta): string
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

it('el enlace se manda en el idioma del contacto, no en el de la empresa', function (): void {
    $codigo = codigoDeVozSinComentarios(raizVoz().'/app/Support/Tracking/CustomerLink.php');

    // El destinatario tiene que salir con SU idioma. Si `destinatario()` vuelve
    // a devolver el de la empresa, media aplicación bilingüe deja de serlo justo
    // en el único correo que llega a un cliente final.
    expect(str_contains($codigo, "'locale' => self::idiomaValido(\$elegido->preferred_locale)"))->toBeTrue(
        'El enlace de rastreo volvió a mandarse en el idioma de la empresa. El contacto tiene el suyo desde el '
        .'lote 64: una casa que trabaja en inglés no decide que su cliente lee inglés.'
    );

    // Y el respaldo, cuando no hay contacto, es el del CLIENTE — que es el
    // espejo de su contacto principal— y tampoco el de la empresa.
    expect(str_contains($codigo, "self::idiomaValido(\$cliente->preferred_locale)"))->toBeTrue(
        'El respaldo sin contactos dejó de usar el idioma del cliente.'
    );
});

it('contabilidad no recibe el aviso de que el camión salió', function (): void {
    // La lista de preferencia es la decisión: el enlace va a quien ESPERA la
    // carga. Meter `billing` aquí manda el aviso de tránsito a cuentas por
    // pagar, que es cómo se consigue que no lo lea nadie — y es además el
    // comportamiento que había antes de este lote, por accidente.
    $codigo = codigoDeVozSinComentarios(raizVoz().'/app/Support/Tracking/CustomerLink.php');

    preg_match('/PREFERENCIA\s*=\s*\[(.*?)\]/s', $codigo, $m);

    expect($m)->not->toBeEmpty('No se encontró la lista de preferencia en CustomerLink.');

    // `str_contains` y no `toContain`: `toContain` es VARIÁDICO, así que un
    // mensaje de fallo pasado como segundo argumento se toma por otra aguja que
    // buscar. Negado, «no contiene A y B» es cierto en cuanto falte B — que es
    // el mensaje— y la aserción pasa siempre. Lo descubrió el sabotaje: la
    // prueba seguía en verde con `billing` el primero de la lista.
    expect(str_contains($m[1], 'billing'))->toBeFalse(
        'El enlace de rastreo volvió a preferir al contacto de facturación. La factura es suya; el aviso de '
        .'que un camión va de camino es de quien lo espera.'
    );

    expect(str_contains($m[1], 'traffic'))->toBeTrue();

    // Y los cargos de la lista tienen que existir de verdad. Un valor con una
    // errata no rompe nada: simplemente no coincide nunca y la preferencia se
    // vuelve inerte sin decirlo.
    foreach (['traffic', 'dock', 'purchasing'] as $cargo) {
        expect(CustomerContactPosition::values())->toContain($cargo);
    }
});

it('el resultado del envío no se tira', function (): void {
    $codigo = codigoDeVozSinComentarios(raizVoz().'/app/Http/Controllers/App/LoadController.php');

    // Antes esto era `CustomerLink::sendForLoad(...);` a secas: si el correo
    // fallaba, quien despachaba se iba tan contento y el cliente se quedaba sin
    // el aviso que el sitio público le promete.
    expect(str_contains($codigo, '$enlace = CustomerLink::sendForLoad'))->toBeTrue(
        'Despachar volvió a tirar el resultado del envío del enlace. Quien despacha está delante y es quien '
        .'puede arreglarlo.'
    );

    expect(str_contains($codigo, "'noRecipient'") && str_contains($codigo, "'failed'"))->toBeTrue(
        'La pantalla dejó de distinguir «este cliente no tiene correo» de «el correo no salió». Se arreglan de '
        .'formas distintas.'
    );
});

it('el barrido diario busca las cargas cuyo enlace no salió', function (): void {
    $codigo = codigoDeVozSinComentarios(raizVoz().'/app/Console/Commands/SweepNotifications.php');

    // La red de abajo. El aviso al despachar lo ve quien está delante, y quien
    // está delante puede estar despachando cinco cargas seguidas a las seis de
    // la mañana.
    expect(str_contains($codigo, 'tracking.link_not_sent'))->toBeTrue(
        'El barrido dejó de buscar las cargas despachadas sin enlace mandado. Sin él, un fallo de correo vuelve '
        .'a no enterarse nadie.'
    );

    expect(str_contains($codigo, 'enlacesQueNoSalieron'))->toBeTrue();
});

it('los contactos del cliente se pueden escribir', function (): void {
    $codigo = codigoDeVozSinComentarios(raizVoz().'/app/Http/Controllers/App/CustomerController.php');

    // El defecto original: la tabla se leía en dos sitios y no la escribía
    // nadie. Es la misma clase que `load_stops.actual_arrival_at` del lote 63,
    // y conviene que no vuelva.
    expect(str_contains($codigo, "DB::table('customer_contacts')->insert"))->toBeTrue(
        'Ya no hay forma de dar de alta un contacto de cliente. La ficha vuelve a enseñar una lista que solo '
        .'puede estar vacía, y el enlace de rastreo vuelve a acabar en el correo de facturación.'
    );
});
