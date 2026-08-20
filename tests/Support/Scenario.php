<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Enums\LoadStatus;
use App\Enums\OnboardingStatus;
use App\Enums\Role;
use App\Enums\UserStatus;
use App\Enums\VerificationStatus;
use App\Models\Carrier;
use App\Models\Customer;
use App\Models\Load;
use App\Models\Tenant;
use App\Models\User;
use App\Models\UserTenantMembership;
use App\Support\Customers\NameKey;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Monta una empresa completa para una prueba: un usuario por rol, un par de
 * transportistas, un cliente, y el despachador asignado solo a UNO de los
 * transportistas.
 *
 * Que el despachador no los lleve todos es lo importante. Un escenario en el
 * que el despachador tiene acceso a todo no puede distinguir «el ámbito
 * `assigned` funciona» de «el ámbito `assigned` no hace nada», que es
 * exactamente el fallo que estas pruebas existen para atrapar.
 *
 * Se construye con modelos y no con factories porque las factories acabarían
 * duplicando las reglas del esquema (columnas normalizadas, estados válidos), y
 * dos copias de una regla se separan.
 */
final class Scenario
{
    public Tenant $tenant;

    /** @var array<string, User> rol => usuario */
    public array $users = [];

    /** El transportista que el despachador SÍ lleva. */
    public Carrier $assignedCarrier;

    /** El que NO lleva. Ninguna prueba de ámbito sirve sin él. */
    public Carrier $otherCarrier;

    public Customer $customer;

    /** Una carga del transportista ASIGNADO al despachador. */
    public Load $load;

    /** Una del transportista que NO lleva. Sin ella no se prueba nada. */
    public Load $otherLoad;

