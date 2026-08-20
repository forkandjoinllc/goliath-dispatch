<?php

declare(strict_types=1);

namespace App\Support\Loads;

use App\Enums\LoadStatus;
use App\Models\Load;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Lo que impide un cambio de estado aunque el grafo y el permiso lo permitan.
 *
 * La diferencia con Transitions importa y conviene tenerla clara:
 *
 *  - Transitions responde «¿es legal este paso?» — una pregunta sobre el ciclo
 *    de vida, que no cambia nunca.
 *  - Guards responde «¿está esta carga en condiciones de darlo?» — una pregunta
 *    sobre el mundo, que cambia sola: un seguro vence a medianoche sin que nadie
 *    toque nada, y una carga que se podía despachar ayer no se puede hoy.
 *
 * Por eso se comprueban en el momento del cambio y no al guardar la carga.
 *
 * La puerta que de verdad importa es la de despachar. Es el instante en que un
 * camión sale a la carretera con nuestra orden, y si ese camión lleva el seguro
 * vencido o el conductor la licencia caducada, el problema deja de ser
 * administrativo. Todo lo demás del sistema es papeleo comparado con esto.
 */
final class Guards
{
    /**
     * @return list<string> claves de motivo por las que NO se puede. Vacío = adelante.
     */
    public static function blocking(Load $load, string $action): array
    {
        return match ($action) {
            'available' => self::forPublish($load),
            'assigned' => self::forAssign($load),
            'dispatched' => self::forDispatch($load),
            'pod_received' => self::forPod($load),
            default => [],
        };
    }

    /** @return list<string> */
    private static function forPublish(Load $load): array
    {
        $stops = DB::table('load_stops')
            ->where('load_id', $load->id)
            ->whereNull('deleted_at')
            ->selectRaw("
                sum(stop_type = 'pickup') as pickups,
                sum(stop_type = 'delivery') as deliveries
            ")
            ->first();

        $blocking = [];

        // Una carga sin recogida o sin entrega no es una carga, es una nota.
        // Publicarla haría que un transportista se comprometiera con algo que
        // nadie sabe dónde empieza.
        if ((int) ($stops->pickups ?? 0) === 0) {
            $blocking[] = 'noPickup';
        }

        if ((int) ($stops->deliveries ?? 0) === 0) {
            $blocking[] = 'noDelivery';
        }

        if ((int) $load->customer_charge_cents === 0) {
            $blocking[] = 'noCustomerCharge';
        }

        return $blocking;
    }

    /** @return list<string> */
    private static function forAssign(Load $load): array
    {
        if ($load->carrier_id === null) {
            return ['noCarrier'];
        }

        return self::carrierCompliance($load->carrier_id);
    }

    /**
     * La puerta grande.
     *
     * @return list<string>
     */
    private static function forDispatch(Load $load): array
    {
        $blocking = [];

        if ($load->carrier_id === null) {
            return ['noCarrier'];
        }

        $blocking = [...$blocking, ...self::carrierCompliance($load->carrier_id)];

        // Tarifa acordada. Despachar sin ella deja a las dos partes discutiendo
        // el precio con la carga ya en la carretera, que es el peor momento.
        if ((int) $load->carrier_gross_rate_cents === 0) {
            $blocking[] = 'noCarrierRate';
        }

        $assignments = DB::table('load_assignments')
            ->where('load_id', $load->id)
            ->whereNull('deleted_at')
            ->whereNull('unassigned_at')
            ->get(['truck_id', 'driver_id']);

        if ($assignments->whereNotNull('truck_id')->isEmpty()) {
            $blocking[] = 'noTruck';
        }

        $driverIds = $assignments->pluck('driver_id')->filter()->unique()->all();

        if ($driverIds === []) {
            $blocking[] = 'noDriver';
        } else {
            $blocking = [...$blocking, ...self::driverCompliance($driverIds)];
        }

        // Sobredimensión: el permiso tiene que estar aprobado por una persona.
        // No basta con que exista una fila en `permits` — alguien con el permiso
        // `permit:approve` tiene que haber dicho que la ruta es transitable con
        // esas medidas. Es la diferencia entre tener el papel y haberlo leído.
        if ((bool) $load->is_oversize && $load->permit_ready_approved_at === null) {
            $blocking[] = 'permitNotApproved';
        }

        return $blocking;
    }

    /** @return list<string> */
    private static function forPod(Load $load): array
    {
        // Marcar «comprobante recibido» sin documento adjunto vaciaría de sentido
        // el estado: es justo el papel que se le enseña al cliente para cobrar.
        $hasPod = DB::table('load_documents as ld')
            ->join('documents as d', 'd.id', '=', 'ld.document_id')
            ->where('ld.load_id', $load->id)
            ->whereNull('ld.deleted_at')
            ->whereNull('d.deleted_at')
            ->where('d.document_type', 'proof_of_delivery')
            ->exists();

        return $hasPod ? [] : ['noPodDocument'];
    }

    /** @return list<string> */
    private static function carrierCompliance(string $carrierId): array
    {
        $carrier = DB::table('carriers')->where('id', $carrierId)->first([
            'onboarding_status', 'fmcsa_status',
        ]);

        if ($carrier === null) {
            return ['noCarrier'];
        }

        $blocking = [];

        if ($carrier->onboarding_status !== 'approved') {
            $blocking[] = 'carrierNotApproved';
        }

        // Documentos obligatorios vencidos. El seguro es el caso real: vence a
        // medianoche y nadie se entera hasta que hay un siniestro.
        $expired = DB::table('documents')
            ->where('owner_type', 'carrier')
            ->where('owner_id', $carrierId)
            ->whereNull('deleted_at')
            ->where('is_required', true)
            ->whereNotNull('expiration_date')
            ->whereDate('expiration_date', '<', CarbonImmutable::now()->toDateString())
            ->exists();

        if ($expired) {
            $blocking[] = 'carrierDocumentExpired';
        }

        return $blocking;
    }

    /**
     * @param  list<string>  $driverIds
     * @return list<string>
     */
    private static function driverCompliance(array $driverIds): array
    {
        $today = CarbonImmutable::now()->toDateString();

        $bad = DB::table('drivers')
            ->whereIn('id', $driverIds)
            ->whereNull('deleted_at')
            ->where(function ($q) use ($today): void {
                $q->whereDate('license_expires_at', '<', $today)
                    // La tarjeta médica es tan obligatoria como la licencia y se
                    // olvida el doble de veces, porque caduca cada dos años y no
                    // cada cinco.
                    ->orWhereDate('medical_card_expires_at', '<', $today)
                    ->orWhere('status', 'inactive');
            })
            ->exists();

        return $bad ? ['driverNotCompliant'] : [];
    }

    /**
     * ¿Puede esta carga llegar a despacharse hoy, sin intentarlo?
     *
     * Para pintar el aviso en la ficha antes de que alguien pulse el botón y se
     * lleve el rechazo. La misma función, para que la pantalla no pueda decir
     * una cosa y el servidor otra.
     *
     * @return list<string>
     */
    public static function dispatchReadiness(Load $load): array
    {
        return $load->status === LoadStatus::Assigned ? self::forDispatch($load) : [];
    }
}
