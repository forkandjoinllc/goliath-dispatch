<?php

declare(strict_types=1);

namespace App\Support\Screens;

use App\Enums\ExpenseStatus;
use App\Enums\InvoiceStatus;
use App\Enums\PaymentStatus;

/**
 * Los valores que un desplegable puede ofrecer sin mentir.
 *
 * ## El defecto
 *
 * La pantalla de comisiones ofrece cuatro estados —«Debido · Aprobado · Pagado ·
 * Anulado»— y la aplicación solo escribe dos. Nada pone una comisión en
 * `approved`: `CommissionLedger` la devenga en `accrued` y `markPaid()` la pasa
 * a `paid`. Y nada la pone en `voided`: **no hay forma de anular una comisión**,
 * así que una mal devengada solo se puede pagar o dejarla ahí para siempre.
 *
 * La de mensajes ofrece «Directo» y «Aviso general», y `Threads` —el único sitio
 * de toda la aplicación que crea conversaciones— solo crea hilos de carga.
 *
 * Elegir cualquiera de esos cuatro devuelve siempre cero filas, y la pantalla
 * dice «Ningún hilo cuadra con lo que buscas» o enseña un total de cero bajo el
 * nombre del estado: culpa al filtro de algo que es imposible. Quien lo lee
 * concluye que no hay nada en ese estado hoy, no que ese estado no existe.
 *
 * Buscando la misma forma aparecieron dos más: facturas ofrece `due` e
 * `uncollectable`, y cobros ofrece `processing` y `cancelled`. Ocho opciones
 * imposibles repartidas por cuatro pantallas. Gastos y liquidaciones están
 * enteras, y por eso están declaradas igual: una lista donde todo es alcanzable
 * es lo que demuestra que este registro mide algo.
 *
 * ## Qué es esto, y qué no
 *
 * NO dice que esos estados no debieran existir. Dice que hoy nada los produce.
 * Construir la aprobación de comisiones, la anulación o los hilos directos son
 * decisiones de producto; enseñar sus filtros antes de construirlos no lo es.
 *
 * El día que alguien escriba uno de esos valores, el guardián se pone rojo y
 * manda a mover la entrada de `NO_SE_PRODUCEN` a `PRODUCEN` — que es lo mismo
 * que devolver la opción al desplegable.
 */
