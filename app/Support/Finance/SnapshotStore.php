<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Authorization\Actor;
use App\Models\Load;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Guarda y recupera el cálculo congelado de una carga.
 *
 * `financial_snapshots` es de SOLO AÑADIR: cada versión es una fila nueva y
 * ninguna se toca después. Eso es lo que permite que una factura emitida en
 * marzo siga diciendo en octubre lo que decía, aunque entre medias se apruebe
 * un gasto o cambie la tarifa del transportista.
 *
 * Las dos caras del mismo dinero —la factura que le cobra la tarifa de despacho
 * y la liquidación que se la descuenta— tienen que usar LA MISMA instantánea. Si
 * cada una calculara la suya, la diferencia sería pequeña y constante, que es la
 * peor clase de error: nadie la ve hasta que alguien cuadra un trimestre.
 */
final class SnapshotStore
{
    /**
     * Congela el cálculo de una carga y devuelve el id de la instantánea.
     */
    public function freeze(Actor $actor, Load $load, LoadFinancials $financials, mixed $ahora): string
    {
        // La versión se calcula con la fila bloqueada: dos personas facturando a
        // la vez la misma carga no pueden escribir dos veces la versión 1.
        $version = 1 + (int) DB::table('financial_snapshots')
            ->where('tenant_id', $actor->tenantId)
            ->where('load_id', $load->id)
            ->lockForUpdate()
            ->max('version');

        $id = (string) Str::uuid();

        DB::table('financial_snapshots')->insert([
            ...$financials->toSnapshotColumns(),
            'id' => $id,
            'tenant_id' => $actor->tenantId,
            'load_id' => $load->id,
            'version' => $version,
            // Quién calculó esto y cuándo. La instantánea es la respuesta a
            // «¿de dónde salió esta cifra?», y media respuesta no sirve.
            'computed_by_user_id' => $actor->auditUserId(),
            'computed_at' => $ahora,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return $id;
    }

    /**
     * La instantánea que usó la factura VIVA de esta carga, si la hay.
     *
     * «Viva» quiere decir que la factura no está anulada. Una factura anulada no
     * ata a nada: su carga vuelve a estar por facturar y por liquidar, y lo que
     * se calcule después se calcula de nuevo.
     */
    public function usedByLiveInvoice(Actor $actor, string $loadId): ?object
    {
        $id = DB::table('invoice_line_items as li')
            ->join('invoices as inv', 'inv.id', '=', 'li.invoice_id')
            ->where('li.tenant_id', $actor->tenantId)
            ->where('li.load_id', $loadId)
            ->whereNotNull('li.financial_snapshot_id')
            ->whereNull('li.deleted_at')
            ->whereNull('inv.deleted_at')
            ->where('inv.status', '!=', 'voided')
            ->orderByDesc('li.created_at')
            ->value('li.financial_snapshot_id');

        if ($id === null) {
            return null;
        }

        return DB::table('financial_snapshots')
            ->where('tenant_id', $actor->tenantId)
            ->where('id', $id)
            ->first();
    }

    /**
     * La instantánea de un id concreto. Nunca «la última de esta carga»: una
     * instantánea posterior no puede cambiar lo que ya se liquidó.
     */
    public function byId(Actor $actor, string $id): ?object
    {
        return DB::table('financial_snapshots')
            ->where('tenant_id', $actor->tenantId)
            ->where('id', $id)
            ->first();
    }
}
