<?php

declare(strict_types=1);

namespace App\Support\Loads;

use App\Enums\LoadStatus;
use App\Support\Finance\Billable;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Los dos últimos estados de una carga los escribe finanzas, y solo finanzas.
 *
 * EL FALLO QUE ESTA CLASE CIERRA
 *
 * `Transitions` declaraba `invoiced` y `paid` como acciones de pantalla, encima
 * de un comentario que decía —literalmente— «facturar no es un cambio de estado
 * a mano: lo hace el dominio de finanzas al emitir la factura». Las dos frases
 * no podían ser ciertas a la vez, y la que mandaba era la línea de código: la
 * ficha de carga enseñaba un botón «Facturada» que no comprobaba nada. Un
 * despachador con permiso de facturación marcaba una carga como facturada sin
 * que existiera ni una factura, y como cobrada sin que existiera ni un cobro.
 *
 * Y al revés: emitir una factura de verdad NO movía la carga. Las dos mitades
 * del sistema no se hablaban justo en la costura donde está el dinero. El
 * resultado se veía sin buscarlo: la ficha decía «Facturada» y el panel seguía
 * contando esa misma carga en «pendientes de facturar», porque el panel
 * pregunta por líneas de factura vivas —{@see Billable}— y la ficha leía una
 * columna que había escrito una persona. Dos pantallas de la misma aplicación
 * diciendo cosas distintas del mismo dinero.
 *
 * DÓNDE VIVE EL HECHO
 *
 * En las líneas de factura, como siempre. `InvoiceBuilder` ya lo decía y sigue
 * siendo cierto: una carga está facturada si aparece en la línea de una factura
 * viva, y anular la factura la devuelve al montón de lo facturable. Esta clase
 * NO inventa una segunda verdad: pregunta a `Billable` —la misma consulta que
 * usa el panel— y se limita a PROYECTAR la respuesta sobre `loads.status`.
 *
 * Lo que hacía peligrosa a la columna paralela era tener varios escritores y
 * ninguna vuelta atrás. Aquí hay un escritor y hay vuelta atrás: anular una
 * factura devuelve la carga a `pod_received`. Esa arista es la que convierte la
 * proyección en algo que se puede sostener.
 *
 * POR QUÉ `source` DEJA DE SER DECORATIVO
 *
 * `load_status_history.source` admite cuatro valores desde el primer esquema y
 * el único que se escribía era `'user'`, en el único sitio que insertaba filas.
 * La ficha de carga ya traía la rama para pintar el origen «solo cuando NO fue
 * una persona» — una rama inalcanzable durante toda la vida del proyecto. Los
 * movimientos de esta clase son los primeros que no los hace nadie a mano, y
 * por eso son los primeros que escriben `'system_job'`.
 *
 * `actor_user_id` se conserva de todas formas cuando se sabe. Que el paso lo
 * diera el sistema no borra que alguien emitió la factura que lo provocó, y esa
 * es la pregunta que se hace quien audita.
 */
final class BillingState
{
    /**
     * El origen que se escribe en el historial. No es `'user'` porque nadie
     * pulsó nada para que la carga avanzara: avanzó como consecuencia.
     */
    public const ORIGEN = 'system_job';

    /**
     * Emitida la factura, las cargas que cubre pasan a `invoiced`.
     *
     * Avanzan desde los DOS estados facturables, no solo desde `pod_received`.
     * La primera versión de este método exigía `pod_received` y el sembrador lo
     * dejó en evidencia en cuanto corrió: tres cargas entregadas entraban en
     * una factura de verdad y se quedaban diciendo «Entregada». La misma
     * contradicción que este lote quita, vista desde el otro lado.
     *
     * Sí, saltarse `pod_received` es saltarse un paso de la cadena. Pero el
     * paso que se salta es «llegó el comprobante firmado», y no llegó: forzarlo
     * para que la cadena quedara bonita habría escrito en el historial que un
     * papel apareció el día que se emitió la factura. La fila dice
     * `delivered → invoiced` porque eso es lo que pasó, y quien lea el
     * historial verá que se facturó sin comprobante, que es justo lo que
     * tiene que ver.
     *
     * @param  list<string>  $loadIds
     * @return int cuántas cargas se movieron
     */
    public static function alFacturar(
        string $tenantId,
        string $invoiceId,
        array $loadIds,
        CarbonImmutable $ahora,
        ?string $actorUserId = null,
    ): int {
        $referencia = self::numeroDeFactura($invoiceId);
        $movidas = 0;

        foreach ($loadIds as $loadId) {
            foreach (Billable::ESTADOS as $origen) {
                $movidas += self::mover(
                    $tenantId, $loadId,
                    desde: LoadStatus::from($origen),
                    hasta: LoadStatus::Invoiced,
                    referencia: $referencia,
                    ahora: $ahora,
                    actorUserId: $actorUserId,
                );
            }
        }

        return $movidas;
    }

