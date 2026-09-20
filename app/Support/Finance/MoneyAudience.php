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
     * Cifras del informe cuyo NOMBRE cambia según de qué lado se mire.
     *
     * ## El defecto que las trajo
     *
     * `/informes` le decía a un transportista «Pendiente de cobro — qué le
     * siguen debiendo». Esa cifra sale de `invoices`, y en esta aplicación
     * `invoices.carrier_id` es **a quién se le cobra**: la factura de la tarifa
     * de despacho, que el transportista PAGA. Con alcance de transportista,
     * `PeriodReport` estrecha por esa columna, así que el número más grande de
     * la pantalla salía con el signo cambiado, y con él los cinco tramos de
     * antigüedad.
     *
     * No era un descuido de quien no pensó en esta audiencia: `filtraInforme()`
     * ya le esconde a ese mismo espectador el margen y lo cobrado al cliente, y
     * el diccionario ya tiene un `basisCarrier` que dice «la tarifa de despacho
     * QUE SE LE COBRA». Estaba pensado y quedó a medias — se arregló lo que
     * había que esconder y no lo que había que renombrar.
     *
     * ## Por qué renombrar y no esconder
     *
     * Porque el dato es suyo y le sirve: lo que debe, y desde cuándo. Esconderlo
     * dejaría la pantalla más pobre y además contradiría `basisCarrier`, que le
     * promete «lo suyo». Lo que no puede es llamarse igual para los dos lados.
     *
     * @var array<string, string>
     */
    public const INFORME_CAMBIA_DE_LADO = [
        'outstandingCents' => 'La casa lo cobra y el transportista lo paga: la misma factura es cartera para una y deuda para el otro.',
    ];

    /**
     * Cifras del informe que dicen lo mismo para los dos lados.
     *
     * Se declaran, aunque no haya nada que hacer con ellas, porque el guardián
     * exige que TODA cifra del informe esté clasificada: escondida, cambiada de
     * lado o igual. Sin esta tercera lista, una cifra nueva no estaría en
     * ninguna y el guardián callaría — que es como entró la de arriba.
     *
     * @var array<string, string>
     */
    public const INFORME_IGUAL_PARA_LOS_DOS = [
        'id' => 'De quién es la fila. No es una cifra.',
        'name' => 'Cómo se llama esa empresa. No es una cifra.',
        'feeCents' => 'La tarifa de despacho facturada. Facturada es facturada: la emite una y la recibe el otro, y el rótulo no afirma dirección.',
        'loads' => 'Cuántas cargas se facturaron. Un recuento no tiene lado.',
        'grossCents' => 'La tarifa bruta pactada con el transportista. Es la misma cifra y el mismo nombre para quien la paga y para quien la cobra.',
        'netCents' => 'Lo que se le liquida al transportista después de la tarifa de despacho. Se llama igual mirándolo desde cualquiera de los dos lados.',
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
    /**
     * Cómo se clasifica cada cifra del informe.
     *
     * Devuelve `esconder`, `cambia` o `igual` para una cifra conocida, y null
     * para una que nadie ha clasificado — que es lo que el guardián busca.
     */
    public static function claseDeInforme(string $cifra): ?string
    {
        if (array_key_exists($cifra, self::INFORME_SOLO_LA_CASA)) {
            return 'esconder';
        }

        if (array_key_exists($cifra, self::INFORME_CAMBIA_DE_LADO)) {
            return 'cambia';
        }

        if (array_key_exists($cifra, self::INFORME_IGUAL_PARA_LOS_DOS)) {
            return 'igual';
        }

        return null;
    }

    public static function filtraInforme(array $fila, Actor $actor): array
    {
        if (self::de($actor) === self::CASA) {
            return $fila;
        }

        return array_diff_key($fila, self::INFORME_SOLO_LA_CASA);
    }
}
