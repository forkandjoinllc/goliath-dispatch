<?php

declare(strict_types=1);

use App\Services\Billing\BillingEvent;
use Tests\Support\Source;

/**
 * Una columna que una pantalla lee y nadie escribe.
 *
 * ## El defecto
 *
 * `/facturación` tiene esta línea, y Ajustes la suya:
 *
 * > Se dará de baja al acabar el periodo.
 *
 * Sale de `tenant_subscriptions.cancel_at_period_end`. Esa columna aparecía
 * cuatro veces en toda la aplicación: el modelo, y TRES lecturas —las dos
 * pantallas y su `select`—. **Nadie la escribía nunca.** El aviso era
 * inalcanzable.
 *
 * Y la razón de que nadie la escribiera estaba un piso más abajo: el
 * vocabulario de sucesos no tenía forma de contar «baja programada».
 * `Subscriptions::apply()` conocía tres tipos, y el mapeo de Stripe mandaba
 * `customer.subscription.updated` —el suceso que salta cuando el cliente
 * programa la baja desde el portal— al cajón de ignorados. Así que un cliente
 * que cancelaba en el portal del proveedor, que es lo que la propia pantalla le
 * invita a hacer, dejaba la aplicación diciendo «Al día» sin fecha de fin.
 *
 * ## Lo que vigila este fichero
 *
 * Que toda columna de la suscripción que una pantalla lee tenga a alguien que
 * la escriba. Es la forma general del defecto: una columna leída y nunca
 * escrita no rompe nada, no falla ninguna prueba y enseña su valor por omisión
 * como si fuera un dato.
 */
function raizSuscripcion(): string
{
    return Source::root();
}

/**
 * Las columnas de `tenant_subscriptions` que una pantalla lee.
 *
 * Se sacan del `select` de cada pantalla —con el alias `s.`— y no de una lista
 * escrita aquí: una lista a mano no se entera de la columna que alguien añada
 * mañana, que es exactamente el caso que hay que cazar.
 *
 * @return array<string, list<string>> columna => pantallas que la leen
 */
function columnasQueLeeLaSuscripcion(): array
{
    $pantallas = [
        'BillingController' => raizSuscripcion().'/app/Http/Controllers/App/BillingController.php',
        'TenantSettingController' => raizSuscripcion().'/app/Http/Controllers/App/TenantSettingController.php',
    ];

    $leidas = [];

    foreach ($pantallas as $nombre => $fichero) {
        $fuente = Source::sinComentarios($fichero);

        // Solo dentro del `first([...])`/`get([...])` que consulta la tabla:
        // `s.` es el alias que las dos usan para `tenant_subscriptions`.
        preg_match_all("/'s\.([a-z_]+)'/", $fuente, $coincidencias);

        foreach ($coincidencias[1] as $columna) {
            $leidas[$columna][] = $nombre;
        }
    }

    expect($leidas)->not->toBe([], 'Ninguna pantalla lee ya la suscripción con el alias `s.`: revisa este ayudante.');

    return $leidas;
}

/**
 * Quién escribe una columna, en las dos formas en que se escribe aquí.
 *
 * `'columna' => valor` dentro de un update, y `$cambios['columna'] = valor`
 * cuando el cambio es condicional. Buscar solo la primera daba por no escritas
 * cuatro columnas que sí lo están — y habría hecho de este guardián un
 * generador de falsos positivos, que es como se acaba aflojando uno.
 *
 * @return list<string>
 */
function escribenLaColumna(string $columna): array
{
    $quien = [];

    $iterador = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(raizSuscripcion().'/app'),
    );

    foreach ($iterador as $fichero) {
        if (! $fichero->isFile() || $fichero->getExtension() !== 'php') {
            continue;
        }

        $ruta = str_replace(raizSuscripcion().'/', '', $fichero->getPathname());

        // El modelo solo declara qué es RELLENABLE, que no es escribir: una
        // columna puede estar en `$fillable` toda su vida sin que nadie le
        // asigne nunca un valor, y así estaba esta.
        if (str_contains($ruta, 'app/Models/')) {
            continue;
        }

        $fuente = Source::sinComentarios($fichero->getPathname());

        if (preg_match("/'{$columna}'\s*=>|\['{$columna}'\]\s*=/", $fuente) === 1) {
            $quien[] = $ruta;
        }
    }

    return $quien;
}

