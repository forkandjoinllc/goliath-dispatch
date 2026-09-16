<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Authorization\Actor;
use App\Enums\AuditAction;
use App\Models\Load;
use App\Support\Audit;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Lo que gana el despachador por cada carga.
 *
 * Una casa de despacho paga a sus despachadores a comisión. El porcentaje y la
 * base vienen congelados en la carga (`dispatcher_commission_bps`,
 * `dispatcher_commission_basis`) desde que se acordó, el cálculo ya existía en
 * Calculator y la instantánea financiera ya guardaba el importe — pero nadie lo
 * ANOTABA en ningún sitio, así que no había forma de decirle a un despachador
 * cuánto se le debe.
 *
 * SE DEVENGA DESDE LA INSTANTÁNEA, NO RECALCULANDO. Volver a calcular al pagar
 * significaría que la comisión de marzo cambia si en abril alguien aprueba un
 * gasto de esa carga. El importe que se le debe a una persona no puede moverse
 * solo.
 *
 * Se devenga al FACTURAR, que es cuando la tarifa de despacho pasa a ser
 * cobrable: es el momento en que la casa gana su dinero, y por tanto en que el
 * despachador gana su parte. Que después se cobre tarde, o no se cobre, es un
 * problema del cobro y no de lo devengado.
 *
 * La idempotencia la pone el ESQUEMA: `dispatcher_commissions_snapshot_uq`
 * sobre (financial_snapshot_id, dispatcher_user_id). Anular una factura y
 * volver a emitirla sobre la misma instantánea no puede pagar dos veces.
 */