final class Reachable
{
    /**
     * Lista => valor => la clase que lo escribe.
     *
     * El productor se declara y se comprueba: una lista de valores sin decir
     * quién los pone es una lista que nadie puede verificar, y el guardián
     * mira que ese símbolo escriba de verdad ese valor.
     *
     * @var array<string, array<string, string>>
     */
    public const PRODUCEN = [
        'commissions.status' => [
            'accrued' => 'App\Support\Finance\CommissionLedger',
            'paid' => 'App\Support\Finance\CommissionLedger',
        ],

        'messages.kind' => [
            'load' => 'App\Support\Messaging\Threads',
        ],

        'invoices.status' => [
            'draft' => 'App\Support\Finance\InvoiceBuilder',
            'sent' => 'App\Http\Controllers\App\InvoiceController',
            'voided' => 'App\Http\Controllers\App\InvoiceController',
            'paid' => 'App\Support\Finance\PaymentLedger',
            'overdue' => 'App\Support\Finance\PaymentLedger',
            'disputed' => 'App\Support\Finance\PaymentLedger',
        ],

        'payments.status' => [
            // Los dos que una persona elige al anotar un cobro: el formulario
            // los valida, `PaymentLedger::record()` los escribe tal cual.
            'pending' => 'App\Http\Controllers\App\InvoiceController',
            'succeeded' => 'App\Http\Controllers\App\InvoiceController',
            'failed' => 'App\Support\Finance\PaymentLedger',
            'refunded' => 'App\Support\Finance\PaymentLedger',
            'partially_refunded' => 'App\Support\Finance\PaymentLedger',
            'disputed' => 'App\Support\Finance\PaymentLedger',
        ],

        // Las dos que están enteras. Se declaran para que el registro no sea
        // solo una lista de averías: si mañana una de ellas pierde un
        // productor, esto lo dice.
        'expenses.status' => [
            'submitted' => 'App\Http\Controllers\App\ExpenseController',
            // Los tres se escriben por variable; quien decide cuáles existen es
            // el grafo de transiciones, y por eso es él quien los produce.
            'approved' => 'App\Support\Finance\ExpenseTransitions',
            'rejected' => 'App\Support\Finance\ExpenseTransitions',
            'reimbursed' => 'App\Support\Finance\ExpenseTransitions',
        ],

        // Los estados de un aviso comercial los pone una persona por la
        // pantalla, así que los cinco son alcanzables por definición: la propia
        // ruta que los valida es la que los escribe.
        'leads.status' => [
            // Un aviso nace `new` por el VALOR POR OMISIÓN de la columna: los
            // tres formularios públicos que crean uno no escriben el estado.
            // Producir tampoco es siempre una línea de PHP.
            'new' => self::POR_OMISION,
            // Los otros cuatro los elige una persona en un desplegable que
            // valida contra ESTE registro. Es circular a propósito y por eso se
            // marca: la lista que se ofrece y la que se admite son la misma, y
            // el guardián comprueba que esa ruta valide con `Rule::in`.
            'contacted' => self::FORMULARIO.'App\Http\Controllers\App\LeadController',
            'qualified' => self::FORMULARIO.'App\Http\Controllers\App\LeadController',
            'converted' => self::FORMULARIO.'App\Http\Controllers\App\LeadController',
            'lost' => self::FORMULARIO.'App\Http\Controllers\App\LeadController',
        ],

        // Las siete son alcanzables, y una de ellas no por una escritura:
        // `expired` lo DERIVA `Signatures\State` de la fecha, porque nada corre
        // a medianoche a ponerlo en las filas. Producir no es solo escribir una
        // columna — es que la pantalla pueda enseñar ese valor.
        'signatures.status' => [
            'pending' => 'App\Support\Signatures\SigningLinks',
            'viewed' => 'App\Http\Controllers\Public\SignatureController',
            'signed' => 'App\Support\Signatures\Signing',
            'declined' => 'App\Http\Controllers\Public\SignatureController',
            'expired' => 'App\Support\Signatures\State',
            'voided' => 'App\Http\Controllers\App\SignatureController',
            'superseded' => 'App\Support\Signatures\Templates',
        ],

        'settlements.status' => [
            'draft' => 'App\Support\Finance\SettlementBuilder',
            'issued' => 'App\Http\Controllers\App\SettlementController',
            'paid' => 'App\Http\Controllers\App\SettlementController',
            'voided' => 'App\Http\Controllers\App\SettlementController',
        ],
    ];

    /**
     * Lista => valor => por qué hoy no puede pasar.
     *
     * El motivo importa más que la lista: dice si falta una función o si el
     * valor sobra, y son dos deudas distintas.
     *
     * @var array<string, array<string, string>>
     */
    public const NO_SE_PRODUCEN = [
        'commissions.status' => [
            'approved' => 'No hay paso de aprobación de comisiones. `CommissionLedger::accrue()` devenga en `accrued` y `markPaid()` pasa directamente a `paid`. El estado existe en la columna —que ni siquiera tiene CHECK— y en el diccionario, y nada lo escribe.',
            'voided' => 'No hay forma de anular una comisión. Una devengada por error solo se puede pagar o dejarla ahí: no hay ruta, ni permiso, ni método que la mueva a este estado.',
        ],

        'messages.kind' => [
            'direct' => '`Messaging\Threads` es el único sitio de la aplicación que crea conversaciones —no hay otro insert sobre `conversations`— y solo crea `kind = load`. Un hilo entre personas sin carga no se puede abrir desde ningún sitio.',
            'broadcast' => 'Lo mismo: no hay forma de mandar un aviso general. La cabecera de `Threads` describe las tres clases como si las tres funcionaran.',
        ],

        'invoices.status' => [
            'due' => '`PaymentLedger::statusFor()` decide el estado de una factura y nunca devuelve `due`: una factura con saldo y sin vencer vuelve a `sent`, y vencida pasa a `overdue`. El estado está en el enum y en la columna, y ninguna rama lleva a él.',
            'uncollectable' => 'Nada marca una factura como incobrable. El valor se LEE en dos sitios —`PaymentLedger::SIN_SALDO` y la consulta de cartera— y no se escribe en ninguno: dar una deuda por perdida es una decisión contable que el producto todavía no ofrece.',
        ],

        'payments.status' => [
            'processing' => 'El formulario de anotar un cobro admite `pending` y `succeeded`, y ninguna otra ruta escribe `processing`. Es un estado de pasarela para un cobro que todavía no está atado a una.',
            'cancelled' => 'Nada cancela un cobro anotado: se reembolsa, que es otra cosa y tiene su propio estado. (`Billing\Subscriptions` sí escribe `cancelled`, pero en la suscripción del SaaS, que es otra tabla.)',
        ],
    ];

