<?php

declare(strict_types=1);

/**
 * Ningún estado que el cobro escriba puede quedar fuera del CHECK del esquema.
 *
 * Es el tercer guardián de esta forma, y existe porque el fallo se repite: el
 * lote 50 escribía `proof_of_delivery` donde el CHECK decía `pod`, y el lote 52
 * escribía `completed` donde decía `succeeded` — en el lote que citaba al 50.
 * Conocer la trampa no basta para no pisarla.
 *
 * Aquí duele especialmente: `Subscriptions` escribe en DOS tablas con CHECK
 * distintos —`tenant_subscriptions.status` y `tenants.status`— y un literal que
 * no cuadre no da error de tipos. Da una fila que no entra, dentro de una
 * petición del proveedor de pagos, que reintentará para siempre mientras un
 * cliente que ya pagó sigue sin acceso.
 *
 * `tests/Unit` no arranca la aplicación: la raíz sube tres niveles.
 */
function raizBilling(): string
{
    return dirname(__DIR__, 3);
}

/**
 * Los valores de un CHECK de columna, leídos del DDL.
 *
 * @return list<string>
 */
function valoresDelCheck(string $constraint, string $columna): array
{
    $ddl = (string) file_get_contents(raizBilling().'/database/schema/01_tenancy_auth_tables.sql');

    $encontrado = preg_match(
        '/constraint\s+`?'.preg_quote($constraint, '/').'`?\s+check\s*\(\s*`?'.preg_quote($columna, '/').'`?\s+in\s*\((.+?)\)\s*\)/is',
        $ddl,
        $m,
    );

    expect($encontrado)->toBe(1, "No se encontró el CHECK {$constraint}.");

    preg_match_all("/'([^']+)'/", $m[1], $valores);

    return array_values(array_unique($valores[1]));
}

it('los estados de suscripción que escribe el cobro existen en el CHECK', function () {
    $admitidos = valoresDelCheck('tenant_subscriptions_status_chk', 'status');

    $codigo = (string) file_get_contents(raizBilling().'/app/Support/Billing/Subscriptions.php');

    // Solo las asignaciones a la columna, no cualquier cadena del fichero: una
    // expresión más laxa recogería los comentarios —que nombran los seis
    // estados— y no probaría nada.
    preg_match_all("/'status'\s*=>\s*'([\w]+)'/", $codigo, $escritos);

    $intrusos = array_values(array_diff(array_unique($escritos[1]), $admitidos));

    expect($intrusos)->toBe([], 'Estados que ningún CHECK admite: '.implode(', ', $intrusos));
    expect($escritos[1])->not->toBeEmpty('La expresión ya no encuentra nada: el guardián dejó de guardar.');
});

it('los estados de empresa que escribe el cobro existen en el CHECK', function () {
    $admitidos = valoresDelCheck('tenants_status_chk', 'status');

    $codigo = (string) file_get_contents(raizBilling().'/app/Support/Billing/Subscriptions.php');

    // `syncTenantStatus()` se llama con el estado como literal.
    preg_match_all("/syncTenantStatus\([^,]+,\s*'([\w]+)'\)/", $codigo, $escritos);

    expect($escritos[1])->not->toBeEmpty('La expresión ya no encuentra nada: el guardián dejó de guardar.');

    $intrusos = array_values(array_diff(array_unique($escritos[1]), $admitidos));

    expect($intrusos)->toBe([], 'Estados de empresa que el CHECK no admite: '.implode(', ', $intrusos));
});

it('el vocabulario propio de sucesos no se mezcla con el del proveedor', function () {
    // `BillingEvent::TYPES` es deliberadamente NUESTRO: los nombres de Stripe
    // cambian con su versión de API, y atarlos a `match` repartidos por la
    // aplicación es firmar que cada cambio de versión sea una cacería. Esta
    // prueba fija que el ciclo de la suscripción solo conoce el vocabulario
    // propio.
    $codigo = (string) file_get_contents(raizBilling().'/app/Support/Billing/Subscriptions.php');

    foreach (['checkout.session.completed', 'invoice.paid', 'invoice.payment_failed', 'customer.subscription'] as $deStripe) {
        expect($codigo)->not->toContain($deStripe, "Subscriptions conoce un nombre de Stripe: {$deStripe}");
    }
});
