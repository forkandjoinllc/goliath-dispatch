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
use App\Support\Documents\DocumentTypes;
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

        // Las cuatro fotos del camión. La puerta de asignación las exige desde
        // el lote 60 —el sitio público las promete— y sin ellas ninguna prueba
        // que asigne un camión podría pasar. Es el mismo motivo por el que este
        // escenario aprueba documentos del transportista: montar una unidad que
        // NO puede trabajar no sirve para probar nada más que la propia puerta.
        foreach (['front', 'rear', 'left', 'right'] as $orden => $angulo) {
            DB::table('equipment_media')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $this->tenant->id,
                'equipment_type' => 'truck',
                'equipment_id' => $truckId,
                'angle' => $angulo,
                'media_kind' => 'photo',
                'storage_key' => 'pruebas/'.$truckId.'-'.$angulo.'.jpg',
                'content_type' => 'image/jpeg',
                'byte_size' => 1024,
                'sha256' => hash('sha256', $truckId.$angulo),
                'sort_order' => $orden,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

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

    /**
     * Documentos obligatorios del transportista aprobado, aprobados y sin vencer.
     *
     * La puerta de cumplimiento se endureció DESPUÉS de escribirse este
     * escenario: antes solo rechazaba documentos VENCIDOS, así que un
     * transportista con cero documentos pasaba. Ahora exige que existan, y sin
     * esto no hay forma de asignar ni despachar una carga en una prueba.
     *
     * Opcional a propósito: las pruebas de documentos cuentan filas.
     */
    public function approveCarrierDocuments(?string $carrierId = null): void
    {
        $carrierId ??= (string) $this->assignedCarrier->id;

        foreach (DocumentTypes::requiredFor('carrier') as $type) {
            DB::table('documents')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $this->tenant->id,
                'document_type' => $type,
                'owner_type' => 'carrier',
                'owner_id' => $carrierId,
                'review_status' => 'approved',
                'is_required' => 1,
                'expiration_date' => now()->addYear(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function user(Role $role): User
    {
        // El super administrador de plataforma NO se monta con los demás: no
        // pertenece a la empresa del escenario, y crearlo siempre metería en
        // cada prueba un usuario que ve por encima del ámbito que casi todas
        // existen para comprobar. Se construye cuando alguien lo pide.
        //
        // Antes esta línea moría con «Undefined array key
        // "platform_super_admin"», que no dice nada de lo anterior.
        if ($role === Role::PlatformSuperAdmin && ! isset($this->users[$role->value])) {
            $this->users[$role->value] = $this->makePlatformSuperAdmin();
        }

        return $this->users[$role->value];
    }

    /**
     * El super administrador lleva DOS cosas, y hacen falta las dos — pero NO
     * por lo que parece.
     *
     * Quien concede `platform:*` es el ROL de la membresía: PermissionChecker
     * resuelve la matriz a partir de `$actor->role` y la columna
     * `is_platform_super_admin` no aparece por ninguna parte de esa decisión.
     * La columna hace otra cosa: `EnsureTenantActive` la mira para dejar
     * entrar aunque la empresa esté suspendida, y `AppShell` la manda al
     * navegador para pintar el menú de plataforma.
     *
     * Con solo el rol, la sesión se cae en cuanto la empresa no esté activa.
     * Con solo la columna, se entra y no se puede ver nada: eso es exactamente
     * lo que pasó al recorrer la pantalla de salud con un admin promovido a
     * mano, que entró y recibió «No tiene acceso a esto».
     */
    private function makePlatformSuperAdmin(): User
    {
        return app(TenantContext::class)->runAs($this->tenant->id, function (): User {
            $user = User::create([
                'email' => 'super+'.Str::random(8).'@escenario.test',
                'password' => 'contraseña-de-prueba-1',
                'first_name' => 'Super',
                'last_name' => 'Prueba',
                'status' => UserStatus::Active,
                'email_verified_at' => now(),
            ]);

            // Con update() y no en el create(): la columna no está en
            // $fillable a propósito, para que nadie se haga super administrador
            // pasando un campo más en un formulario.
            DB::table('users')->where('id', $user->id)->update(['is_platform_super_admin' => 1]);

            UserTenantMembership::create([
                'tenant_id' => $this->tenant->id,
                'user_id' => $user->id,
                'role' => Role::PlatformSuperAdmin,
                'status' => 'active',
                'accepted_at' => now(),
            ]);

            return $user->refresh();
        });
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
