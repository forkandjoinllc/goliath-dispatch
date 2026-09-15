<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Authorization\Actor;
use App\Support\Privacy\Internal;

/**
 * Qué cifras de una carga son de la casa y cuáles son del transportista.
 *
 * ## El defecto
 *
 * `load:financials:read` era una puerta de sí o no. Quien la pasaba recibía las
 * DIECINUEVE cifras del reparto, y entre ellas el margen bruto, la comisión del
 * despachador y el margen neto de la casa de despacho.
 *
 * El rol TRANSPORTISTA tiene ese permiso —con alcance propio, sobre sus cargas—
 * porque necesita ver su liquidación: su bruto, la tarifa que le cobran, lo que
 * le reembolsan y lo que le retienen. Al dárselo se le daba también el otro
 * lado de la mesa: abría su carga en el portal y leía lo que la casa le cobra al
 * cliente y cuánto gana encima de su tarifa.
 *
 * Lo que convierte esto en un defecto y no en una decisión es que **la regla ya
 * estaba escrita**, entera, en la cabecera de `LoadController`:
 *
 * > un conductor tiene `load:read` con ámbito propio y ninguna concesión
 * > financiera. Ve su carga, sus paradas y sus horas, y NO ve lo que cobra la
 * > empresa ni lo que se le paga al transportista.
 *
 * Razonada para el conductor, que está DENTRO de la operación, y nunca aplicada
 * al transportista, que es una empresa de fuera. Y está escrita una segunda vez
 * en `PeriodReport::commissionsByDispatcher()`, que devuelve lista vacía si el
 * alcance no llega a `Tenant` — el mismo fichero cuyo `byCarrier()` mandaba el
 * margen sin mirar a quién.
 *
 * ## Dónde estaba
 *
 *  - la tarjeta de dinero de la ficha de la carga (`LoadController::financials`)
 *  - la columna de cobro al cliente del listado (`LoadController::row`)
 *  - el informe del periodo: margen por transportista, cobro y margen por
 *    cliente, el total de arriba y los gastos que absorbe la casa
 *
 * ## La frontera ya tenía nombre
 *
 * `App\Support\Privacy\Internal` la dice entera, y no de pasada:
 *
 * > No es un permiso: es de qué lado de la mesa está quien mira. El equipo de la
 * > casa de despacho escribe estas notas; el transportista y el conductor son la
 * > otra parte. Un permiso se puede conceder; el lado de la mesa no.
 *
 * Esa pieza se escribió para DOS CAMPOS DE TEXTO —las notas del transportista y
 * las notas internas de la carga— y cita el bloque de dinero como su precedente
 * de que un dato no se manda escondido. El dinero, que es el secreto más grande
 * de los tres, nunca le hizo la pregunta.
 *
 * Así que aquí no se inventa una frontera: se le pregunta a la que ya existe.
 * Se decide por ROL y no por alcance por la misma razón que está escrita allí —
 * un rol nuevo tiene que obligar a decidir, y un `match` sin `default` revienta
 * hasta que alguien decide.
 *
 * Las dos listas de abajo son exhaustivas a propósito: el guardián comprueba que
 * su unión es EXACTAMENTE lo que produce `financials()`. Una cifra nueva hay que
 * clasificarla o la suite se pone en rojo — que es lo contrario de lo que pasó
 * aquí, donde la cifra nueva se colaba por omisión.
 */
final class MoneyAudience
{
    /** La casa de despacho: sus empleados. */
    public const CASA = 'casa';

    /** La empresa de fuera que pone el camión. */
    public const TRANSPORTISTA = 'transportista';

    /**
     * Cifras que son del transportista, y por qué.
     *
     * La prueba es sencilla: ¿sale este número en su liquidación, o la
     * determina? Si la respuesta es sí, esconderlo sería pedirle que firme una
     * cuenta que no puede comprobar.
     *
     * @var array<string, string>
     */
    public const DEL_TRANSPORTISTA = [
        'carrierGrossRate' => 'Su tarifa bruta. Es lo que se pactó con él.',
        'excludedExpenses' => 'Lo que sale de la base de su porcentaje. Baja lo que se le cobra: verlo le conviene a él.',
        'commissionableBase' => 'La base sobre la que se calcula la tarifa de despacho que paga.',
        'feeBase' => 'Sobre qué se calcula esa tarifa. Sin esto, el porcentaje no se puede comprobar.',
        'dispatchFeeBps' => 'El porcentaje que le cobra la casa. Está en su contrato.',
        'dispatchFee' => 'El importe de esa tarifa. Es la factura que se le emite a él.',
        'reimbursableExpenses' => 'Lo que se le devuelve. Sube su liquidación.',
        'carrierDeductions' => 'Lo que se le retiene. Baja su liquidación.',
        'netCarrierSettlement' => 'Lo que cobra. El total de todo lo anterior.',
    ];

