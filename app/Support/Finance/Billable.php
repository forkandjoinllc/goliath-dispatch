<?php

declare(strict_types=1);

namespace App\Support\Finance;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Qué significa que una carga esté pendiente de facturar.
 *
 * Vivía dentro de `InvoiceController` como método privado. Al necesitarla
 * también el panel se saca aquí en vez de copiarla: son dos sitios que tienen
 * que dar el MISMO número, y el día que difieran, el panel dirá que hay tres
 * cargas por facturar y la pantalla de alta ofrecerá dos. Esa contradicción es
 * peor que no enseñar el dato.
 *
 * La regla, en palabras: una carga entregada que no aparece en ninguna línea de
 * ninguna factura viva. Una factura ANULADA no cuenta como facturada — anular
 * es justo lo que se hace para poder volver a facturar.
 */
final class Billable
{
    /**
     * Los estados en los que una carga se puede facturar.
     *
     * ERAN SOLO `delivered`, y eso era un fallo con la forma de una regla. El
     * ciclo de vida dice que una carga entregada avanza a `pod_received` en
     * cuanto se cuelga el comprobante firmado —el papel que se enseña para
     * cobrar—, y esa consulta la dejaba fuera. Hacer lo correcto sacaba la carga
     * de la pantalla de facturar: quien colgaba el comprobante perdía la carga
     * de vista, y quien no lo colgaba seguía pudiendo facturarla. El incentivo
     * estaba exactamente del revés.
     *
     * El literal vivía copiado en tres consultas —ésta y dos de
     * `InvoiceController`— pese al comentario de al lado que explicaba por qué
     * la mitad «ya facturada» de la regla estaba extraída aquí. La mitad de una
     * regla extraída es la mitad de una regla copiada.
     *
     * @var list<string>
     */
    public const ESTADOS = ['delivered', 'pod_received'];

    /**
     * El cuerpo de un `whereNotExists` que descarta las cargas ya facturadas.
     *
     * `$loadColumn` es la columna de la consulta de fuera que apunta a la
     * carga, con su alias: `l.id`, `loads.id`… Se pide explícita porque las dos
     * consultas que la usan alían la tabla distinto.
     */
    public static function invoicedExists(Builder $q, string $tenantId, string $loadColumn): void
    {
        $q->select(DB::raw(1))
            ->from('invoice_line_items as li')
            ->join('invoices as inv', 'inv.id', '=', 'li.invoice_id')
            ->whereColumn('li.load_id', $loadColumn)
            ->where('li.tenant_id', $tenantId)
            ->whereNull('li.deleted_at')
            ->whereNull('inv.deleted_at')
            ->where('inv.status', '!=', 'voided');
    }

    /**
     * Las cargas entregadas y sin facturar de una empresa.
     *
     * Devuelve la consulta sin ejecutar: quien llama decide si cuenta, lista o
     * la estrecha por transportista.
     */
    public static function query(string $tenantId): Builder
    {
        return DB::table('loads as l')
            ->where('l.tenant_id', $tenantId)
            ->whereNull('l.deleted_at')
            ->whereIn('l.status', self::ESTADOS)
            ->whereNotExists(fn (Builder $q) => self::invoicedExists($q, $tenantId, 'l.id'));
    }
}