it('toda columna de la suscripción que una pantalla lee tiene quien la escriba', function (): void {
    // ESTE ES EL FALLO. `cancel_at_period_end` se leía en dos pantallas y no se
    // escribía en ninguna parte: el aviso «se dará de baja al acabar el
    // periodo» no podía aparecer nunca.
    $huerfanas = [];

    foreach (columnasQueLeeLaSuscripcion() as $columna => $pantallas) {
        if (escribenLaColumna($columna) === []) {
            $huerfanas[] = "{$columna} (la leen ".implode(', ', array_unique($pantallas)).')';
        }
    }

    expect($huerfanas)->toBe(
        [],
        'Estas columnas las lee una pantalla y no las escribe nadie, así que enseñan su valor por omisión '.
        "como si fuera un dato:\n  ".implode("\n  ", $huerfanas),
    );
});

it('quien escribe la baja programada es el ciclo de la suscripción', function (): void {
    // No basta con que exista un escritor en alguna parte: el sitio importa.
    // Escrita desde un controlador de pantalla sería una bandera que se pone a
    // mano, y entonces diría lo que alguien quiso, no lo que pasó.
    expect(escribenLaColumna('cancel_at_period_end'))->toBe(['app/Support/Billing/Subscriptions.php']);
});

it('el vocabulario sabe contar la baja programada y su retirada', function (): void {
    // La columna no se escribía porque no había suceso que la contara. Un
    // vocabulario al que le falta un hecho del dominio obliga a que ese hecho
    // se pierda en `default`.
    expect(BillingEvent::TYPES)->toContain(BillingEvent::CANCEL_SCHEDULED);
    expect(BillingEvent::TYPES)->toContain(BillingEvent::CANCEL_REVERSED);
});

it('cada tipo del vocabulario tiene una rama que lo aplica', function (): void {
    // Un tipo nuevo sin rama cae en `default => 'ignorado'` y se anota como
    // aplicado sin aplicar nada — que es como se comportaba el suceso de
    // Stripe que faltaba.
    $ciclo = Source::sinComentarios(raizSuscripcion().'/app/Support/Billing/Subscriptions.php');

    foreach (BillingEvent::TYPES as $tipo) {
        if ($tipo === BillingEvent::IGNORED) {
            continue;
        }

        $constante = strtoupper($tipo);

        test()->assertStringContainsString(
            "BillingEvent::{$constante} =>",
            $ciclo,
            "El ciclo de la suscripción no tiene rama para {$tipo}: caería en «ignorado».",
        );
    }
});

it('el suceso de Stripe que programa la baja está mapeado', function (): void {
    $stripe = Source::sinComentarios(raizSuscripcion().'/app/Services/Billing/StripeBillingProvider.php');

    test()->assertStringContainsString(
        "'customer.subscription.updated' =>",
        $stripe,
        'El único suceso que cuenta una baja programada vuelve a caer en el cajón de ignorados.',
    );

    // Y que la retirada se reconozca por lo que CAMBIÓ y no por el valor: ese
    // suceso salta por muchas cosas, y tratarlo entero como «se retira la
    // baja» anotaría un hecho que no ha pasado cada vez que alguien toca algo.
    test()->assertStringContainsString('previous_attributes', $stripe);
});

it('el simulacro puede producir los dos sucesos nuevos', function (): void {
    // Sin credenciales de Stripe no hay otra forma de recorrer este camino, y
    // un camino que solo se puede recorrer en producción no se recorre.
    $simulacro = Source::sinComentarios(raizSuscripcion().'/app/Services/Billing/MockBillingProvider.php');

    test()->assertStringContainsString(
        'in_array($tipo, BillingEvent::TYPES, true)',
        $simulacro,
        'El simulacro dejó de aceptar el vocabulario entero: los tipos nuevos no se pueden ensayar.',
    );
});
