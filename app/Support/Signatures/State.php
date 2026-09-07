<?php

declare(strict_types=1);

namespace App\Support\Signatures;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * En qué estado está DE VERDAD una solicitud de firma.
 *
 * ## El defecto
 *
 * `signature_requests.status` no dice la verdad sobre el vencimiento, y no es
 * un descuido: **nada corre a medianoche a poner `expired` en las filas**. Lo
 * dice el propio comentario de `SigningLinks::resolve()`, que por eso mira la
 * FECHA y no la columna. Del lado del firmante, correcto.
 *
 * Del lado de la casa, no. La lista de solicitudes pintaba `r.status` tal cual
 * y filtraba por `where('r.status', $estado)`. Consecuencias, las dos malas:
 *
 *  - Una solicitud que venció ayer sigue saliendo como **«Pendiente»**, que se
 *    lee como «estamos esperando a que firme». No estamos esperando nada: al
 *    firmante ya se le cerró la puerta y no puede hacer nada aunque quiera.
 *  - El filtro **«Vencida»** está en la barra, se puede pulsar, y **no
 *    encuentra nada nunca** — porque ninguna fila llega a tener ese valor
 *    guardado.
 *
 * Y una firma que falta es justo lo que impide que una carga se mueva.
 *
 * ## Por qué se calcula y no se guarda
 *
 * Se podría haber añadido una pasada al barrido que escribiera `expired` en
 * las filas vencidas. Se ha calculado, por dos razones:
 *
 *  1. Guardarlo hace que la verdad dependa de que un cron esté vivo. Ya hay una
 *     pantalla en este proyecto dedicada a que un cron muerto se note, lo que
 *     dice bastante sobre cuánto conviene apoyarse en uno.
 *  2. Con el estado calculado, el minuto en que vence una solicitud es el
 *     minuto en que la lista lo dice — no «a la mañana siguiente, si corrió».
 *
 * El precio es que hay DOS sitios que tienen que aplicar la misma regla: PHP
 * para pintar y SQL para filtrar. Por eso los dos salen de esta clase, y por
 * eso hay una prueba que los compara: dos copias de una regla se separan.
 */
final class State
{
    /** Los estados en los que la solicitud todavía espera al firmante. */
    public const ABIERTOS = ['pending', 'viewed'];

    /**
     * El estado real de una fila, con el vencimiento ya aplicado.
     *
     * @param  object{status: mixed, expires_at: mixed}  $fila
     */
    public static function of(object $fila): string
    {
        return self::calcular((string) $fila->status, $fila->expires_at);
    }

    /** La misma regla, con los dos valores sueltos. */
    public static function calcular(string $status, mixed $expiresAt): string
    {
        if (! in_array($status, self::ABIERTOS, true)) {
            return $status;
        }

        if ($expiresAt === null) {
            return $status;
        }

        return CarbonImmutable::parse((string) $expiresAt)->isPast() ? 'expired' : $status;
    }

    /**
     * Filtra por estado REAL, no por la columna.
     *
     * Pedir «vencida» tiene que devolver las que vencieron aunque su columna
     * siga diciendo `pending`; y pedir «pendiente» NO puede devolver esas
     * mismas, o el filtro pendiente seguiría enseñando puertas cerradas.
     *
     * @param  string  $alias  el alias de `signature_requests` en la consulta
     */
    public static function filtrar(Builder $query, string $alias, string $estado): Builder
    {
        $status = "{$alias}.status";
        $vence = "{$alias}.expires_at";

        if ($estado === 'expired') {
            return $query->where(function (Builder $q) use ($status, $vence): void {
                $q->where($status, 'expired')
                    ->orWhere(function (Builder $q2) use ($status, $vence): void {
                        $q2->whereIn($status, self::ABIERTOS)
                            ->whereNotNull($vence)
                            ->where($vence, '<', DB::raw('now()'));
                    });
            });
        }

        if (in_array($estado, self::ABIERTOS, true)) {
            return $query->where($status, $estado)
                ->where(function (Builder $q) use ($vence): void {
                    $q->whereNull($vence)->orWhere($vence, '>=', DB::raw('now()'));
                });
        }

        return $query->where($status, $estado);
    }
}
