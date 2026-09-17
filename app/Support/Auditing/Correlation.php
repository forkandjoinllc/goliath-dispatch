<?php

declare(strict_types=1);

namespace App\Support\Auditing;

use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Qué eventos de auditoría pertenecen al mismo acto.
 *
 * ## El defecto
 *
 * `Audit::record()` escribía el agrupador así:
 *
 * ```php
 * 'request_id' => $request?->header('X-Request-Id'),
 * ```
 *
 * Y **nadie pone esa cabecera**: ni un middleware, ni `bootstrap/app.php`, ni la
 * configuración. La columna sale nula siempre — en la demostración, 21 eventos y
 * cero con identificador.
 *
 * Lo que eso rompe está escrito en la cabecera de `AuditController::show()`:
 *
 * > Los hermanos son el motivo por el que esta pantalla existe y no basta con
 * > la lista: una sola acción de una persona —aprobar un gasto, digamos—
 * > escribe varios eventos, y leerlos sueltos no cuenta lo que pasó.
 *
 * Ese bloque estaba **siempre vacío**. El buscador por identificador de petición
 * no casaba nunca. Y el índice `audit_events_request_idx` indexaba una columna
 * que siempre era nula.
 *
 * ## Y lo peor no era que faltara
 *
 * Era de dónde venía. `X-Request-Id` la manda el CLIENTE. Si alguien hubiera
 * puesto un proxy delante que la rellenara —o simplemente la mandara a mano—,
 * quien hace la petición elegiría cómo se agrupan sus propios eventos de
 * auditoría: juntar cosas que no pasaron juntas, o separar las de un mismo acto
 * mandando una cabecera distinta en cada llamada.
 *
 * `audit_events` es de SOLO AÑADIR —un disparador rechaza cualquier UPDATE o
 * DELETE—, así que un agrupamiento falso no se puede corregir después. Un dato
 * que viene de fuera no puede decidir la forma de un registro que no se puede
 * arreglar.
 *
 * Aquí el identificador se genera **dentro**. La cabecera del cliente se ignora
 * a propósito, y el guardián lo exige.
 *
 * ## Una petición, un acto. Una orden de consola, también
 *
 * El barrido nocturno escribe varios eventos y no es una petición HTTP. Sin
 * identificador, sus eventos quedan tan sueltos como estaban los de la pantalla.
 *
 * Por eso esto NO depende de que haya petición: memoriza un identificador por
 * PROCESO y lo genera la primera vez que alguien pregunta. Una orden de artisan
 * es un proceso y una ejecución, así que todo lo que escriba un barrido queda
 * junto sin tener que envolver nada.
 *
 * El middleware lo REINICIA en cada petición. Con PHP-FPM daría igual —un
 * proceso es una petición—, pero con un servidor que mantiene la aplicación
 * viva entre peticiones (Octane) el proceso dura horas, y sin reiniciar se
 * agruparían bajo un mismo acto las acciones de gente distinta.
 */
final class Correlation
{
    /**
     * La cabecera que este código NO lee.
     *
     * Se declara para que el guardián pueda comprobar que sigue sin leerse. Una
     * constante con el nombre de lo que se descarta explica más que su ausencia.
     */
    public const CABECERA_DEL_CLIENTE = 'X-Request-Id';

    private static ?string $actual = null;

    /**
     * El identificador del acto en curso.
     *
     * Se genera la primera vez que se pide. Nunca devuelve nulo: un evento sin
     * agrupador es exactamente el estado del que venimos.
     */
    public static function actual(): string
    {
        return self::$actual ??= (string) Str::uuid();
    }

    /**
     * Empieza un acto nuevo. Lo llama el middleware en cada petición.
     *
     * Devuelve el identificador para que quien lo llame pueda ponerlo también
     * en la respuesta: con la cabecera de vuelta, un usuario que informa de un
     * problema puede dar un número que lleva directo a sus eventos.
     */
    public static function iniciar(?Request $request = null): string
    {
        // El `$request` no se lee: está en la firma para que quede claro, al
        // leer el middleware, que la petición NO aporta el identificador.
        unset($request);

        return self::$actual = (string) Str::uuid();
    }

    /** Para las pruebas: olvida el acto en curso. */
    public static function forget(): void
    {
        self::$actual = null;
    }
}