    /**
     * Pone las cargas de una factura al día con lo que esa factura ha cobrado.
     *
     * En los dos sentidos, y ésa es la parte que importa. Saldada, sus cargas
     * pasan a `paid`; si un reembolso la vuelve a abrir, las cargas vuelven a
     * `invoiced`. Un método que solo supiera avanzar habría dejado cargas
     * diciendo «Cobrada» encima de una factura que vuelve a deber —la misma
     * mentira que este lote quita, con otro disfraz.
     *
     * Una carga no se da por cobrada mientras le quede viva UNA factura sin
     * saldar. En la práctica cada carga vive en una sola factura —`Billable`
     * descarta las ya facturadas—, pero el día que eso deje de ser cierto la
     * regla tiene que ser la estricta: es la misma razón por la que un pago
     * parcial no cierra una factura.
     *
     * SE LLAMA DESDE UN SOLO SITIO: `PaymentLedger::resync()`, que es quien
     * mueve el saldo de una factura. Colgaba de dos, porque durante un tiempo
     * hubo dos escritores —el segundo, por la vía de la pasarela, se saltaba
     * las protecciones del primero y podía marcar pagada una factura anulada—.
     * Ya no: el de la pasarela llama a éste.
     *
     * @return int cuántas cargas se movieron
     */
    public static function sincronizarCobro(string $tenantId, string $invoiceId, CarbonImmutable $ahora): int
    {
        $referencia = self::numeroDeFactura($invoiceId);
        $movidas = 0;

        foreach (self::cargasDeLaFactura($tenantId, $invoiceId) as $loadId) {
            if (self::quedaFacturaSinSaldar($tenantId, $loadId)) {
                // Vuelta atrás: la carga estaba cobrada y alguna de sus facturas
                // ha dejado de estarlo.
                $movidas += self::mover(
                    $tenantId, $loadId,
                    desde: LoadStatus::Paid,
                    hasta: LoadStatus::Invoiced,
                    referencia: $referencia,
                    ahora: $ahora,
                    actorUserId: null,
                );

                continue;
            }

            $movidas += self::mover(
                $tenantId, $loadId,
                desde: LoadStatus::Invoiced,
                hasta: LoadStatus::Paid,
                referencia: $referencia,
                ahora: $ahora,
                actorUserId: null,
            );
        }

        return $movidas;
    }

    /**
     * Anulada la factura, las cargas vuelven a `pod_received`.
     *
     * Es la única arista del ciclo de vida que va hacia atrás, y existe porque
     * anular es justo lo que se hace para poder volver a facturar. Sin ella la
     * carga se quedaría diciendo «Facturada» para siempre mientras el panel la
     * vuelve a ofrecer como pendiente — que es exactamente la contradicción que
     * esta clase existe para no tener.
     *
     * Una carga que ya está `paid` NO vuelve: no se puede anular una factura
     * cobrada —`InvoiceController::void` lo impide— y si alguna vez se pudiera,
     * deshacer un cobro es un abono, que es otra cosa y vive en finanzas.
     *
     * A DÓNDE vuelve no está escrito aquí: se lee del historial. La carga
     * regresa al estado del que la sacó ESTA factura, que puede ser `delivered`
     * o `pod_received` según tuviera el comprobante colgado o no. Un destino
     * fijo habría inventado un comprobante que nunca llegó —o borrado uno que
     * sí— en la única tabla del sistema a la que la gente acude cuando ya no se
     * fía de las demás.
     *
     * @return int cuántas cargas se movieron
     */
    public static function alAnular(string $tenantId, string $invoiceId, CarbonImmutable $ahora): int
    {
        $referencia = self::numeroDeFactura($invoiceId);
        $movidas = 0;

        foreach (self::cargasDeLaFactura($tenantId, $invoiceId) as $loadId) {
            // Si otra factura viva sigue cubriendo la carga, sigue facturada.
            if (self::estaFacturada($tenantId, $loadId)) {
                continue;
            }

            $vuelta = self::deDondeVino($tenantId, $loadId, $referencia);

            if ($vuelta === null) {
                continue;
            }

            $movidas += self::mover(
                $tenantId, $loadId,
                desde: LoadStatus::Invoiced,
                hasta: $vuelta,
                referencia: $referencia,
                ahora: $ahora,
                actorUserId: null,
            );
        }

        return $movidas;
    }