    /** El catálogo de una lista sale de su diccionario, no de un enum. */
    public const DEL_DICCIONARIO = 'diccionario';

    /**
     * Lo produce el valor por omisión de la columna, no una línea de código.
     *
     * Una fila nace en ese estado sin que nadie lo escriba. Cuenta como
     * producido —la pantalla lo va a ver— y el guardián lo comprueba contra el
     * `default` del esquema.
     */
    public const POR_OMISION = 'por omisión';

    /**
     * Lo elige una persona en un formulario que valida contra este registro.
     *
     * El prefijo de un productor así. Es circular —la lista que se ofrece es la
     * que se admite— y por eso se marca en vez de disimularlo: el guardián
     * comprueba que esa ruta valide de verdad con `Rule::in`, que es lo único
     * que impide que el círculo se abra por un lado.
     */
    public const FORMULARIO = 'formulario:';

    /**
     * Lista => de dónde sale TODO lo que esa lista puede valer.
     *
     * Tres de las seis tienen enum y CHECK en el esquema. Las otras tres
     * —comisiones, clases de hilo, liquidaciones— son un `varchar` con un valor
     * por omisión y nada más: **el esquema no las restringe**, así que el único
     * catálogo que existe es el diccionario, que es exactamente lo que la
     * pantalla puede llegar a escribir. Un valor con etiqueta y sin productor es
     * una opción que nombra un estado que no puede pasar.
     *
     * @var array<string, string>
     */
    public const CATALOGO = [
        'commissions.status' => self::DEL_DICCIONARIO,
        'messages.kind' => self::DEL_DICCIONARIO,
        'settlements.status' => self::DEL_DICCIONARIO,
        'leads.status' => self::DEL_DICCIONARIO,
        'signatures.status' => self::DEL_DICCIONARIO,
        'invoices.status' => InvoiceStatus::class,
        'payments.status' => PaymentStatus::class,
        'expenses.status' => ExpenseStatus::class,
    ];

    /**
     * Dónde vive el diccionario de las que no tienen enum.
     *
     * @var array<string, array{0: string, 1: string}> lista => [fichero, sección]
     */
    public const DICCIONARIOS = [
        'commissions.status' => ['commissions', 'status'],
        'messages.kind' => ['messages', 'kind'],
        'settlements.status' => ['settlements', 'status'],
        'leads.status' => ['leads', 'status'],
        'signatures.status' => ['signature', 'statuses'],
    ];

    /**
     * Lista => tabla y columna donde vive ese valor.
     *
     * Hace falta para comprobar lo IMPOSIBLE sin equivocarse: buscar
     * `'status' => 'voided'` por toda la aplicación encuentra el de las
     * liquidaciones y concluye que las comisiones se pueden anular. La búsqueda
     * se acota a los ficheros que tocan la tabla.
     *
     * @var array<string, array{0: string, 1: string}>
     */
    public const TABLAS = [
        'commissions.status' => ['dispatcher_commissions', 'status'],
        'messages.kind' => ['conversations', 'kind'],
        'invoices.status' => ['invoices', 'status'],
        'payments.status' => ['payments', 'status'],
        'expenses.status' => ['expenses', 'status'],
        'settlements.status' => ['carrier_settlements', 'status'],
        'leads.status' => ['leads', 'status'],
        'signatures.status' => ['signature_requests', 'status'],
    ];

    /**
     * Los valores que esta lista puede ofrecer.
     *
     * @return list<string>
     */
    public static function valores(string $lista): array
    {
        return array_keys(self::PRODUCEN[$lista] ?? []);
    }

    /** ¿Es este un valor que la lista puede encontrar? */
    public static function admite(string $lista, mixed $valor): bool
    {
        return is_string($valor) && array_key_exists($valor, self::PRODUCEN[$lista] ?? []);
    }

    /**
     * Todo lo que el esquema admite para esta lista, se produzca o no.
     *
     * Para las comprobaciones de cobertura: la suma de las dos listas tiene que
     * ser exactamente lo que el enum o el CHECK declaran, o habría un estado
     * que existe y del que este registro no dice nada.
     *
     * @return list<string>
     */
    public static function declarados(string $lista): array
    {
        return [
            ...array_keys(self::PRODUCEN[$lista] ?? []),
            ...array_keys(self::NO_SE_PRODUCEN[$lista] ?? []),
        ];
    }
}
