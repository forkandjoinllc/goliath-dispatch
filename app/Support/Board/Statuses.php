<?php

declare(strict_types=1);

namespace App\Support\Board;

use App\Enums\DriverStatus;
use App\Enums\LoadStatus;

/**
 * Los dos filtros por estado del tablero: el de las cargas y el de los
 * conductores.
 *
 * ## Solo se ofrece lo que se puede enseñar
 *
 * Las tres pestañas dejan fuera el borrador y lo cancelado —`Tabs::fuera()`—,
 * así que esos dos no entran en el desplegable. Ofrecerlos daría un filtro que
 * no puede encontrar nada nunca: se elige «Cancelada», salen cero cargas en las
 * tres pestañas, y no hay nada en la pantalla que explique por qué. La lista se
 * calcula RESTANDO, para que un estado nuevo aparezca solo y uno que se saque
 * de las pestañas desaparezca del filtro el mismo día.
 *
 * ## Los conductores: el reparto por defecto se escribe al revés
 *
 * La columna de conductores del tablero contesta «¿a quién le doy esta carga?»,
 * y enseñaba también a los dados de baja y a los inactivos. Ahora no, salvo que
 * se pidan.
 *
 * Lo que se escribe es QUIÉN NO TRABAJA, y el reparto por defecto es todo lo
 * demás. Escrita al derecho —una lista de «los que sí»— un estado nuevo
 * quedaría fuera del reparto por defecto y esos conductores desaparecerían del
 * tablero sin que nadie lo hubiera decidido. Al revés, un estado nuevo entra
 * solo, que es el error que se puede ver.
 *
 * ## Varios a la vez
 *
 * En despacho se mira «en tránsito» y «en entrega» juntas, o «disponible» y
 * «en carga»: son una sola pregunta. Viajan en la URL separados por comas y
 * SIEMPRE en el orden de esta clase, no en el que vinieran escritos, para que
 * dos direcciones con los mismos estados sean la misma dirección.
 */
final class Statuses
{
    /**
     * Los seis estados de un conductor, en el orden de la jornada.
     *
     * El mismo que `ESTADOS_DE_CONDUCTOR` en la pantalla: lo que trabaja
     * primero, lo que no trabaja después. Dos órdenes distintos para la misma
     * lista se notan al leerla dos veces seguidas.
     *
     * @var list<string>
     */
    public const CONDUCTOR = ['available', 'on_load', 'off_duty', 'inactive', 'on_hold', 'terminated'];

    /**
     * Los que NO salen si nadie dice lo contrario.
     *
     * Dado de baja no vuelve, e inactivo no está. Los dos siguen pudiendo
     * pedirse — por eso son un filtro y no un borrado.
     *
     * @var list<string>
     */
    public const NO_TRABAJAN = ['terminated', 'inactive'];

    /**
     * Los estados de carga que el tablero puede enseñar, en el orden del viaje.
     *
     * @return list<string>
     */
    public static function deCarga(): array
    {
        return array_values(array_diff(
            array_map(static fn (LoadStatus $c): string => $c->value, LoadStatus::cases()),
            Tabs::fuera(),
        ));
    }

    /**
     * Los estados de conductor, en el orden de la jornada.
     *
     * Lo que no esté en el orden escrito va al final en vez de caerse: un
     * estado nuevo que desapareciera del filtro escondería conductores sin que
     * nadie lo hubiera pedido.
     *
     * @return list<string>
     */
    public static function deConductor(): array
    {
        $todos = DriverStatus::values();

        return [
            ...array_values(array_intersect(self::CONDUCTOR, $todos)),
            ...array_values(array_diff($todos, self::CONDUCTOR)),
        ];
    }

    /**
     * El reparto por defecto de la columna de conductores.
     *
     * @return list<string>
     */
    public static function porDefectoDeConductor(): array
    {
        return array_values(array_diff(self::deConductor(), self::NO_TRABAJAN));
    }

    /**
     * Los estados de carga elegidos. Vacío quiere decir «todos».
     *
     * @return list<string>
     */
    public static function deCargaElegidos(?string $crudo): array
    {
        return self::validos($crudo, self::deCarga());
    }

    /**
     * Los estados de conductor elegidos.
     *
     * Sin nada elegido —o con basura en la URL— manda el reparto por defecto y
     * no «ninguno»: una columna vacía porque alguien tecleó mal la dirección no
     * es un filtro, es una pantalla rota.
     *
     * @return list<string>
     */
    public static function deConductorElegidos(?string $crudo): array
    {
        $elegidos = self::validos($crudo, self::deConductor());

        return $elegidos === [] ? self::porDefectoDeConductor() : $elegidos;
    }

    /**
     * ¿Está la columna de conductores enseñando lo de siempre?
     *
     * @param  list<string>  $elegidos
     */
    public static function esElRepartoPorDefecto(array $elegidos): bool
    {
        return $elegidos === self::porDefectoDeConductor();
    }

    /**
     * Lo que vino por la URL, quedándose solo con lo que existe.
     *
     * En el orden de `$permitidos` y no en el que vino: la URL no decide el
     * orden de nada.
     *
     * @param  list<string>  $permitidos
     * @return list<string>
     */
    private static function validos(?string $crudo, array $permitidos): array
    {
        if ($crudo === null || trim($crudo) === '') {
            return [];
        }

        $pedidos = array_map(static fn (string $v): string => trim($v), explode(',', $crudo));

        return array_values(array_filter(
            $permitidos,
            static fn (string $estado): bool => in_array($estado, $pedidos, true),
        ));
    }
}
