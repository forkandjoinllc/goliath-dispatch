<?php

declare(strict_types=1);

namespace App\Support\Oversize;

use Illuminate\Support\Facades\DB;

/**
 * Qué cargas necesitan papeles especiales antes de salir.
 *
 * ## El defecto
 *
 * `Guards::blocking` cerraba sus dos puertas —el permiso aprobado y la
 * validación del administrador— mirando **solo** `is_oversize`:
 *
 * ```php
 * if ((bool) $load->is_oversize && $load->permit_ready_approved_at === null) {
 * ```
 *
 * Y `Evaluator` pone las dos banderas **por separado**: una carga de maquinaria
 * compacta con medidas legales y exceso de peso sale `overweight` a secas, con
 * `is_oversize = 0`. Esa carga se despachaba sin permiso aprobado y sin
 * validación.
 *
 * Mientras tanto, la pantalla de permisos la LISTA —su consulta sí pregunta por
 * las dos banderas— y le pinta las dos columnas en rojo: «Evaluación: pendiente
 * de firma», «Listo para despachar: todavía no aprobado». Y el diccionario dice,
 * en los dos idiomas:
 *
 * > El despacho permanece bloqueado para una carga sobredimensionada **o con
 * > sobrepeso** hasta que un administrador valide esta evaluación.
 *
 * Quien lleva esa pantalla cree que esas columnas son puertas. Para una carga de
 * solo sobrepeso eran etiquetas.
 *
 * ## Por qué una pieza y no un `||` repetido
 *
 * Porque el `||` ya existía en un sitio —la consulta del listado de permisos— y
 * el defecto fue precisamente que el otro sitio no lo tenía. Dos expresiones
 * equivalentes en dos ficheros es como se llegó aquí; una pieza con nombre es lo
 * que permite que un guardián exija que los dos la usen.
 *
 * ## Lo que esto NO decide
 *
 * Si hace falta permiso de verdad. Eso lo dice una persona: `Evaluator` lo
 * explica en su cabecera —«ESTO ORIENTA. NO DETERMINA»— y por eso las columnas
 * se llaman `permit_likely_required`. Aquí solo se contesta qué cargas tienen que
 * pasar por la mesa de alguien antes de rodar.
 */
final class NeedsPapers
{
    /**
     * Las banderas de la carga que abren la puerta, con su motivo.
     *
     * Declaradas y no escritas en un `if` porque el guardián las cuenta: una
     * bandera nueva —`is_hazmat`, el día que exista— hay que clasificarla aquí o
     * se queda fuera de las puertas sin que nadie lo note, que es exactamente lo
     * que le pasó al sobrepeso.
     *
     * @var array<string, string>
     */
    public const BANDERAS = [
        'is_oversize' => 'Medidas fuera de límite. Necesita permiso estatal por cada estado del recorrido, y a veces escolta.',
        'is_overweight' => 'Peso fuera de límite, con medidas legales o sin ellas. Es la carga de maquinaria compacta, y necesita su propio permiso: el puente no distingue si además es ancha.',
    ];

    /** ¿Esta carga tiene que pasar por la mesa de alguien antes de rodar? */
    public static function laCarga(object $carga): bool
    {
        foreach (array_keys(self::BANDERAS) as $bandera) {
            if ((bool) ($carga->{$bandera} ?? false)) {
                return true;
            }
        }

        return false;
    }

    /**
     * La misma pregunta, en SQL, para los listados.
     *
     * @param  \Illuminate\Database\Query\Builder|\Illuminate\Database\Eloquent\Builder  $query
     */
    public static function enConsulta($query, string $tabla = 'loads'): void
    {
        $query->where(function ($q) use ($tabla): void {
            foreach (array_keys(self::BANDERAS) as $i => $bandera) {
                $i === 0
                    ? $q->where("{$tabla}.{$bandera}", 1)
                    : $q->orWhere("{$tabla}.{$bandera}", 1);
            }
        });
    }

    /**
     * ¿Exige esta empresa la validación de un administrador?
     *
     * Vive aquí y no en `Guards` porque la PANTALLA también tiene que saberlo:
     * afirmaba tajante que «el despacho permanece bloqueado hasta que un
     * administrador valide», y eso solo es cierto con el ajuste encendido —que
     * viene apagado de fábrica—. Una frase así es de las que alguien lee, delega
     * y deja de mirar.
     *
     * Falso cuando no hay fila de ajustes, y eso es deliberado: falta de
     * configuración no es falta de permiso. Una empresa sin ajustes no puede
     * quedarse con todas sus cargas paradas porque una consulta devolvió nulo.
     * La puerta que se cierra sola por un dato que falta es tan mala como la que
     * no se cierra nunca.
     */
    public static function exigeValidacion(string $tenantId): bool
    {
        return (bool) DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->value('require_oversize_admin_validation');
    }
}
