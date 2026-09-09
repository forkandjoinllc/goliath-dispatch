<?php

declare(strict_types=1);

use App\Enums\DocumentType;
use App\Support\Documents\DocumentOwners;
use App\Support\Documents\DocumentTypes;
use Tests\Support\Source;

/**
 * Una pantalla tiene que saber nombrar lo que enseña.
 *
 * ## El defecto
 *
 * `t()` devuelve LA CLAVE cuando no encuentra el rótulo —está escrito así en
 * `resources/js/lib/i18n.tsx` a propósito, porque una excepción dejaría la
 * página en blanco—. La consecuencia es que un valor sin rótulo no rompe nada:
 * sale a pantalla tal cual. La lista de documentos enseñaba esto, en los dos
 * idiomas:
 *
 *     documents.types.rate_confirmation
 *     —
 *     documents.owners.load
 *
 * El tipo, la clave cruda. El dueño, un guion donde va el nombre y otra clave
 * cruda debajo. En la FICHA del documento, esa misma clave era el `<h1>` y el
 * título de la pestaña del navegador.
 *
 * Medido en el navegador sobre los datos de demostración: ocho filas con
 * `rate_confirmation`, diez con dueño `load`, ocho con dueño `expense`.
 *
 * ## Tres listas que decían cosas distintas
 *
 * | Lista | Tipos |
 * |---|---|
 * | El CHECK de `documents.document_type` | 27 |
 * | `App\Enums\DocumentType` | 27 |
 * | `DocumentTypes::CATALOG` | **22** |
 * | `types` de `lang/<idioma>/documents.json` | **22** |
 *
 * Y los cinco que faltaban no eran tipos muertos: cuatro los escribe la propia
 * aplicación. El docblock de `DocumentTypes` decía —dice— que «la lista de
 * tipos la impone el esquema con un CHECK», y no le hacía caso.
 *
 * Con los dueños, peor: `documents.owner_type` no tiene ni CHECK. El docblock de
 * `Attachment::store()` enumera en su firma `'load', 'expense', 'permit',
 * 'escort'…` y ninguno de los cuatro estaba en ningún catálogo ni tenía rótulo.
 *
 * ## Qué vigila este guardián
 *
 * 1. Que el catálogo de tipos cubra el CHECK del esquema, ENTERO, y que el enum
 *    diga lo mismo. El esquema manda: es la única de las tres listas que no se
 *    puede convencer, y es el argumento que ya usa `DocumentTypeCheckTest`.
 * 2. Que el catálogo de dueños cubra todo lo que el código pasa a
 *    `Attachment::store()` y todas las ranuras de `Papers`.
 * 3. Que TODO valor de un dominio cerrado tenga rótulo en los dos idiomas. No
 *    solo los documentos: treinta y tantos dominios del esquema, que es donde
 *    la clase entera de defecto puede volver a aparecer.
 * 4. Que no quede ninguna copia a mano de la lista de dueños. Había TRES —el
 *    desplegable, el filtro del servidor y el catálogo— y la del servidor
 *    descartaba `load` en silencio: el filtro parecía funcionar y devolvía la
 *    lista entera.
 *
 * ## Lo que NO vigila, y por qué
 *
 * Hay 122 familias de clave dinámica en el front (`t(`ns.algo.${x}`)`). Solo se
 * comprueban las que salen de un dominio CERRADO —un CHECK del esquema o un
 * catálogo de PHP—, porque son las únicas cuyo conjunto de valores se puede
 * enumerar sin adivinar. Las demás salen de listas que construye el propio
 * servidor y su cobertura habría que declararla a mano; declararla mal es peor
 * que no declararla. Queda dicho en `docs/document-names.md`.
 */
function raizNombres(): string
{
    return Source::root();
}