    /**
     * El estado del que esta factura sacó a esta carga, según el historial.
     *
     * Nulo cuando no hay tal fila: una carga que llegó a `invoiced` por otro
     * camino —datos de antes de este lote, una carga tocada a mano en la base—
     * no se mueve. Adivinar el origen sería escribir en el historial algo que
     * nadie presenció.
     */
    private static function deDondeVino(string $tenantId, string $loadId, ?string $referencia): ?LoadStatus
    {
        $fila = DB::table('load_status_history')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->where('source', self::ORIGEN)
            ->where('source_reference', $referencia)
            ->where('to_status', LoadStatus::Invoiced->value)
            ->orderByDesc('occurred_at')
            ->value('from_status');

        return $fila === null ? null : LoadStatus::tryFrom((string) $fila);
    }

    /**
     * ¿Aparece esta carga en la línea de alguna factura viva?
     *
     * La MISMA pregunta que se hace el panel, hecha con la MISMA consulta.
     * Reimplementarla aquí habría creado la segunda definición que
     * {@see Billable} existe para no tener.
     */
    public static function estaFacturada(string $tenantId, string $loadId): bool
    {
        return DB::table('loads as l')
            ->where('l.id', $loadId)
            ->where('l.tenant_id', $tenantId)
            ->whereExists(fn ($q) => Billable::invoicedExists($q, $tenantId, 'l.id'))
            ->exists();
    }

    /** ¿Le queda a esta carga alguna factura viva sin saldar? */
    private static function quedaFacturaSinSaldar(string $tenantId, string $loadId): bool
    {
        return DB::table('invoice_line_items as li')
            ->join('invoices as inv', 'inv.id', '=', 'li.invoice_id')
            ->where('li.load_id', $loadId)
            ->where('li.tenant_id', $tenantId)
            ->whereNull('li.deleted_at')
            ->whereNull('inv.deleted_at')
            ->where('inv.status', '!=', 'voided')
            ->where('inv.status', '!=', 'paid')
            ->exists();
    }

    /** @return list<string> */
    private static function cargasDeLaFactura(string $tenantId, string $invoiceId): array
    {
        return DB::table('invoice_line_items')
            ->where('invoice_id', $invoiceId)
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at')
            ->whereNotNull('load_id')
            ->distinct()
            ->pluck('load_id')
            ->map(static fn ($id): string => (string) $id)
            ->all();
    }

    private static function numeroDeFactura(string $invoiceId): ?string
    {
        $numero = DB::table('invoices')->where('id', $invoiceId)->value('invoice_number');

        return $numero === null ? null : (string) $numero;
    }

    /**
     * El único sitio del sistema que escribe `invoiced` o `paid` en una carga.
     *
     * Comprueba el estado de partida DENTRO del UPDATE —`where status = desde`—
     * y no antes: dos facturas emitidas a la vez sobre la misma carga no pueden
     * escribir dos filas de historial contando el mismo salto dos veces.
     */
    private static function mover(
        string $tenantId,
        string $loadId,
        LoadStatus $desde,
        LoadStatus $hasta,
        ?string $referencia,
        CarbonImmutable $ahora,
        ?string $actorUserId,
    ): int {
        $afectadas = DB::table('loads')
            ->where('id', $loadId)
            ->where('tenant_id', $tenantId)
            ->where('status', $desde->value)
            ->whereNull('deleted_at')
            ->update(['status' => $hasta->value, 'updated_at' => $ahora]);

        if ($afectadas === 0) {
            return 0;
        }

        DB::table('load_status_history')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'load_id' => $loadId,
            'from_status' => $desde->value,
            'to_status' => $hasta->value,
            'actor_user_id' => $actorUserId,
            'source' => self::ORIGEN,
            'source_reference' => $referencia,
            'occurred_at' => $ahora,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return 1;
    }
}
