<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Models\Load;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Poner transportista, camión, remolque y conductor en una carga.
 *
 * Vive aparte de LoadController porque son actos con permisos distintos
 * —`load:assign_carrier` y `load:assign_resources`— y con reglas propias que no
 * tienen nada que ver con editar la mercancía.
 *
 * La regla que manda: **el servidor rechaza un recurso que no está en
 * condiciones, y dice cuál y por qué.** Que el selector no lo ofrezca es una
 * comodidad; que el servidor lo rechace es lo que impide que un camión salga con
 * un conductor sin licencia. Una petición a mano se salta el selector.
 */
final class LoadAssignmentController
{
    /**
     * Elegir transportista.
     *
     * Aquí se CONGELA su tarifa de despacho en la carga. Es el momento en que se
     * pacta, y a partir de ahí la carga liquida con ese número aunque mañana se
     * le cambie el porcentaje al transportista. Sin esto, subirle la tarifa a
     * alguien reescribiría hacia atrás lo que ya se había acordado.
     */
    public function carrier(
        Request $request,
        string $load,
        CurrentActor $current,
        PermissionChecker $checker,
    ): RedirectResponse {
        $actor = $current->require();
        $model = Load::query()->findOrFail($load);
        $context = $this->context($model);

        $checker->authorize($actor, 'load:assign_carrier', $context, $current->policy());

        $data = $request->validate([
            'carrier_id' => ['required', 'string', 'size:36'],
            'carrier_gross_rate_cents' => ['required', 'integer', 'min:0', 'max:99999999999'],
        ]);

        $carrier = DB::table('carriers')
            ->where('tenant_id', $model->tenant_id)
            ->where('id', $data['carrier_id'])
            ->whereNull('deleted_at')
            ->first(['id', 'legal_name', 'onboarding_status', 'dispatch_fee_bps']);

        if ($carrier === null) {
            throw ValidationException::withMessages([
                'carrier_id' => __('loads.assign.carrierNotFound'),
            ]);
        }

        if ($carrier->onboarding_status !== 'approved') {
            throw ValidationException::withMessages([
                'carrier_id' => __('loads.assign.carrierNotApproved', [
                    'name' => $carrier->legal_name,
                ]),
            ]);
        }

        // La carga ya salió: cambiar de transportista a estas alturas no es una
        // corrección, es otra carga. `carrier_locked_at` existe justo para esto.
        if ($model->carrier_locked_at !== null) {
            throw ValidationException::withMessages([
                'carrier_id' => __('loads.assign.carrierLocked'),
            ]);
        }

        $before = ['carrier_id' => $model->carrier_id, 'rate' => (int) $model->carrier_gross_rate_cents];

        DB::transaction(function () use ($model, $carrier, $data, $actor, $before): void {
            $model->carrier_id = $carrier->id;
            $model->carrier_gross_rate_cents = $data['carrier_gross_rate_cents'];
            $model->carrier_dispatch_fee_bps = (int) $carrier->dispatch_fee_bps;
            $model->save();

            DB::table('audit_events')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $model->tenant_id,
                'actor_user_id' => $actor->auditUserId(),
                'action' => 'financial.changed',
                'entity_type' => 'load',
                'entity_id' => $model->id,
                'before_summary' => json_encode($before),
                'after_summary' => json_encode([
                    'carrier_id' => $carrier->id,
                    'rate' => (int) $data['carrier_gross_rate_cents'],
                    'dispatch_fee_bps' => (int) $carrier->dispatch_fee_bps,
                ]),
                'created_at' => now(),
            ]);
        });

        return back()->with('success', __('loads.assign.carrierDone', [
            'name' => $carrier->legal_name,
        ]));
    }

    /**
     * Poner o quitar un camión, un remolque o un conductor.
     *
     * El cumplimiento se comprueba AQUÍ, no solo al despachar. Descubrir que el
     * conductor no vale en el momento de despachar —con el camión ya esperando—
     * es tarde; descubrirlo al asignarlo deja tiempo de buscar otro.
     */
    public function resource(
        Request $request,
        string $load,
        CurrentActor $current,
        PermissionChecker $checker,
    ): RedirectResponse {
        $actor = $current->require();
        $model = Load::query()->findOrFail($load);
        $context = $this->context($model);

        $checker->authorize($actor, 'load:assign_resources', $context, $current->policy());

        $data = $request->validate([
            'resource_type' => ['required', 'in:truck,trailer,driver'],
            'resource_id' => ['required', 'string', 'size:36'],
        ]);

        if ($model->carrier_id === null) {
            throw ValidationException::withMessages([
                'resource_id' => __('loads.assign.needsCarrierFirst'),
            ]);
        }

        $problem = $this->checkResource($model, $data['resource_type'], $data['resource_id']);

        if ($problem !== null) {
            throw ValidationException::withMessages(['resource_id' => $problem]);
        }

        $column = "{$data['resource_type']}_id";

        DB::transaction(function () use ($model, $data, $column, $actor): void {
            // Uno vivo por tipo. Sustituir el conductor de una carga es lo
            // normal —se pone enfermo— y el anterior queda marcado como
            // retirado, no borrado: el historial tiene que poder decir quién
            // llevaba la carga el martes.
            DB::table('load_assignments')
                ->where('load_id', $model->id)
                ->where('resource_type', $data['resource_type'])
                ->whereNull('unassigned_at')
                ->whereNull('deleted_at')
                ->update([
                    'unassigned_at' => now(),
                    'unassigned_reason' => 'Reemplazado por otra asignación.',
                    'updated_at' => now(),
                ]);

            DB::table('load_assignments')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $model->tenant_id,
                'load_id' => $model->id,
                'resource_type' => $data['resource_type'],
                $column => $data['resource_id'],
                'is_primary' => true,
                'assigned_by_user_id' => $actor->auditUserId(),
                // Se guarda el estado de cumplimiento TAL COMO ESTABA al
                // asignar. Si dentro de un año se pregunta «¿sabíais que tenía
                // la licencia vencida?», esta columna responde.
                'compliance_snapshot' => json_encode($this->snapshot($data['resource_type'], $data['resource_id'])),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        return back()->with('success', __("loads.assign.{$data['resource_type']}Done"));
    }

    public function unassign(
        string $load,
        string $assignment,
        CurrentActor $current,
        PermissionChecker $checker,
    ): RedirectResponse {
        $actor = $current->require();
        $model = Load::query()->findOrFail($load);

        $checker->authorize($actor, 'load:assign_resources', $this->context($model), $current->policy());

        DB::table('load_assignments')
            ->where('load_id', $model->id)
            ->where('id', $assignment)
            ->whereNull('unassigned_at')
            ->update([
                'unassigned_at' => now(),
                'unassigned_reason' => 'Retirado por un usuario.',
                'updated_at' => now(),
            ]);

        return back()->with('success', __('loads.assign.removed'));
    }

    // ------------------------------------------------------------------ interno

    /**
     * ¿Puede este recurso ir en esta carga? Devuelve el motivo si no.
     *
     * Dos familias de comprobación, y las dos importan:
     *
     *  - **Pertenencia**: el camión tiene que ser DEL transportista de la carga.
     *    Asignar el camión de otra empresa transportista no es un error de
     *    cumplimiento, es un disparate — y sin esta comprobación el selector
     *    filtrado sería la única defensa.
     *  - **Vigencia**: licencias, tarjetas médicas, inspecciones.
     */
    private function checkResource(Load $load, string $type, string $id): ?string
    {
        $today = CarbonImmutable::now()->toDateString();

        if ($type === 'driver') {
            $driver = DB::table('drivers')
                ->where('tenant_id', $load->tenant_id)
                ->where('id', $id)
                ->whereNull('deleted_at')
                ->first(['first_name', 'last_name', 'status', 'license_expires_at', 'medical_card_expires_at']);

            if ($driver === null) {
                return __('loads.assign.driverNotFound');
            }

            $name = trim("{$driver->first_name} {$driver->last_name}");

            if ($driver->status === 'inactive') {
                return __('loads.assign.driverInactive', ['name' => $name]);
            }

            // Solo la fecha. La columna es datetime(3) y en crudo sale
            // «2025-03-03 00:00:00.000», que en un mensaje para una persona es
            // ruido: nadie necesita los milisegundos del vencimiento de una
            // licencia.
            $day = static fn (?string $v): string => substr((string) $v, 0, 10);

            if ($driver->license_expires_at !== null && $driver->license_expires_at < $today) {
                return __('loads.assign.licenseExpired', [
                    'name' => $name,
                    'date' => $day($driver->license_expires_at),
                ]);
            }

            if ($driver->medical_card_expires_at !== null && $driver->medical_card_expires_at < $today) {
                return __('loads.assign.medicalExpired', [
                    'name' => $name,
                    'date' => $day($driver->medical_card_expires_at),
                ]);
            }

            // El conductor tiene que trabajar para el transportista de la carga.
            $worksHere = DB::table('driver_carrier_relationships')
                ->where('driver_id', $id)
                ->where('carrier_id', $load->carrier_id)
                ->whereNull('deleted_at')
                ->where(function ($q) use ($today): void {
                    $q->whereNull('end_date')->orWhereDate('end_date', '>=', $today);
                })
                ->exists();

            return $worksHere ? null : __('loads.assign.driverWrongCarrier', ['name' => $name]);
        }

        $table = $type === 'truck' ? 'trucks' : 'trailers';

        $unit = DB::table($table)
            ->where('tenant_id', $load->tenant_id)
            ->where('id', $id)
            ->whereNull('deleted_at')
            ->first(['unit_number', 'carrier_id', 'status']);

        if ($unit === null) {
            return __('loads.assign.unitNotFound');
        }

        if ($unit->carrier_id !== $load->carrier_id) {
            return __('loads.assign.unitWrongCarrier', ['unit' => (string) $unit->unit_number]);
        }

        if ($unit->status === 'out_of_service') {
            return __('loads.assign.unitOutOfService', ['unit' => (string) $unit->unit_number]);
        }

        return null;
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(string $type, string $id): array
    {
        if ($type === 'driver') {
            $d = DB::table('drivers')->where('id', $id)
                ->first(['status', 'license_expires_at', 'medical_card_expires_at', 'verification_status']);

            return [
                'checked_at' => now()->toIso8601String(),
                'status' => $d->status ?? null,
                'license_expires_at' => $d->license_expires_at ?? null,
                'medical_card_expires_at' => $d->medical_card_expires_at ?? null,
                'verification_status' => $d->verification_status ?? null,
            ];
        }

        $table = $type === 'truck' ? 'trucks' : 'trailers';
        $u = DB::table($table)->where('id', $id)->first(['status', 'next_inspection_due_at']);

        return [
            'checked_at' => now()->toIso8601String(),
            'status' => $u->status ?? null,
            'next_inspection_due_at' => $u->next_inspection_due_at ?? null,
        ];
    }

    private function context(Load $load): ResourceContext
    {
        return new ResourceContext(
            tenantId: $load->tenant_id,
            carrierId: $load->carrier_id,
            dispatcherUserId: $load->dispatcher_user_id,
            ownerUserId: $load->dispatcher_user_id,
        );
    }
}
