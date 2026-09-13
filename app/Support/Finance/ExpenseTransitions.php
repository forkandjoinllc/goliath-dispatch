<?php

declare(strict_types=1);

namespace App\Support\Finance;

/**
 * Por dónde puede moverse un gasto, y por dónde no vuelve.
 *
 * ## El defecto
 *
 * Al intentar rechazar un gasto ya aprobado, la aplicación contestaba:
 *
 * > Un gasto aprobado no se puede rechazar directamente. **Comuníquese con un
 * > administrador para revertirlo.**
 *
 * No hay reversión. Ni para un administrador, ni para nadie: `approve` y
 * `reject` solo aceptan un gasto en `submitted`, `reimburse` solo uno
 * `approved`, y no existe ruta, acción ni permiso que devuelva un aprobado a
 * ningún sitio. El mensaje mandaba a una persona que tampoco puede hacerlo.
 *
 * Y no es una molestia de trámite: un gasto aprobado cuenta en la base de
 * comisión —`countingCents` suma `approved` y `reimbursed`—, así que un clic
 * equivocado queda dentro del cálculo del dinero para siempre mientras el
 * producto asegura que alguien lo deshace.
 *
 * ## Por qué la tabla vive aquí
 *
 * Vivía dentro de un `match` en un método privado del controlador, y la copia
 * del error se escribió aparte. Dos sitios que hablan de lo mismo sin
 * mirarse: uno decía qué se puede hacer y el otro qué creía quien escribió el
 * texto. Con la tabla en un sitio, la pantalla puede PREGUNTARLE en vez de
 * suponer, y un guardián puede exigir que la copia no prometa una transición
 * que esta lista no tiene.
 *
 * ## Lo que este lote NO decide
 *
 * Si decidir DEBERÍA poder deshacerse. Puede que sí: un gasto aprobado por
 * error contamina la comisión y hoy no hay salida salvo crear otro gasto que
 * lo compense, que es contabilidad creativa a mano. Pero añadirle una puerta
 * al dinero ya aprobado es un cambio de producto, con su permiso, su motivo
 * obligatorio y su rastro —y eso se decide mirándolo de frente. Ver
 * `docs/expense-finality.md`.
 */
final class ExpenseTransitions
{
    /**
     * Estado nuevo => estados desde los que se llega.
     *
     * Es la LISTA COMPLETA. Lo que no está aquí no se puede hacer, y por eso
     * la pantalla puede decir con seguridad qué queda y qué no.
     *
     * @var array<string, list<string>>
     */
    public const DESDE = [
        'approved' => ['submitted'],
        'rejected' => ['submitted'],
        'reimbursed' => ['approved'],
    ];

    /**
     * Estados a los que NO SE VUELVE: nada de la tabla lleva hasta ellos.
     *
     * Hoy es uno solo, `submitted`, y es el que importa: en cuanto alguien
     * decide sobre un gasto, esa decisión no se puede rehacer. Ni el
     * administrador, ni nadie.
     *
     * Se declara con su motivo porque un callejón sin salida sin nombre se lee
     * como un descuido — y entonces alguien escribe un mensaje prometiendo la
     * salida que cree que hay, que es exactamente lo que pasó.
     *
     * OJO CON LA PALABRA «FINAL». `approved` tiene salida —a `reimbursed`— así
     * que no es un estado final, y decir que lo es sería mentir con el botón de
     * «marcar reembolsado» a la vista. Lo que no tiene es marcha ATRÁS. Los dos
     * conceptos viven en métodos distintos a propósito: escribí esta clase
     * confundiéndolos y la pantalla habría dicho que un gasto aprobado no puede
     * ir a ninguna parte, teniendo su botón al lado.
     *
     * @var array<string, string>
     */
    public const SIN_RETORNO = [
        'submitted' => 'Una vez decidido, un gasto no vuelve a estar pendiente de decisión: no hay acción, permiso ni rol que lo devuelva. Aprobar y rechazar son definitivos.',
    ];

    /** Si se puede pasar de un estado a otro. */
    public static function permitida(string $desde, string $hacia): bool
    {
        return in_array($desde, self::DESDE[$hacia] ?? [], true);
    }

    /**
     * Si a este estado no se llega desde ningún otro.
     *
     * Distinto de `esFinal()`: aquello mira las salidas, esto las entradas.
     */
    public static function sinRetorno(string $estado): bool
    {
        // Las CLAVES de la tabla son los destinos. Lo que no es clave no es
        // destino de nada, y por tanto no se vuelve a él.
        //
        // La primera versión de esto recorría los valores —los orígenes— y
        // contestaba al revés: decía que a `submitted` sí se vuelve, que es la
        // frase exacta que este lote existe para desmentir. La tabla se lee en
        // dos direcciones y las dos se confunden con facilidad.
        return ! array_key_exists($estado, self::DESDE);
    }

    /**
     * A dónde puede ir un gasto que está en este estado.
     *
     * @return list<string>
     */
    public static function salidasDe(string $desde): array
    {
        $salidas = [];

        foreach (self::DESDE as $hacia => $origenes) {
            if (in_array($desde, $origenes, true)) {
                $salidas[] = $hacia;
            }
        }

        return $salidas;
    }

    /**
     * Si de este estado ya no se sale hacia ninguna parte.
     *
     * `approved` NO lo es: va a `reimbursed`. Lo que no puede es volver.
     */
    public static function esFinal(string $estado): bool
    {
        return self::salidasDe($estado) === [];
    }
}