/**
 * Los dominios cerrados del esquema: 'tabla.columna' => valores admitidos.
 *
 * Se lee el DDL y no una constante de PHP, por el mismo motivo que
 * `DocumentTypeCheckTest`: una constante la escribe la misma mano que escribe
 * el literal, y las dos se equivocan a la vez.
 *
 * @return array<string, list<string>>
 */
function dominiosDelEsquema(): array
{
    static $cache = null;

    if ($cache !== null) {
        return $cache;
    }

    $dominios = [];

    foreach (glob(raizNombres().'/database/schema/*.sql') ?: [] as $fichero) {
        $ddl = (string) file_get_contents($fichero);

        // Partir por tabla: sin esto, las once columnas llamadas `status` se
        // mezclan en un solo dominio de cincuenta y dos valores y el guardián
        // exige rótulos que no le tocan a nadie.
        foreach (array_slice(preg_split('/create table\s+/i', $ddl) ?: [], 1) as $bloque) {
            if (preg_match('/^`?(\w+)`?/', $bloque, $m) !== 1) {
                continue;
            }

            $tabla = $m[1];

            preg_match_all(
                '/constraint\s+`?\w+`?\s+check\s*\(\s*`?(\w+)`?\s+in\s*\(([^)]*)\)\s*\)/is',
                $bloque,
                $checks,
                PREG_SET_ORDER,
            );

            foreach ($checks as $check) {
                preg_match_all("/'([^']+)'/", $check[2], $valores);
                $dominios["{$tabla}.{$check[1]}"] = array_values(array_unique($valores[1]));
            }
        }
    }

    return $cache = $dominios;
}

/** El rótulo de una ruta con puntos, o null si no está. */
function rotuloDe(string $idioma, string $ruta): ?string
{
    [$espacio, $resto] = explode('.', $ruta, 2);

    $fichero = raizNombres()."/lang/{$idioma}/{$espacio}.json";

    if (! file_exists($fichero)) {
        return null;
    }

    $nodo = json_decode((string) file_get_contents($fichero), true);

    foreach (explode('.', $resto) as $segmento) {
        if (! is_array($nodo) || ! array_key_exists($segmento, $nodo)) {
            return null;
        }

        $nodo = $nodo[$segmento];
    }

    return is_string($nodo) ? $nodo : null;
}

/** `nav.status.*` guarda las claves en camelCase; el esquema en snake_case. */
function camelDeClave(string $valor): string
{
    return (string) preg_replace_callback(
        '/_(.)/',
        static fn (array $m): string => strtoupper($m[1]),
        $valor,
    );
}

/**
 * dominio del esquema => ruta del diccionario que lo nombra.
 *
 * Solo lo que una pantalla PINTA. `role_permissions.role` no está porque nadie
 * enseña esa columna, y exigirle rótulo sería inventar trabajo.
 *
 * Declarar mal un par es peor que no declararlo: al montar esto declaré
 * `tracking_sessions.provider => tracking.provider` y
 * `trucks.coi_verification_status => equipment.verification`, y ninguna de las
 * dos rutas es la que usa la pantalla. El guardián pedía diez rótulos
 * inexistentes para dos pantallas que estaban bien. Cada par de esta lista se
 * comprobó contra el `t()` que de verdad lo usa.
 *
 * @var list<array{0: string, 1: string, 2: bool}> [dominio, ruta, camelCase]
 */