    /**
     * Cifras que solo son de la casa, y por qué no son de él.
     *
     * `customerCharge` es la que depende del negocio y no del código: en una
     * casa que corretea —compra al cliente y vende al transportista— el
     * diferencial es el número mejor guardado del sector; en una de servicio de
     * despacho puro, donde el transportista es el dueño del cliente, sería suyo.
     * Se esconde, que es la decisión que no se puede deshacer al revés: lo que
     * se enseña una vez, enseñado está. Abrirlo es quitar esta línea.
     *
     * @var array<string, string>
     */
    public const SOLO_LA_CASA = [
        'customerCharge' => 'Lo que la casa le cobra al cliente. El diferencial contra su tarifa es el margen del corretaje.',
        'tenantAbsorbedExpenses' => 'Gastos que paga la casa de su bolsillo. No tocan su liquidación.',
        'grossMargin' => 'Tarifa de despacho menos lo absorbido: el resultado de la casa en esta carga.',
        'commissionBps' => 'El porcentaje que la casa le paga a su propio despachador.',
        'commissionBasis' => 'Sobre qué se lo paga. Nómina de la casa.',
        'dispatcherCommission' => 'Lo que gana un empleado de la casa por esta carga.',
        'netMargin' => 'El resultado después de esa comisión.',
        'commissionOwner' => 'Qué empleado de la casa la gana.',
        'commissionOwnerMissing' => 'Por qué no la gana nadie. Asunto interno.',
        'commissionOrphaned' => 'Que la casa se está restando del margen una comisión sin destinatario.',
    ];

    /**
     * Columnas del informe del periodo que solo son de la casa.
     *
     * Van aparte porque el informe agrega y no reparte: sus nombres no son los
     * de `LoadFinancials` y la pregunta se contesta sobre el total, no sobre una
     * carga.
     *
     * @var array<string, string>
     */
    public const INFORME_SOLO_LA_CASA = [
        'marginCents' => 'El margen bruto de la casa, sumado.',
        'chargeCents' => 'Lo cobrado al cliente, sumado.',
    ];

    /**
     * Tratamientos de gasto cuyo total solo es de la casa.
     *
     * Los otros tres mueven la liquidación del transportista; este sale del
     * bolsillo de la casa y decirle cuánto lleva absorbido es decirle su margen
     * por la puerta de atrás.
     *
     * @var array<string, string>
     */
    public const TRATAMIENTOS_SOLO_LA_CASA = [
        'tenant_absorbed' => 'Lo que la casa se come. No toca su liquidación.',
    ];

    /**
     * De qué lado de la mesa mira este actor.
     *
     * La pregunta no se contesta aquí: se le pasa a `Internal::esEquipo()`, que
     * es donde vive desde el lote de las notas internas. Dos sitios contestando
     * «¿es de la casa?» acabarían contestando distinto, y el día que eso pase lo
     * que se descuadra es quién ve un margen.
     */
    public static function de(Actor $actor): string
    {
        return Internal::esEquipo($actor) ? self::CASA : self::TRANSPORTISTA;
    }

    /** ¿Puede este actor ver esta cifra? */
    public static function ve(Actor $actor, string $cifra): bool
    {
        return self::de($actor) === self::CASA
            || ! array_key_exists($cifra, self::SOLO_LA_CASA);
    }

    /**
     * Quita de un reparto las cifras que este alcance no puede ver.
     *
     * QUITA la clave, no la pone a null. Es la misma decisión que ya toma
     * `LoadController::show()` con el bloque entero —«no se manda, no se
     * esconde»—: una clave con null todavía dice que el dato existe y que
     * alguien decidió no dártelo. Ausente no dice nada.
     *
     * @param  array<string, mixed>  $cifras
     * @return array<string, mixed>
     */
    public static function filtra(array $cifras, Actor $actor): array
    {
        if (self::de($actor) === self::CASA) {
            return $cifras;
        }

        return array_diff_key($cifras, self::SOLO_LA_CASA);
    }

    /**
     * Quita del desglose de gastos los tratamientos que no son suyos.
     *
     * @param  array<string, int>  $totales
     * @return array<string, int>
     */
    public static function filtraTratamientos(array $totales, Actor $actor): array
    {
        if (self::de($actor) === self::CASA) {
            return $totales;
        }

        return array_diff_key($totales, self::TRATAMIENTOS_SOLO_LA_CASA);
    }

    /**
     * Lo mismo para una fila del informe.
     *
     * @param  array<string, mixed>  $fila
     * @return array<string, mixed>
     */
    public static function filtraInforme(array $fila, Actor $actor): array
    {
        if (self::de($actor) === self::CASA) {
            return $fila;
        }

        return array_diff_key($fila, self::INFORME_SOLO_LA_CASA);
    }
}
