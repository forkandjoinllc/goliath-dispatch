<?php

declare(strict_types=1);

use App\Support\Auditing\Correlation;
use Tests\Support\Source;

use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertStringNotContainsString;

/**
 * El agrupador de la bitácora se genera dentro, y siempre existe.
 *
 * ## El defecto
 *
 * ```php
 * 'request_id' => $request?->header('X-Request-Id'),
 * ```
 *
 * Nadie ponía esa cabecera —ni un middleware, ni `bootstrap/app.php`, ni la
 * configuración— así que la columna salía nula en todos los eventos. Y con ella
 * se caía lo único que la ficha de auditoría aporta sobre la lista: su propia
 * cabecera lo dice, «los hermanos son el motivo por el que esta pantalla existe
 * y no basta con la lista», porque una sola acción escribe varios eventos.
 *
 * El bloque estaba siempre vacío. El buscador por identificador no casaba
 * nunca. Y el índice `audit_events_request_idx` indexaba una columna nula.
 *
 * ## La mitad que no era «falta esto»
 *
 * `X-Request-Id` la manda el CLIENTE. Si alguien la hubiera puesto —un proxy,
 * o a mano— quien hace la petición elegiría cómo se agrupan sus propios eventos:
 * juntar lo que no pasó junto, o partir un acto en trozos. Y `audit_events` es
 * de solo-añadir: un disparador rechaza cualquier UPDATE o DELETE, así que un
 * agrupamiento falso no se corrige jamás.
 *
 * Un dato de fuera no puede decidir la forma de un registro que no se puede
 * arreglar. Por eso el guardián no comprueba que la cabecera se ponga: comprueba
 * que NO se lea.
 */
function raizBitacora(): string
{
    return Source::root();
}

it('la bitácora no lee la cabecera que manda el cliente', function (): void {
    // La comprobación que importa, y la que no es obvia: el arreglo fácil
    // —poner la cabecera en un middleware y seguir leyéndola— dejaría a quien
    // llama eligiendo el agrupamiento.
    $bitacora = Source::compacta(raizBitacora().'/app/Support/Audit.php');

    assertStringNotContainsString("header('X-Request-Id')", $bitacora);
    assertStringNotContainsString('$request?->header(', $bitacora);
    assertStringContainsString("'request_id'=>Correlation::actual()", $bitacora);
});

it('el identificador se genera dentro y nunca es nulo', function (): void {
    // `actual()` devuelve `string`, no `?string`: un evento sin agrupador es
    // exactamente el estado del que venimos, y el tipo lo impide.
    $pieza = Source::compacta(raizBitacora().'/app/Support/Auditing/Correlation.php');

    assertStringContainsString('publicstaticfunctionactual():string', $pieza);
    assertStringContainsString('self::$actual??=(string)Str::uuid()', $pieza);

    // Y no mira la petición para sacarlo.
    assertStringNotContainsString('->header(', $pieza);
    assertStringNotContainsString('$request->', $pieza);
});

it('el middleware del identificador va el primero de la pila', function (): void {
    // Cualquier cosa que pase después puede escribir en la bitácora —resolver
    // la empresa, negar un permiso, fallar una validación— y todo eso es el
    // mismo acto. Puesto después, esos eventos caerían en el acto anterior.
    $arranque = Source::compacta(raizBitacora().'/bootstrap/app.php');

    assertStringContainsString('$middleware->web(prepend:[AssignRequestId::class,]);', $arranque);
});

it('cada petición empieza un acto nuevo', function (): void {
    // Con PHP-FPM un proceso es una petición y daría igual. Con un servidor que
    // mantiene la aplicación viva entre peticiones, el proceso dura horas: sin
    // reiniciar, las acciones de gente distinta quedarían bajo un mismo acto.
    $medio = Source::compacta(raizBitacora().'/app/Http/Middleware/AssignRequestId.php');

    assertStringContainsString('Correlation::iniciar($request)', $medio);
    assertStringContainsString('$respuesta->headers->set(Correlation::CABECERA_DEL_CLIENTE,$id)', $medio);
});

it('en dos actos seguidos el identificador cambia, y dentro de uno no', function (): void {
    Correlation::forget();

    $uno = Correlation::actual();

    expect(Correlation::actual())->toBe($uno, 'dentro de un acto el identificador no puede cambiar');

    $dos = Correlation::iniciar();

    expect($dos)->not->toBe($uno);
    expect(Correlation::actual())->toBe($dos);

    Correlation::forget();

    expect(Correlation::actual())->not->toBe($dos);
});

it('la pantalla sigue agrupando por ese identificador', function (): void {
    // El arreglo solo sirve si quien lo usa sigue ahí. Si alguien cambiara la
    // ficha para agrupar por otra cosa, este lote dejaría de hacer algo.
    $pantalla = Source::compacta(raizBitacora().'/app/Http/Controllers/App/AuditController.php');

    assertStringContainsString("->where('request_id',\$fila->request_id)", $pantalla);
    assertStringContainsString("->where('id','!=',\$fila->id)", $pantalla);
    assertStringContainsString("orWhere('request_id',\$filters['q'])", $pantalla);
});

it('el índice de peticiones deja de indexar una columna vacía', function (): void {
    // Estaba en el esquema desde el primer día, sobre una columna que siempre
    // era nula. No se toca: ahora por fin indexa algo.
    $ddl = (string) file_get_contents(raizBitacora().'/database/schema/01_tenancy_auth_tables.sql');

    assertStringContainsString('audit_events_request_idx', $ddl);
});