const DOMINIOS_CON_ROTULO = [
    ['documents.document_type', 'documents.types', false],
    ['load_documents.document_type', 'documents.types', false],
    ['documents.review_status', 'documents.review', false],
    ['document_reviews.status', 'documents.review', false],
    ['loads.status', 'nav.status.load', true],
    ['load_status_history.to_status', 'nav.status.load', true],
    ['loads.status', 'tracking.status', false],
    ['load_stops.appointment_type', 'loads.appointmentType', false],
    ['drivers.status', 'drivers.status', false],
    ['drivers.verification_status', 'drivers.verification', false],
    ['trucks.status', 'equipment.status', false],
    ['trailers.status', 'equipment.status', false],
    ['carriers.onboarding_status', 'onboarding.status', false],
    ['carriers.onboarding_status', 'nav.status.onboarding', true],
    ['carriers.fmcsa_status', 'nav.status.verification', true],
    ['carrier_onboarding_events.to_status', 'onboarding.status', false],
    ['invoices.status', 'invoices.status', false],
    ['payments.method', 'payments.methods', false],
    ['payment_attempts.method', 'payments.methods', false],
    ['payments.status', 'payments.status', false],
    ['payment_attempts.status', 'payments.status', false],
    ['expenses.status', 'expenses.status', false],
    ['expenses.treatment_snapshot', 'expenses.treatment', false],
    ['expense_categories.treatment', 'expenses.treatment', false],
    ['signature_requests.status', 'signature.statuses', false],
    ['signature_records.method', 'signature.methods', false],
    ['tracking_events.event_type', 'tracking.event', false],
    ['audit_events.action', 'audit.action', false],
    ['user_tenant_memberships.role', 'users.roles', false],
    ['user_tenant_memberships.role', 'nav.roles', false],
    ['user_tenant_memberships.status', 'users.status', false],
    ['users.status', 'users.status', false],
    ['tenants.status', 'platform.status', false],
    ['tenant_subscriptions.status', 'billing.status', false],
    ['tenant_subscriptions.status', 'platform.status', false],
    ['loads.dispatcher_commission_basis', 'commissions.basis', false],
    ['dispatcher_commissions.basis', 'commissions.basis', false],
    ['tenant_settings.dispatcher_commission_basis', 'settings.commissionBasis', false],
    ['conversation_participants.role', 'nav.roles', false],
];

/* ── El catálogo de tipos cubre el esquema ───────────────────────────────── */

it('el catálogo de tipos cubre el CHECK del esquema, entero', function (): void {
    $delEsquema = dominiosDelEsquema()['documents.document_type'] ?? [];

    expect($delEsquema)->not->toBeEmpty('No se encontró el CHECK de documents.document_type.');

    sort($delEsquema);
    $delCatalogo = DocumentTypes::all();
    sort($delCatalogo);

    expect($delCatalogo)->toBe(
        $delEsquema,
        'El esquema acepta tipos que el catálogo no conoce (o al revés). Un tipo que el esquema '.
        'admite y el catálogo ignora sale a pantalla como «documents.types.<clave>».',
    );
});

it('el enum dice lo mismo que el esquema', function (): void {
    $delEsquema = dominiosDelEsquema()['documents.document_type'] ?? [];
    sort($delEsquema);

    $delEnum = array_map(static fn (DocumentType $c): string => $c->value, DocumentType::cases());
    sort($delEnum);

    expect($delEnum)->toBe($delEsquema);
});

it('las dos columnas de tipo de documento admiten lo mismo', function (): void {
    // `documents` y `load_documents` llevan CHECKs separados. Si divergen, un
    // papel se puede colgar de una carga y no del documento equivalente.
    $a = dominiosDelEsquema()['documents.document_type'] ?? [];
    $b = dominiosDelEsquema()['load_documents.document_type'] ?? [];
    sort($a);
    sort($b);

    expect($a)->toBe($b);
});

it('los cinco que escribe la aplicación no se pueden elegir a mano', function (): void {
    // Es la línea que impide que este arreglo abra una puerta: si fueran
    // PERSONA, `forOwner('load')` los metería en el `Rule::in` de la subida de
    // papeles de una carga, y RateConfirmation::estado() busca exactamente por
    // `rate_confirmation` para decidir si el transportista aceptó la tarifa.
    foreach (['rate_confirmation', 'permit', 'route_survey', 'escort_document', 'invoice'] as $tipo) {
        expect(DocumentTypes::origin($tipo))->toBe(
            DocumentTypes::SISTEMA,
            "{$tipo} lo escribe la aplicación; ofrecerlo en un formulario deja subir un fichero cualquiera con ese nombre.",
        );
    }

    foreach (['carrier', 'driver', 'truck', 'trailer', 'load'] as $dueño) {
        foreach (DocumentTypes::forOwner($dueño) as $tipo) {
            expect(DocumentTypes::origin($tipo))->toBe(DocumentTypes::PERSONA);
        }
    }
});