final class CommissionLedger
{
    /**
     * Anota la comisión de una carga, si tiene despachador.
     *
     * @return string|null  el id devengado, o null si no había nada que anotar
     */
    public static function accrue(
        Actor $actor,
        Load $load,
        string $snapshotId,
        LoadFinancials $financials,
        ?CarbonImmutable $at = null,
    ): ?string {
        $dispatcherId = CommissionOwner::deCarga($load);

        // Una carga sin dueño no devenga la comisión de nadie. Eso era cierto
        // y sigue siéndolo; lo que no era aceptable es que se fuera EN
        // SILENCIO mientras `Calculator` la calculaba igual y
        // `netAfterCommission` la restaba del margen.
        //
        // Ese silencio era estructural: `loads.dispatcher_user_id` solo se
        // escribía al crear la carga, y solo si quien la creaba era
        // despachador. Un administrador —que puede crear cargas y no es
        // despachador— dejaba sin dueño todo lo que metía, sin forma de
        // arreglarlo después.
        //
        // Ahora se puede asignar desde la carga, y cuando aun así no hay
        // nadie, el hecho SE ANOTA: ver `Audit::record` más abajo y
        // `docs/commission-owner.md`.
        if ($dispatcherId === null) {
            if (CommissionOwner::comisionHuerfana($load, $financials->dispatcherCommission)) {
                // Dinero restado del margen que no tiene destinatario. Queda en
                // la pista de auditoría, que es donde se contesta «¿por qué el
                // informe de marzo dice que ganamos menos y no hay comisión que
                // pagar?» seis meses después.
                Audit::record(
                    $actor,
                    AuditAction::FinancialChanged,
                    entityType: 'load',
                    entityId: (string) $load->id,
                    entityLabel: (string) $load->load_number,
                    after: [
                        'dispatcher_commission_cents' => $financials->dispatcherCommission,
                        'accrued' => false,
                        'reason' => (string) CommissionOwner::porQueNoHayDueno($load),
                    ],
                );
            }

            return null;
        }

        if ($financials->dispatcherCommission <= 0) {
            return null;
        }

        $ahora = $at ?? CarbonImmutable::now();

        // Una comisión VIVA de esta carga para esta persona, sea de la
        // instantánea que sea.
        //
        // El índice único del esquema es sobre (financial_snapshot_id,
        // dispatcher_user_id), y eso NO basta: anular una factura y volver a
        // emitirla congela una instantánea NUEVA de la misma carga, así que el
        // índice no ve el choque y el despachador cobraba DOS VECES por una
        // sola carga. Lo destapó la prueba de refacturación.
        $existente = DB::table('dispatcher_commissions')
            ->where('tenant_id', $actor->tenantId)
            ->where('load_id', $load->id)
            ->where('dispatcher_user_id', $dispatcherId)
            ->whereNull('deleted_at')
            ->where('status', '!=', 'voided')
            ->first(['id', 'status', 'amount_cents']);

        // Ya cobrada o aprobada para cobro: no se toca. Reemitir una factura no
        // puede cambiar —ni repetir— lo que ya se le pagó a alguien.
        if ($existente !== null && $existente->status !== 'accrued') {
            return null;
        }

        $cifras = [
            'financial_snapshot_id' => $snapshotId,
            // Los tres se copian de la instantánea para que la fila explique
            // POR QUÉ sale ese importe sin tener que ir a buscar nada.
            'basis' => $financials->commissionBasis->value,
            'basis_amount_cents' => $financials->commissionBasisAmount,
            'percentage_bps' => $financials->commissionBps,
            'amount_cents' => $financials->dispatcherCommission,
            'updated_at' => $ahora,
        ];

        // Devengada y todavía sin pagar: se ACTUALIZA a la instantánea nueva.
        // Si la refacturación cambió las cifras, se le debe lo nuevo; lo que no
        // puede es haber dos filas.
        if ($existente !== null) {
            if ((int) $existente->amount_cents === $financials->dispatcherCommission) {
                return null;
            }

            DB::table('dispatcher_commissions')->where('id', $existente->id)->update($cifras);

            Audit::record(
                $actor,
                AuditAction::FinancialChanged,
                entityType: 'dispatcher_commission',
                entityId: (string) $existente->id,
                entityLabel: (string) $load->load_number,
                before: ['amount_cents' => (int) $existente->amount_cents],
                after: ['amount_cents' => $financials->dispatcherCommission],
            );

            return (string) $existente->id;
        }

        $id = (string) Str::uuid();

        // insertOrIgnore por si dos peticiones llegan a la vez: el índice único
        // del esquema decide, y chocar con él no debe reventar una factura.
        $creadas = DB::table('dispatcher_commissions')->insertOrIgnore([
            'id' => $id,
            'tenant_id' => $actor->tenantId,
            'load_id' => $load->id,
            'dispatcher_user_id' => $dispatcherId,
            'status' => 'accrued',
            'created_at' => $ahora,
            ...$cifras,
        ]);

        if ($creadas === 0) {
            return null;
        }

        Audit::record(
            $actor,
            AuditAction::FinancialChanged,
            entityType: 'dispatcher_commission',
            entityId: $id,
            entityLabel: (string) $load->load_number,
            after: [
                'dispatcher_user_id' => (string) $dispatcherId,
                'amount_cents' => $financials->dispatcherCommission,
                'status' => 'accrued',
            ],
        );

        return $id;
    }

    /**
     * Marca como pagadas las comisiones indicadas.
     *
     * Solo las que estén devengadas o aprobadas: una ya pagada no se paga dos
     * veces, y una anulada no se paga nunca.
     *
     * @param  list<string>  $ids
     * @return int  cuántas se marcaron
     */
    public static function markPaid(Actor $actor, array $ids): int
    {
        if ($ids === []) {
            return 0;
        }

        $ahora = CarbonImmutable::now();

        $afectadas = DB::table('dispatcher_commissions')
            ->where('tenant_id', $actor->tenantId)
            ->whereIn('id', $ids)
            ->whereNull('deleted_at')
            // Solo `accrued`. Esto decía `['accrued', 'approved']`, y
            // `approved` es un estado que NADA escribe: no hay paso de
            // aprobación de comisiones. Una cláusula que lee un estado
            // imposible no hace daño, pero dice que existe — y la pantalla la
            // creía: ofrecía «Aprobado» en su desplegable. Ver
            // `Screens\Reachable`.
            ->where('status', 'accrued')
            ->update([
                'status' => 'paid',
                'paid_at' => $ahora,
                'updated_at' => $ahora,
            ]);

        if ($afectadas > 0) {
            Audit::record(
                $actor,
                AuditAction::FinancialChanged,
                entityType: 'dispatcher_commission',
                entityId: $ids[0],
                entityLabel: (string) count($ids),
                before: ['status' => 'accrued'],
                after: ['status' => 'paid', 'count' => $afectadas],
            );
        }

        return $afectadas;
    }
}
