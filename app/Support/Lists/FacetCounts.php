<?php

declare(strict_types=1);

namespace App\Support\Lists;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * El número de un atajo tiene que ser el número que sale al pulsarlo.
 *
 * ## El defecto
 *
 * Cinco pantallas —cargas, documentos, transportistas, conductores y equipo—
 * llevan una fila de atajos con su recuento al lado: «Pagadas (3)», «Pendientes
 * (8)». Ese recuento se calculaba con el ámbito del actor y **sin ninguno de
 * los demás filtros activos**, mientras que pulsar el atajo los conserva todos.
 *
 * Medido sobre los datos de demostración, con un cliente elegido en la pantalla
 * de cargas:
 *
 *     la lista enseñaba 3 filas
 *     encima ponía  «Todas (11)»
 *     «Pagadas (3)» llevaba a CERO filas
 *
 * No es un caso raro. Pasa en cuanto hay dos filtros a la vez, que es el uso
 * normal de esas pantallas: buscar algo y luego acotar por estado.
 *
 * Es la misma promesa que el lote anterior arregló en el panel —el número que
 * se pulsa tiene que ser el número que sale— un nivel más abajo.
 *
 * ## La regla, en una frase
 *
 * > El recuento de un atajo se cuenta con TODOS los filtros activos menos los
 * > que esa misma fila de atajos controla, más los que ese atajo concreto pone.
 *
 * Las dos mitades importan. Sin la primera, el número ignora el filtro de
 * búsqueda que el usuario acaba de escribir. Sin la segunda, «Pagadas» se
 * contaría con el «Pendientes» que estaba puesto y daría cero siempre.
 *
 * ## Por qué el vaciado lo hace ESTA clase y no quien llama
 *
 * Porque es la mitad que se olvida. Un ayudante al que se le pasa la consulta
 * «ya preparada» deja el vaciado en manos de cinco pantallas, y basta con que
 * una lo haga distinto para que vuelva el defecto sin que nada se ponga rojo.
 * Aquí se recibe el mapa de filtros entero y una lista de qué claves controla
 * la fila; vaciarlas es lo primero que pasa.
 *
 * ## Y no cuesta más consultas que antes
 *
 * Los atajos que solo cambian el valor de una columna salen de UNA consulta
 * agrupada. Los que encienden otro filtro —«Vencen pronto»— necesitan la suya,
 * que es exactamente lo que ya hacían. El coste por pantalla no se mueve.
 */
final class FacetCounts
{
    /**
     * Los recuentos de una fila de atajos.
     *
     * @param  callable(array<string, string>): Builder<*>  $consulta  el ámbito
     *         del actor con los filtros que se le pasen ya aplicados
     * @param  array<string, string>  $filtros  los filtros activos de la pantalla
     * @param  list<string>  $controla  las claves de filtro que esta fila maneja
     * @param  string  $columna  la columna que se agrupa
     * @param  list<string>  $valores  los valores que la fila enseña
     * @param  array<string, array<string, string>>  $extras  atajos que encienden
     *                                                        otro filtro: clave del atajo => los filtros que pone
     * @return array<string, int>
     */
    public static function fila(
        callable $consulta,
        array $filtros,
        array $controla,
        string $columna,
        array $valores,
        array $extras = [],
    ): array {
        // Lo PRIMERO, y por eso vive aquí: la fila de atajos no se cuenta a sí
        // misma. Si «Pendientes» estuviera puesto, todos los demás darían cero.
        $base = $filtros;

        foreach ($controla as $clave) {
            $base[$clave] = '';
        }

        $agrupado = $consulta($base)
            ->select($columna, DB::raw('count(*) as total'))
            ->groupBy($columna)
            ->pluck('total', $columna)
            ->all();

        // `all` sale de la suma de TODOS los grupos y no de los `$valores`
        // enseñados: una fila cuyo estado no tenga atajo sigue estando en la
        // lista, y «Todas» tiene que contarla.
        $salida = ['all' => (int) array_sum($agrupado)];

        foreach ($valores as $valor) {
            $salida[$valor] = (int) ($agrupado[$valor] ?? 0);
        }

        foreach ($extras as $clave => $parche) {
            $salida[$clave] = $consulta([...$base, ...$parche])->count();
        }

        return $salida;
    }
}