it('preguntar por un tipo desconocido ya no contesta que no hace falta', function (): void {
    // Antes: `return self::CATALOG[$type][1] ?? false`. Una respuesta
    // tranquilizadora sobre un valor que no se reconoce.
    expect(fn () => DocumentTypes::isRequired('lo_que_sea'))
        ->toThrow(InvalidArgumentException::class);
});

/* ── El catálogo de dueños cubre lo que el código escribe ─────────────────── */

it('el catálogo de dueños conoce todo lo que el código cuelga', function (): void {
    $fuente = Source::compacta(raizNombres().'/app/Support/Oversize/Papers.php');

    // Las ranuras SE LEEN del fichero, no de una lista escrita aquí.
    //
    // La primera versión recorría ['permit','route_survey','escort'] a mano y
    // por eso no cazaba nada: el sabotaje que AÑADÍA una cuarta ranura sin
    // catalogar pasó en verde. Un guardián que comprueba la lista que escribió
    // quien lo escribió no comprueba el código, se comprueba a sí mismo.
    // `[^']+` y no `[a-z_]+`: con la clase estrecha, una ranura escrita
    // `route_survey_v2` no casaba y el bucle la SALTABA — el sabotaje que
    // metía un tipo sin catalogar pasó en verde. Una aguja que no entiende una
    // entrada tiene que fallar, no ignorarla.
    preg_match_all("/'([^']+)'=>\['tabla'=>'([^']+)','columna'=>'([^']+)','tipo'=>'([^']+)'\]/", $fuente, $ranuras, PREG_SET_ORDER);

    // Y por si la forma de la constante cambia: se cuentan las entradas de
    // verdad y se exige haber leído todas.
    expect(count($ranuras))->toBe(
        substr_count($fuente, "=>['tabla'=>"),
        'Hay ranuras en Papers::RANURAS que esta aguja no sabe leer, y saltarlas es no comprobarlas.',
    );

    expect($ranuras)->not->toBeEmpty('No se pudo leer Papers::RANURAS: la aguja dejó de casar.');

    foreach ($ranuras as [, $ranura, , , $tipo]) {
        // El dueño ES el nombre de la ranura, porque el papel se cuelga de la
        // fila del permiso o del escolta, no de la carga.
        expect(DocumentOwners::isKnown($ranura))->toBeTrue(
            "Papers cuelga papeles con dueño «{$ranura}» y el catálogo no lo conoce: la pantalla no sabría nombrarlo.",
        );

        expect(DocumentTypes::isKnown($tipo))->toBeTrue(
            "Papers escribe documentos de tipo «{$tipo}» y el catálogo no lo conoce.",
        );
    }

    // Y los literales que se pasan como primer argumento de Attachment::store.
    foreach (glob(raizNombres().'/app/Support/Documents/*.php') ?: [] as $fichero) {
        preg_match_all(
            "/Attachment::store\(\\\$\w+,'([a-z_]+)'/",
            Source::compacta($fichero),
            $literales,
        );

        foreach ($literales[1] as $dueño) {
            expect(DocumentOwners::isKnown($dueño))->toBeTrue(
                basename($fichero)." cuelga documentos con dueño «{$dueño}» y el catálogo no lo conoce.",
            );
        }
    }
});

it('todos los dueños tienen rótulo en los dos idiomas', function (): void {
    foreach (DocumentOwners::all() as $dueño) {
        foreach (['es', 'en'] as $idioma) {
            expect(rotuloDe($idioma, "documents.owners.{$dueño}"))->toBeString(
                "Sin rótulo, la celda enseña «documents.owners.{$dueño}» tal cual.",
            );
        }
    }
});