    public static function create(): self
    {
        $scenario = new self;
        $context = app(TenantContext::class);
        $context->forget();

        $scenario->tenant = Tenant::create([
            'slug' => 'sc-'.Str::random(8),
            'legal_name' => 'Escenario LLC',
            'display_name' => 'Escenario',
            'status' => 'active',
        ]);

        $context->runAs($scenario->tenant->id, function () use ($scenario): void {
            DB::table('tenant_settings')->insertOrIgnore([
                'id' => (string) Str::uuid(),
                'tenant_id' => $scenario->tenant->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $scenario->assignedCarrier = $scenario->makeCarrier('Asignado LLC', '7000001', OnboardingStatus::Approved);
            $scenario->otherCarrier = $scenario->makeCarrier('No asignado LLC', '7000002', OnboardingStatus::Draft);

            $scenario->customer = Customer::create([
                'company_name' => 'Cliente Escenario LLC',
                'company_name_normalized' => NameKey::for('Cliente Escenario LLC'),
                'status' => 'active',
                'payment_terms_days' => 30,
            ]);

            foreach (Role::cases() as $role) {
                if ($role === Role::PlatformSuperAdmin) {
                    continue;
                }

                $scenario->users[$role->value] = $scenario->makeUser($role);
            }

            $scenario->load = $scenario->makeLoad('T-0001', $scenario->assignedCarrier->id);
            $scenario->otherLoad = $scenario->makeLoad('T-0002', $scenario->otherCarrier->id);

            // El despachador lleva UNO de los dos.
            DB::table('dispatcher_resource_assignments')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $scenario->tenant->id,
                'dispatcher_user_id' => $scenario->users[Role::Dispatcher->value]->id,
                'resource_type' => 'carrier',
                'resource_id' => $scenario->assignedCarrier->id,
                'start_date' => now()->subDay(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        $context->forget();

        return $scenario;
    }

    /**
     * Una carga con sus dos paradas, lista para publicarse.
     *
     * Con paradas y con cobro al cliente a propósito: sin ellas, Guards
     * bloquearía la publicación y toda prueba de transición fallaría por el
     * motivo equivocado — parecería un problema de permisos cuando sería una
     * carga incompleta.
     */
    private function makeLoad(string $number, ?string $carrierId): Load
    {
        $load = Load::create([
            'load_number' => $number,
            'customer_id' => $this->customer->id,
            'carrier_id' => $carrierId,
            'status' => LoadStatus::Draft,
            'commodity' => 'Acero en rollos',
            'weight_pounds' => 42000,
            'customer_charge_cents' => 500000,
            'carrier_gross_rate_cents' => 400000,
            'carrier_dispatch_fee_bps' => 1000,
            'dispatcher_commission_bps' => 2500,
            'dispatcher_commission_basis' => 'dispatch_fee_amount',
            'miles' => 480,
            'planned_pickup_at' => now()->addDays(2),
            'planned_delivery_at' => now()->addDays(4),
        ]);

        foreach ([[1, 'pickup'], [2, 'delivery']] as [$sequence, $type]) {
            DB::table('load_stops')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $this->tenant->id,
                'load_id' => $load->id,
                'stop_type' => $type,
                'sequence' => $sequence,
                'facility_name' => $type === 'pickup' ? 'Planta origen' : 'Planta destino',
                'city' => $type === 'pickup' ? 'Laredo' : 'Dallas',
                'state' => 'TX',
                'timezone' => 'America/Chicago',
                'appointment_type' => 'window',
                'window_start' => now()->addDays($sequence === 1 ? 2 : 4),
                'window_end' => now()->addDays($sequence === 1 ? 2 : 4)->addHours(4),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        return $load;
    }

    /**
     * Pone camión y conductor en una carga, que es lo que Guards exige para
     * despachar. Se llama desde las pruebas que necesitan llegar hasta ahí.
     */
    public function crew(Load $load): void
    {
        $truckId = (string) Str::uuid();
        DB::table('trucks')->insert([
            'id' => $truckId,
            'tenant_id' => $this->tenant->id,
            'carrier_id' => $load->carrier_id,
            'unit_number' => 'U-'.Str::upper(Str::random(4)),
            'vin' => Str::upper(Str::random(17)),
            'vin_normalized' => Str::upper(Str::random(17)),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $driverId = (string) Str::uuid();
        DB::table('drivers')->insert([
            'id' => $driverId,
            'tenant_id' => $this->tenant->id,
            'first_name' => 'Conductor',
            'last_name' => 'Apto',
            'license_state' => 'TX',
            'license_number_hash' => hash('sha256', Str::random(12)),
            'license_number_last4' => '1234',
            'cdl_class' => 'A',
            'license_expires_at' => now()->addYear(),
            'medical_card_expires_at' => now()->addYear(),
            'status' => 'available',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach ([['truck', 'truck_id', $truckId], ['driver', 'driver_id', $driverId]] as [$type, $column, $id]) {
            DB::table('load_assignments')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $this->tenant->id,
                'load_id' => $load->id,
                'resource_type' => $type,
                $column => $id,
                'is_primary' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function user(Role $role): User
    {
        return $this->users[$role->value];
    }

    private function makeCarrier(string $name, string $dot, OnboardingStatus $status): Carrier
    {
        $carrier = Carrier::create([
            'legal_name' => $name,
            'dot_number' => $dot,
            'contact_first_name' => 'Ana',
            'contact_last_name' => 'Díaz',
            'email' => 'ops+'.Str::random(6).'@escenario.test',
            'phone' => '+15550100',
            'preferred_locale' => 'es',
            'onboarding_status' => $status,
            'fmcsa_status' => VerificationStatus::NotStarted,
            'dispatch_fee_bps' => 1000,
        ]);

        DB::table('carrier_onboardings')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenant->id,
            'carrier_id' => $carrier->id,
            'status' => $status->value,
            'required_document_types' => json_encode([]),
            'checklist' => json_encode([]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $carrier;
    }

    private function makeUser(Role $role): User
    {
        $user = User::create([
            'email' => $role->value.'+'.Str::random(8).'@escenario.test',
            'password' => 'contraseña-de-prueba-1',
            'first_name' => ucfirst($role->value),
            'last_name' => 'Prueba',
            'status' => UserStatus::Active,
            'email_verified_at' => now(),
        ]);

        UserTenantMembership::create([
            'tenant_id' => $this->tenant->id,
            'user_id' => $user->id,
            'role' => $role,
            'status' => 'active',
            'accepted_at' => now(),
            // El usuario transportista se ata a un transportista concreto: sin
            // eso su ámbito `carrier` no puede demostrarse y denegaría siempre,
            // que haría pasar las pruebas por el motivo equivocado.
            'carrier_id' => $role === Role::Carrier ? $this->assignedCarrier->id : null,
        ]);

        return $user;
    }
}
