<?php

declare(strict_types=1);

namespace App\Support\Documents;

/**
 * Qué pasa DE VERDAD cuando un documento vence.
 *
 * ## El defecto
 *
 * El formulario de subir un documento dice, justo debajo de la casilla de la
 * fecha de vencimiento:
 *
 * > Se le avisará {days} días antes, y la puerta de despacho bloquea en cuanto
 * > vence.
 *
 * La primera mitad es verdad para todos: la barredora nocturna recorre
 * `documents` sin mirar el tipo, así que cualquier documento con fecha genera
 * su aviso.
 *
 * La segunda es verdad para TRES de los diecisiete tipos que ese mismo
 * formulario ofrece. `Guards::documentCompliance()` se llama una sola vez en
 * todo el proyecto, con `'carrier'`, y solo mira los tipos que
 * `DocumentTypes::requiredFor('carrier')` declara obligatorios. Todo lo demás
 * vence sin que ninguna puerta se entere:
 *
 *  - Del CONDUCTOR, la puerta mira las columnas `drivers.license_expires_at` y
 *    `medical_card_expires_at`, no sus documentos. Un `cdl_front` vencido con
 *    la columna al día pasa, y al revés. Son dos verdades sobre la misma
 *    licencia y pueden discrepar.
 *  - Del CAMIÓN y del REMOLQUE no se mira nada en absoluto. Y `truck_registration`,
 *    `trailer_registration` y `annual_inspection` están declarados OBLIGATORIOS
 *    y salen con su estrella en el desplegable: una declaración que no lee
 *    ninguna puerta.
 *
 * Media promesa verdadera es peor que una entera falsa: la mitad que se cumple
 * hace creíble la que no, y quien lee la frase deja de vigilar ese vencimiento
 * a mano.
 *
 * ## Lo que este lote hace y lo que no
 *
 * HACE que las pantallas digan la verdad del tipo elegido.
 *
 * NO enciende puertas nuevas. Que el registro de un camión vencido pare una
 * carga es una decisión de producto que, el día que se tome, parará cargas en
 * cualquier empresa con un papel caducado. Eso se decide mirándolo de frente,
 * no de propina dentro de un lote de honestidad.
 *
 * ## Por qué esto se CALCULA y no se declara
 *
 * La tentación era una lista de tipos con su efecto al lado. Una lista así es
 * una segunda opinión sobre el comportamiento, y las segundas opiniones
 * divergen: el día que alguien haga que la puerta mire los camiones, la lista
 * seguiría diciendo lo de siempre y la pantalla volvería a mentir, esta vez al
 * revés.
 *
 * Así que el efecto sale de las MISMAS funciones que consulta la puerta
 * —`requiredFor()`, sobre los dueños que la puerta realmente mira—. Lo único
 * declarado a mano es `DUENOS_VIGILADOS`, y un guardián lo contrasta contra las
 * llamadas a `documentCompliance()` que hay en `Guards.php`. Si mañana aparece
 * una con `'truck'`, el guardián se pone rojo hasta que esta lista lo recoja, y
 * la copia de las dos pantallas se corrige sola.
 */
final class ExpiryEffect
{
    /** Vencer cierra la puerta de despacho. */
    public const BLOQUEA = 'blocks';

    /** Vencer se avisa, y no cierra nada. */
    public const SOLO_AVISA = 'warns';

    /**
     * Los dueños cuyos DOCUMENTOS consulta la puerta de despacho.
     *
     * Hoy es uno. No es una lista de deseos: es el reflejo de las llamadas a
     * `Guards::documentCompliance()`, y el guardián falla si deja de serlo.
     *
     * @var list<string>
     */
    public const DUENOS_VIGILADOS = ['carrier'];

    /**
     * Los dueños que NO vigila, y con qué se conforma en su lugar.
     *
     * Escrito porque un hueco sin nombre se lee como un descuido y se arregla
     * dos veces, o como una decisión y no se arregla nunca. Esto dice cuál de
     * las dos cosas es.
     *
     * @var array<string, string>
     */
    public const SIN_VIGILAR = [
        'driver' => 'La puerta mira las columnas `license_expires_at` y `medical_card_expires_at` del conductor, no sus documentos. Son dos verdades sobre la misma licencia y pueden discrepar.',
        'truck' => 'No se mira nada. `truck_registration` y `annual_inspection` están declarados obligatorios y ninguna puerta los consulta.',
        'trailer' => 'No se mira nada. `trailer_registration` está declarado obligatorio y ninguna puerta lo consulta.',
    ];

    /**
     * Qué pasa cuando vence un documento de este tipo.
     *
     * Bloquea si alguno de los dueños que la puerta VIGILA lo declara
     * obligatorio. Se pregunta por todos los dueños vigilados y no por el que
     * el catálogo le asigna, porque un tipo puede pertenecer a dos:
     * `annual_inspection` está declarado para camión y `forOwner()` lo añade
     * también a remolque.
     */
    public static function of(string $type): string
    {
        foreach (self::DUENOS_VIGILADOS as $dueno) {
            if (in_array($type, DocumentTypes::requiredFor($dueno), true)) {
                return self::BLOQUEA;
            }
        }

        return self::SOLO_AVISA;
    }

    public static function bloquea(string $type): bool
    {
        return self::of($type) === self::BLOQUEA;
    }

    /**
     * El efecto de cada tipo del catálogo, para mandárselo a una pantalla.
     *
     * Entero y no solo el del tipo elegido: el desplegable cambia sin ir al
     * servidor, y una recarga parcial por cada cambio de tipo sería un viaje
     * para leer una palabra que ya está calculada.
     *
     * @return array<string, string>
     */
    public static function map(): array
    {
        $mapa = [];

        foreach (DocumentTypes::all() as $type) {
            $mapa[$type] = self::of($type);
        }

        return $mapa;
    }
}