it('la lista de dueños no está escrita a mano en ningún sitio más', function (): void {
    // Había tres copias. La del servidor descartaba `load` en silencio: el
    // desplegable ofrecía el filtro y la lista salía entera.
    $controlador = Source::compacta(raizNombres().'/app/Http/Controllers/App/DocumentController.php');

    expect($controlador)->not->toContain(
        "in_array(\$filters['owner'],['carrier','driver','truck','trailer'],true)",
        'El filtro del servidor vuelve a llevar la lista a mano.',
    );

    test()->assertStringContainsString(
        "DocumentOwners::isKnown(\$filters['owner'])",
        $controlador,
        'El filtro tiene que salir del catálogo.',
    );

    test()->assertStringContainsString(
        "'ownerTypes'=>DocumentOwners::all()",
        $controlador,
        'El desplegable tiene que salir del catálogo, no del componente.',
    );

    $pantalla = (string) file_get_contents(raizNombres().'/resources/js/pages/App/Documents/Index.tsx');

    expect($pantalla)->not->toContain(
        "['carrier', 'driver', 'truck', 'trailer'].map",
        'El componente vuelve a llevar la lista a mano.',
    );
});

it('los documentos de una carga y de un gasto se pueden nombrar', function (): void {
    // No es sitio para consultar la base de datos —esto es tests/Unit— pero sí
    // para exigir que el catálogo sepa DÓNDE buscar el nombre. Que lo encuentre
    // lo comprueba tests/Feature/Documents/DocumentNamesTest.php.
    $fuente = Source::compacta(raizNombres().'/app/Support/Documents/DocumentOwners.php');

    foreach (['loads', 'expenses', 'permits', 'escorts'] as $tabla) {
        test()->assertStringContainsString(
            "'{$tabla}'",
            $fuente,
            "El catálogo no sabe en qué tabla vive el dueño que guarda {$tabla}.",
        );
    }
});

/* ── Ningún valor de un dominio cerrado se queda sin nombre ──────────────── */

it('todo valor que una pantalla enseña tiene rótulo en los dos idiomas', function (): void {
    $dominios = dominiosDelEsquema();
    $faltan = [];

    foreach (DOMINIOS_CON_ROTULO as [$dominio, $ruta, $camel]) {
        expect($dominios)->toHaveKey($dominio);

        foreach ($dominios[$dominio] as $valor) {
            $clave = $camel ? camelDeClave($valor) : $valor;
            $rotulo = rotuloDe('es', "{$ruta}.{$clave}");
            $rotuloEn = rotuloDe('en', "{$ruta}.{$clave}");

            if ($rotulo === null || $rotuloEn === null || trim($rotulo) === '' || trim($rotuloEn) === '') {
                $faltan[] = "{$dominio} = '{$valor}' -> {$ruta}.{$clave}";
            }
        }
    }

    expect($faltan)->toBe(
        [],
        "Estos valores existen en la base de datos y ninguna pantalla sabe nombrarlos; t() devuelve la clave y sale en crudo:\n  ".
        implode("\n  ", $faltan),
    );
});

it('la lista de dominios no reclama columnas que ya no existen', function (): void {
    $dominios = dominiosDelEsquema();

    foreach (DOMINIOS_CON_ROTULO as [$dominio, $ruta, $camel]) {
        test()->assertArrayHasKey(
            $dominio,
            $dominios,
            "{$dominio} ya no tiene CHECK en el esquema: quítalo de DOMINIOS_CON_ROTULO o devuélvele el CHECK.",
        );

        expect(rotuloDe('es', $ruta))->not->toBeString(
            "{$ruta} apunta a un texto, no a un bloque de rótulos: el par está mal declarado."
        );
    }
});
