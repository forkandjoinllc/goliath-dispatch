<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Authorization\Actor;
use App\Enums\DocumentType;
use App\Enums\DriverStatus;
use App\Enums\EquipmentStatus;
use App\Enums\Locale;
use App\Enums\LoadStatus;
use App\Enums\OnboardingStatus;
use App\Enums\Role;
use App\Enums\StopType;
use App\Enums\VerificationStatus;
use App\Models\Load;
use App\Support\Customers\NameKey;
use App\Support\Finance\CommissionLedger;
use App\Support\Finance\InvoiceBuilder;
use App\Support\Finance\PaymentLedger;
use App\Support\Finance\SettlementBuilder;
use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Datos de demostración para la empresa Demo Dispatch.
 *
 * Para qué existe: una pantalla vacía no se puede juzgar. Un listado de
 * transportistas sin transportistas no dice si la paginación funciona, si los
 * estados se distinguen a simple vista, si un nombre largo rompe la tabla, ni si
 * un despachador ve de verdad solo lo suyo.
 *
 * Reglas que se respetan aquí:
 *
 *  - **Ningún dato personal real.** Nombres inventados, dominios .test (RFC 6761,
 *    no resuelven nunca) y teléfonos del rango 555 reservado para ficción.
 *  - **Números DOT y MC inventados.** No se usa el número de ninguna empresa real
 *    ni se llama a FMCSA: las filas de verificación se escriben directamente con
 *    el resultado que se quiere mostrar, y así queda claro que es un simulacro.
 *  - **Bilingüe de verdad.** La mitad de los transportistas y conductores prefiere
 *    español, con acentos y eñes, para que se vea si algo se rompe al codificar.
 *  - **Idempotente.** Se puede volver a ejecutar sin duplicar ni chocar con los
 *    índices únicos.
 *
 * No se ejecuta desde DatabaseSeeder. Hay que pedirlo:
 *
 *     php artisan db:seed --class=DemoDataSeeder
 *
 * Depende de DemoUsersSeeder, al que llama si la empresa aún no existe.
 */
class DemoDataSeeder extends Seeder
{
    private const TENANT_SLUG = 'demo-dispatch';

    private string $tenantId;

    /** @var array<string, string> correo => id de usuario */
    private array $users = [];

    public function run(): void
    {
        $context = app(TenantContext::class);

        $tenant = $context->withoutTenant(
            fn () => DB::table('tenants')->where('slug', self::TENANT_SLUG)->first(['id'])
        );

        if ($tenant === null) {
            $this->command->warn('No existe la empresa de demostración; creándola primero.');
            $this->call(DemoUsersSeeder::class);

            $tenant = $context->withoutTenant(
                fn () => DB::table('tenants')->where('slug', self::TENANT_SLUG)->first(['id'])
            );
        }

        $this->tenantId = (string) $tenant->id;

        $this->users = $context->withoutTenant(fn (): array => DB::table('users')
            ->whereIn('email_normalized', [
                'admin@demo.test', 'accounting@demo.test', 'dispatcher@demo.test',
                'carrier@demo.test', 'driver@demo.test',
            ])
            ->pluck('id', 'email_normalized')
            ->map(fn ($id): string => (string) $id)
            ->all());

        // Todo dentro del ámbito de la empresa: así el scope global actúa igual
        // que en una petición y el seeder no puede escribir por accidente en la
        // empresa equivocada.
        $context->runAs($this->tenantId, function (): void {
            DB::transaction(function (): void {
                $equipment = $this->equipmentTypes();
                $this->expenseCategories();

                $carriers = $this->carriers();
                $this->onboardings($carriers);
                $this->fmcsaVerifications($carriers);
                $this->carrierDocuments($carriers);
                $this->equipment($carriers, $equipment);
                $drivers = $this->drivers($carriers);
                $customers = $this->customers();
                // linkDemoUsers va ANTES que loads a propósito: ata
                // driver@demo.test a un conductor concreto, y loadCrew necesita
                // saber cuál para darle cargas. Al revés, la cuenta de
                // conductor entraba con sus quince permisos y una lista vacía.
                $this->linkDemoUsers($carriers, $drivers);
                $this->loads($carriers, $customers, $drivers, $equipment);
                $this->expenses();
                // El dinero va DESPUÉS de los gastos a propósito: la
                // instantánea que congela cada factura tiene que incluirlos, y
                // si se factura antes los cuatro cubos salen en cero — que es
                // exactamente el fallo que el lote 26 vino a arreglar.
                $this->money();
            });
        });

        $this->report();
    }

    // ---------------------------------------------------------------- catálogos

    /**
     * Tipos de equipo. Bilingües en la propia fila (label_en / label_es) y no en
     * el diccionario de traducción porque una empresa puede añadir los suyos, y
     * esos no van a estar en ningún fichero de idioma.
     *
     * @return array<string, string> código => id
     */
    private function equipmentTypes(): array
    {
        $types = [
            ['flatbed', 'Flatbed', 'Plataforma', 'trailer', false, 10],
            ['step_deck', 'Step deck', 'Plataforma escalonada', 'trailer', false, 20],
            ['double_drop', 'Double drop', 'Cuello de cisne bajo', 'trailer', true, 30],
            ['rgn', 'Removable gooseneck (RGN)', 'Cuello desmontable (RGN)', 'trailer', true, 40],
            ['lowboy', 'Lowboy', 'Cama baja', 'trailer', true, 50],
            ['conestoga', 'Conestoga', 'Conestoga', 'trailer', false, 60],
            ['dry_van', 'Dry van', 'Caja seca', 'trailer', false, 70],
            ['day_cab', 'Day cab tractor', 'Tractocamión sin dormitorio', 'truck', false, 80],
            ['sleeper', 'Sleeper tractor', 'Tractocamión con dormitorio', 'truck', false, 90],
        ];

        $ids = [];

        foreach ($types as [$code, $en, $es, $category, $rgn, $sort]) {
            $ids[$code] = $this->upsert('equipment_types', ['code' => $code], [
                'label_en' => $en,
                'label_es' => $es,
                'category' => $category,
                'is_system' => true,
                'supports_rgn' => $rgn,
                'sort_order' => $sort,
                'active' => true,
            ]);
        }

        return $ids;
    }

    private function expenseCategories(): void
    {
        $categories = [
            ['fuel', 'Fuel', 'Combustible', 'carrier_deduction', 10],
            ['tolls', 'Tolls', 'Peajes', 'carrier_deduction', 20],
            ['lumper', 'Lumper', 'Maniobra de carga', 'reimbursable_to_carrier', 30],
            ['scale', 'Scale ticket', 'Boleta de báscula', 'carrier_deduction', 40],
            // Excluidos, no reembolsables. Lo dice el propio esquema —
            // «Permits and escorts ship as excluded-by-default system
            // categories»— y tiene sentido: un permiso de sobredimensión de
            // $3.000 es un coste que se traslada tal cual, no flete. Cobrar la
            // tarifa de despacho sobre él sería cobrarle al transportista un
            // 10% de un dinero que solo pasó por sus manos.
            ['permit', 'Permit', 'Permiso', 'excluded_from_commission', 50],
            ['escort', 'Escort', 'Escolta', 'excluded_from_commission', 60],
            ['repair', 'Repair', 'Reparación', 'carrier_deduction', 70],
            ['other', 'Other', 'Otro', 'tenant_absorbed', 80],
        ];

        foreach ($categories as [$code, $en, $es, $treatment, $sort]) {
            $this->upsert('expense_categories', ['code' => $code], [
                'label_en' => $en,
                'label_es' => $es,
                'treatment' => $treatment,
                'is_system' => true,
                'requires_receipt' => $code !== 'other',
                'active' => true,
                'sort_order' => $sort,
            ]);
        }
    }

    // -------------------------------------------------------------- transportistas

    /**
     * Seis transportistas que cubren el ciclo entero de alta, no seis copias del
     * mismo. Sin un `corrections_required` y un `suspended` en la lista, esos dos
     * estados nunca se ven hasta que le pasan a un cliente.
     *
     * @return array<string, string> clave => id
     */
    private function carriers(): array
    {
        $now = Carbon::now();

        $rows = [
            [
                'key' => 'atlas',
                'legal_name' => 'Atlas Heavy Transport LLC',
                'dba' => 'Atlas Heavy',
                'dot' => '3901447', 'mc' => '1442907',
                'first' => 'Dana', 'last' => 'Whitfield',
                'email' => 'dispatch@atlasheavy.test', 'phone' => '+1 555 0142',
                'locale' => 'en',
                'city' => 'Laredo', 'state' => 'TX', 'zip' => '78045',
                'line1' => '4820 Bob Bullock Loop',
                'onboarding' => OnboardingStatus::Approved,
                'fmcsa' => VerificationStatus::Verified,
                'fee_bps' => 1000,
                'approved_days_ago' => 214,
                'factoring' => true,
                'notes' => 'Cross-border lane specialist. Prefers 48-hour advance notice on oversize.',
            ],
            [
                'key' => 'cordillera',
                'legal_name' => 'Transportes Cordillera S. de R.L.',
                'dba' => 'Cordillera Freight',
                'dot' => '3477120', 'mc' => '1168342',
                'first' => 'Rafael', 'last' => 'Ibáñez',
                'email' => 'operaciones@cordillera.test', 'phone' => '+1 555 0188',
                'locale' => 'es',
                'city' => 'El Paso', 'state' => 'TX', 'zip' => '79907',
                'line1' => '11250 Rojas Drive',
                'onboarding' => OnboardingStatus::Approved,
                'fmcsa' => VerificationStatus::Verified,
                'fee_bps' => 1200,
                'approved_days_ago' => 96,
                'factoring' => false,
                'notes' => 'Toda la comunicación en español. Dos operadores con endoso de carga sobredimensionada.',
            ],
            [
                'key' => 'northline',
                'legal_name' => 'Northline Rigging & Hauling Inc.',
                'dba' => null,
                'dot' => '2884510', 'mc' => '0967431',
                'first' => 'Priya', 'last' => 'Raghavan',
                'email' => 'ops@northlinerigging.test', 'phone' => '+1 555 0119',
                'locale' => 'en',
                'city' => 'Gary', 'state' => 'IN', 'zip' => '46402',
                'line1' => '900 Buchanan Street',
                'onboarding' => OnboardingStatus::UnderReview,
                'fmcsa' => VerificationStatus::Pending,
                'fee_bps' => 1000,
                'approved_days_ago' => null,
                'factoring' => false,
                'notes' => 'Insurance certificate submitted; awaiting endorsement verification.',
            ],
            [
                'key' => 'sierra',
                'legal_name' => 'Sierra Madre Logistics LLC',
                'dba' => 'Sierra Madre',
                'dot' => '4012765', 'mc' => '1520884',
                'first' => 'Noemí', 'last' => 'Vargas',
                'email' => 'alta@sierramadrelog.test', 'phone' => '+1 555 0173',
                'locale' => 'es',
                'city' => 'Tucson', 'state' => 'AZ', 'zip' => '85714',
                'line1' => '3400 East Ajo Way',
                'onboarding' => OnboardingStatus::CorrectionsRequired,
                'fmcsa' => VerificationStatus::Mismatch,
                'fee_bps' => 1000,
                'approved_days_ago' => null,
                'factoring' => false,
                'notes' => 'El nombre legal del certificado no coincide con el registrado en FMCSA.',
            ],
            [
                'key' => 'bluewater',
                'legal_name' => 'Bluewater Drayage Company',
                'dba' => null,
                'dot' => '3155908', 'mc' => '1093776',
                'first' => 'Marcus', 'last' => 'Okonjo',
                'email' => 'admin@bluewaterdrayage.test', 'phone' => '+1 555 0156',
                'locale' => 'en',
                'city' => 'Savannah', 'state' => 'GA', 'zip' => '31408',
                'line1' => '120 Grange Road',
                'onboarding' => OnboardingStatus::Suspended,
                'fmcsa' => VerificationStatus::Expired,
                'fee_bps' => 1000,
                'approved_days_ago' => 640,
                'factoring' => false,
                'notes' => 'Suspended pending renewed certificate of insurance.',
            ],
            [
                'key' => 'granito',
                'legal_name' => 'Granito Transport Group LLC',
                'dba' => 'Granito',
                'dot' => '4188032', 'mc' => '1607219',
                'first' => 'Tomás', 'last' => 'Rentería',
                'email' => 'contacto@granitotransport.test', 'phone' => '+1 555 0164',
                'locale' => 'es',
                'city' => 'Oklahoma City', 'state' => 'OK', 'zip' => '73129',
                'line1' => '2701 South Eastern Avenue',
                'onboarding' => OnboardingStatus::Draft,
                'fmcsa' => VerificationStatus::NotStarted,
                'fee_bps' => 1000,
                'approved_days_ago' => null,
                'factoring' => false,
                'notes' => 'Solicitud iniciada desde el formulario público; sin documentos todavía.',
            ],
        ];

        $ids = [];

        foreach ($rows as $r) {
            $approved = $r['approved_days_ago'] === null
                ? null
                : $now->copy()->subDays($r['approved_days_ago']);

            $ids[$r['key']] = $this->upsert('carriers', ['dot_number' => $r['dot']], [
                'legal_name' => $r['legal_name'],
                'dba' => $r['dba'],
                'mc_number' => $r['mc'],
                'contact_first_name' => $r['first'],
                'contact_last_name' => $r['last'],
                'email' => $r['email'],
                'phone' => $r['phone'],
                'preferred_locale' => $r['locale'],
                'physical_line1' => $r['line1'],
                'physical_city' => $r['city'],
                'physical_state' => $r['state'],
                'physical_postal_code' => $r['zip'],
                'physical_country' => 'US',
                'mailing_same_as_physical' => true,
                'dispatch_fee_bps' => $r['fee_bps'],
                'onboarding_status' => $r['onboarding']->value,
                'fmcsa_status' => $r['fmcsa']->value,
                'fmcsa_last_verified_at' => $r['fmcsa'] === VerificationStatus::NotStarted
                    ? null
                    : $now->copy()->subDays($r['fmcsa'] === VerificationStatus::Expired ? 420 : 12),
                // Reverificación anual: la fecha se guarda para que el trabajo
                // programado tenga a quién mirar, no se calcula al vuelo.
                'fmcsa_next_verification_at' => $r['fmcsa'] === VerificationStatus::Verified
                    ? $now->copy()->addDays(353)
                    : null,
                'approved_at' => $approved,
                'approved_by_user_id' => $approved === null ? null : ($this->users['admin@demo.test'] ?? null),
                'suspended_at' => $r['onboarding'] === OnboardingStatus::Suspended
                    ? $now->copy()->subDays(31)
                    : null,
                'suspension_reason' => $r['onboarding'] === OnboardingStatus::Suspended
                    ? 'Certificate of insurance lapsed on renewal date.'
                    : null,
                'uses_factoring' => $r['factoring'],
                'notes' => $r['notes'],
                'last_activity_at' => $now->copy()->subHours(random_int(2, 200)),
                // La fecha de alta se escribe a mano y no se deja en «ahora»:
                // un transportista aprobado hace siete meses que aparece dado
                // de alta hoy hace dudar de todas las demás fechas de la
                // pantalla.
                'created_at' => $approved?->copy()->subDays(5) ?? $now->copy()->subDays(random_int(3, 40)),
            ]);
        }

        return $ids;
    }

    /**
     * La lista de comprobación del alta, con el estado real de cada paso.
     *
     * @param  array<string, string>  $carriers
     */
    private function onboardings(array $carriers): void
    {
        $required = [
            DocumentType::CertificateOfAuthority->value,
            DocumentType::CertificateOfInsurance->value,
            DocumentType::CarrierAgreement->value,
        ];

        $now = Carbon::now();

        $plan = [
            'atlas' => [OnboardingStatus::Approved, ['authority' => true, 'insurance' => true, 'agreement' => true, 'fmcsa' => true, 'w9' => true]],
            'cordillera' => [OnboardingStatus::Approved, ['authority' => true, 'insurance' => true, 'agreement' => true, 'fmcsa' => true, 'w9' => true]],
            'northline' => [OnboardingStatus::UnderReview, ['authority' => true, 'insurance' => true, 'agreement' => false, 'fmcsa' => false, 'w9' => true]],
            'sierra' => [OnboardingStatus::CorrectionsRequired, ['authority' => true, 'insurance' => false, 'agreement' => false, 'fmcsa' => false, 'w9' => true]],
            'bluewater' => [OnboardingStatus::Suspended, ['authority' => true, 'insurance' => false, 'agreement' => true, 'fmcsa' => true, 'w9' => true]],
            'granito' => [OnboardingStatus::Draft, ['authority' => false, 'insurance' => false, 'agreement' => false, 'fmcsa' => false, 'w9' => false]],
        ];

        foreach ($plan as $key => [$status, $checklist]) {
            $carrierId = $carriers[$key];
            $submitted = $status === OnboardingStatus::Draft ? null : $now->copy()->subDays(random_int(20, 240));
            $decided = in_array($status, [OnboardingStatus::Approved, OnboardingStatus::Suspended], true)
                ? $submitted?->copy()->addDays(3)
                : null;

            $this->upsert('carrier_onboardings', ['carrier_id' => $carrierId], [
                'status' => $status->value,
                'submitted_at' => $submitted,
                'review_started_at' => $submitted?->copy()->addDay(),
                'decided_at' => $decided,
                'decided_by_user_id' => $decided === null ? null : ($this->users['admin@demo.test'] ?? null),
                'corrections_requested_at' => $status === OnboardingStatus::CorrectionsRequired
                    ? $now->copy()->subDays(4)
                    : null,
                'correction_notes' => $status === OnboardingStatus::CorrectionsRequired
                    ? 'El nombre legal del certificado de seguro no coincide con el registrado en FMCSA. Envíe un certificado corregido.'
                    : null,
                'required_document_types' => json_encode($required),
                'checklist' => json_encode($checklist),
            ]);
        }
    }

    /**
     * @param  array<string, string>  $carriers
     */
    private function fmcsaVerifications(array $carriers): void
    {
        $now = Carbon::now();

        $plan = [
            'atlas' => [VerificationStatus::Verified, '3901447', '1442907', 'Authorized for Property, no out-of-service order.'],
            'cordillera' => [VerificationStatus::Verified, '3477120', '1168342', 'Authorized for Property, no out-of-service order.'],
            'northline' => [VerificationStatus::Pending, '2884510', '0967431', null],
            'sierra' => [VerificationStatus::Mismatch, '4012765', '1520884', 'Legal name on file differs from submitted name.'],
            'bluewater' => [VerificationStatus::Expired, '3155908', '1093776', 'Last verification is older than the annual policy.'],
        ];

        foreach ($plan as $key => [$status, $dot, $mc, $note]) {
            $this->upsert('fmcsa_verifications', ['carrier_id' => $carriers[$key]], [
                // El proveedor es el adaptador simulado: sin credenciales no se
                // llama a FMCSA, y decirlo en la fila evita que alguien tome
                // estos datos por una verificación de verdad.
                'provider' => 'mock',
                'dot_number' => $dot,
                'mc_number' => $mc,
                'status' => $status->value,
                'normalized' => json_encode([
                    'legal_name' => null,
                    'operating_status' => $status === VerificationStatus::Verified ? 'AUTHORIZED' : null,
                    'note' => $note,
                    'source' => 'seeded demo data — not a real FMCSA response',
                ]),
                'attempt' => 1,
                'error_message' => $status === VerificationStatus::Mismatch ? $note : null,
                'created_at' => $now->copy()->subDays(12),
                'updated_at' => $now->copy()->subDays(12),
            ]);
        }
    }

    /**
     * Documentos con vencimientos escalonados: uno vencido, uno a punto y varios
     * al día. Un listado en el que todo está en verde no enseña nada.
     *
     * @param  array<string, string>  $carriers
     */
    private function carrierDocuments(array $carriers): void
    {
        $now = Carbon::now();

        $plan = [
            ['atlas', DocumentType::CertificateOfInsurance, 'Certificate of insurance — Atlas Heavy', 268, 'approved'],
            ['atlas', DocumentType::CertificateOfAuthority, 'FMCSA operating authority — Atlas Heavy', null, 'approved'],
            ['atlas', DocumentType::CarrierAgreement, 'Signed carrier agreement — Atlas Heavy', null, 'approved'],
            ['cordillera', DocumentType::CertificateOfInsurance, 'Certificado de seguro — Cordillera Freight', 24, 'approved'],
            ['cordillera', DocumentType::CertificateOfAuthority, 'Autoridad operativa FMCSA — Cordillera Freight', null, 'approved'],
            ['cordillera', DocumentType::CarrierAgreement, 'Contrato de transportista firmado — Cordillera', null, 'approved'],
            ['northline', DocumentType::CertificateOfInsurance, 'Certificate of insurance — Northline Rigging', 181, 'in_review'],
            ['northline', DocumentType::CertificateOfAuthority, 'FMCSA operating authority — Northline Rigging', null, 'approved'],
            ['sierra', DocumentType::CertificateOfAuthority, 'Autoridad operativa FMCSA — Sierra Madre', null, 'approved'],
            ['sierra', DocumentType::CertificateOfInsurance, 'Certificado de seguro — Sierra Madre', 47, 'rejected'],
            ['bluewater', DocumentType::CertificateOfInsurance, 'Certificate of insurance — Bluewater Drayage', -34, 'expired'],
            ['bluewater', DocumentType::CarrierAgreement, 'Signed carrier agreement — Bluewater Drayage', null, 'approved'],
        ];

        foreach ($plan as [$key, $type, $title, $expiresInDays, $review]) {
            $carrierId = $carriers[$key];
            $expiration = $expiresInDays === null ? null : $now->copy()->addDays($expiresInDays);

            $documentId = $this->upsert('documents', [
                'owner_type' => 'carrier',
                'owner_id' => $carrierId,
                'document_type' => $type->value,
            ], [
                'title' => $title,
                'review_status' => $review,
                'issue_date' => $now->copy()->subDays(random_int(90, 400)),
                'expiration_date' => $expiration,
                'is_required' => true,
                // 30 días de aviso: el mismo umbral que usa el trabajo de
                // vencimientos, guardado en la fila para que no dependa de un
                // valor codificado en dos sitios.
                'expires_soon_at' => $expiration?->copy()->subDays(30),
                'uploaded_by_user_id' => $this->users['admin@demo.test'] ?? null,
            ]);

            // Una versión por documento. El fichero NO existe: la clave de
            // almacenamiento apunta a un prefijo de demostración y el hash es
            // determinista. Nada de esto pretende ser un PDF real.
            $versionId = $this->upsert('document_versions', [
                'document_id' => $documentId,
                'version_number' => 1,
            ], [
                'storage_key' => "demo/{$this->tenantId}/carriers/{$carrierId}/{$type->value}-v1.pdf",
                'original_filename' => $type->value.'.pdf',
                'content_type' => 'application/pdf',
                'byte_size' => random_int(80_000, 400_000),
                'sha256' => hash('sha256', "demo:{$carrierId}:{$type->value}:1"),
                'page_count' => random_int(1, 4),
                'malware_scan_status' => 'clean',
                'malware_scan_at' => $now->copy()->subDays(10),
                'extraction_status' => 'not_started',
                'uploaded_by_user_id' => $this->users['admin@demo.test'] ?? null,
            ]);

            DB::table('documents')->where('id', $documentId)->update([
                'current_version_id' => $versionId,
            ]);

            if ($expiration !== null) {
                $this->upsert('document_expirations', ['document_id' => $documentId], [
                    'expiration_date' => $expiration,
                    'warning_days' => 30,
                    'kind' => 'document',
                    'resolved_at' => null,
                ]);
            }
        }
    }

    /**
     * @param  array<string, string>  $carriers
     * @param  array<string, string>  $equipment
     */
    private function equipment(array $carriers, array $equipment): void
    {
        $now = Carbon::now();

        $trucks = [
            ['atlas', '101', '1FUJGLDR8LLBA1101', 2021, 'Freightliner', 'Cascadia', 'sleeper', 'TX', EquipmentStatus::Active, 92],
            ['atlas', '104', '1XKYDP9X4MJ421104', 2022, 'Kenworth', 'W990', 'sleeper', 'TX', EquipmentStatus::Active, 210],
            ['cordillera', 'C-07', '3AKJHHDR9NSNJ3107', 2023, 'Peterbilt', '389', 'sleeper', 'TX', EquipmentStatus::Active, 340],
            ['cordillera', 'C-12', '1FUJHHDR2KLKJ2112', 2019, 'Freightliner', 'Coronado', 'day_cab', 'TX', EquipmentStatus::OutOfService, 18],
            ['northline', 'NR-3', '1XPXD49X1MD771003', 2021, 'Peterbilt', '567', 'day_cab', 'IN', EquipmentStatus::PendingVerification, 150],
        ];

        foreach ($trucks as [$carrier, $unit, $vin, $year, $make, $model, $type, $state, $status, $regDays]) {
            $this->upsert('trucks', ['vin_normalized' => $vin], [
                'carrier_id' => $carriers[$carrier],
                'unit_number' => $unit,
                'vin' => $vin,
                'year' => $year,
                'make' => $make,
                'model' => $model,
                'equipment_type_id' => $equipment[$type],
                'plate_number' => strtoupper(Str::random(3)).substr($vin, -4),
                'plate_state' => $state,
                'status' => $status->value,
                'registration_expires_at' => $now->copy()->addDays($regDays),
                'last_inspection_at' => $now->copy()->subDays(random_int(30, 300)),
                'next_inspection_due_at' => $now->copy()->addDays(random_int(20, 300)),
                'coi_verification_status' => $status === EquipmentStatus::Active ? 'verified' : 'pending',
                'out_of_service_reason' => $status === EquipmentStatus::OutOfService
                    ? 'Falla en el sistema de frenos; en taller.'
                    : null,
            ]);
        }

        $trailers = [
            ['atlas', 'T-220', '1JJV532W1LL220220', 2020, 'Wabash', 'Step deck', 'step_deck', 'TX', EquipmentStatus::Active, 636, 102, 39],
            ['atlas', 'T-310', '5JYD532B6MP310310', 2021, 'Trail King', 'RGN 55T', 'rgn', 'TX', EquipmentStatus::Active, 636, 102, 22],
            ['cordillera', 'R-14', '1DW1A5321NS141414', 2022, 'Fontaine', 'Magnitude 55L', 'lowboy', 'TX', EquipmentStatus::Active, 624, 102, 20],
            ['cordillera', 'R-21', '1UYFS2486LU212121', 2019, 'Utility', 'Flatbed 48', 'flatbed', 'TX', EquipmentStatus::Active, 576, 102, 60],
            ['northline', 'NT-9', '1L01A5325MM090909', 2021, 'Landoll', '440B', 'double_drop', 'IN', EquipmentStatus::PendingVerification, 636, 102, 26],
        ];

        foreach ($trailers as [$carrier, $unit, $vin, $year, $make, $model, $type, $state, $status, $len, $wid, $deck]) {
            $this->upsert('trailers', ['vin_normalized' => $vin], [
                'carrier_id' => $carriers[$carrier],
                'unit_number' => $unit,
                'vin' => $vin,
                'year' => $year,
                'make' => $make,
                'model' => $model,
                'equipment_type_id' => $equipment[$type],
                'plate_number' => strtoupper(Str::random(3)).substr($vin, -4),
                'plate_state' => $state,
                'length_inches' => $len,
                'width_inches' => $wid,
                'deck_height_inches' => $deck,
                'capacity_pounds' => in_array($type, ['rgn', 'lowboy'], true) ? 110_000 : 48_000,
                'axle_count' => in_array($type, ['rgn', 'lowboy'], true) ? 5 : 2,
                'removable_gooseneck' => $type === 'rgn',
                'is_extendable' => in_array($type, ['rgn', 'double_drop'], true),
                'status' => $status->value,
                'registration_expires_at' => $now->copy()->addDays(random_int(40, 320)),
                'last_inspection_at' => $now->copy()->subDays(random_int(30, 300)),
                'next_inspection_due_at' => $now->copy()->addDays(random_int(20, 300)),
                'coi_verification_status' => $status === EquipmentStatus::Active ? 'verified' : 'pending',
            ]);
        }
    }

    /**
     * @param  array<string, string>  $carriers
     * @return array<string, string>
     */
    private function drivers(array $carriers): array
    {
        $now = Carbon::now();

        $rows = [
            ['key' => 'salas', 'first' => 'Eduardo', 'last' => 'Salas', 'locale' => 'es', 'carrier' => 'atlas', 'state' => 'TX', 'class' => 'A', 'status' => DriverStatus::OnLoad, 'licenseDays' => 512, 'medicalDays' => 88, 'verification' => VerificationStatus::Verified],
            ['key' => 'brennan', 'first' => 'Maureen', 'last' => 'Brennan', 'locale' => 'en', 'carrier' => 'atlas', 'state' => 'TX', 'class' => 'A', 'status' => DriverStatus::Available, 'licenseDays' => 240, 'medicalDays' => 19, 'verification' => VerificationStatus::Verified],
            ['key' => 'quiroga', 'first' => 'Javier', 'last' => 'Quiroga', 'locale' => 'es', 'carrier' => 'cordillera', 'state' => 'TX', 'class' => 'A', 'status' => DriverStatus::Available, 'licenseDays' => 800, 'medicalDays' => 300, 'verification' => VerificationStatus::Verified],
            ['key' => 'delatorre', 'first' => 'Ana Lucía', 'last' => 'De la Torre', 'locale' => 'es', 'carrier' => 'cordillera', 'state' => 'TX', 'class' => 'A', 'status' => DriverStatus::OffDuty, 'licenseDays' => 130, 'medicalDays' => -6, 'verification' => VerificationStatus::Pending],
            ['key' => 'okafor', 'first' => 'Chidi', 'last' => 'Okafor', 'locale' => 'en', 'carrier' => 'northline', 'state' => 'IN', 'class' => 'A', 'status' => DriverStatus::Inactive, 'licenseDays' => 410, 'medicalDays' => 200, 'verification' => VerificationStatus::NotStarted],
        ];

        $ids = [];

        foreach ($rows as $r) {
            // La licencia no se inventa entera: se guardan solo los cuatro
            // últimos dígitos y un hash, que es lo que guardaría el sistema de
            // verdad. Nunca un número de licencia real, ni siquiera simulado
            // en claro.
            $last4 = str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);

            $driverId = $this->upsert('drivers', [
                'first_name' => $r['first'],
                'last_name' => $r['last'],
            ], [
                'email' => strtolower(Str::ascii($r['first'][0].str_replace(' ', '', $r['last']))).'@demo.test',
                'phone' => '+1 555 0'.random_int(100, 199),
                'preferred_locale' => $r['locale'],
                'license_state' => $r['state'],
                'license_number_last4' => $last4,
                'license_number_hash' => hash('sha256', "demo:{$r['key']}:{$last4}"),
                'cdl_class' => $r['class'],
                'license_expires_at' => $now->copy()->addDays($r['licenseDays']),
                'medical_card_expires_at' => $now->copy()->addDays($r['medicalDays']),
                'status' => $r['status']->value,
                'verification_status' => $r['verification']->value,
                'verified_by_user_id' => $r['verification'] === VerificationStatus::Verified
                    ? ($this->users['admin@demo.test'] ?? null)
                    : null,
                'verified_at' => $r['verification'] === VerificationStatus::Verified
                    ? $now->copy()->subDays(random_int(10, 200))
                    : null,
                'tracking_consent_granted_at' => $r['status'] === DriverStatus::Inactive
                    ? null
                    : $now->copy()->subDays(random_int(10, 300)),
            ]);

            $this->upsert('driver_carrier_relationships', [
                'driver_id' => $driverId,
                'carrier_id' => $carriers[$r['carrier']],
            ], [
                'is_primary' => true,
                'end_date' => null,
                'approved_by_user_id' => $this->users['admin@demo.test'] ?? null,
                'approved_at' => $now->copy()->subDays(random_int(10, 300)),
            ]);

            $ids[$r['key']] = $driverId;
        }

        return $ids;
    }

    /**
     * @return array<string, array{id: string, locations: array<string, string>}>
     */
    private function customers(): array
    {
        $rows = [
            [
                'key' => 'permian', 'name' => 'Permian Basin Equipment Co.',
                'city' => 'Midland', 'state' => 'TX', 'zip' => '79706', 'line1' => '5900 West Industrial Avenue',
                'email' => 'ap@permianequip.test', 'phone' => '+1 555 0201', 'terms' => 30, 'credit' => 25_000_00,
                'locations' => [
                    ['yard', 'Midland Yard', '5900 West Industrial Avenue', 'Midland', 'TX', '79706'],
                    ['plant', 'Odessa Fabrication Plant', '1400 North Grandview Avenue', 'Odessa', 'TX', '79761'],
                ],
            ],
            [
                'key' => 'delgado', 'name' => 'Aceros Delgado S.A. de C.V.',
                'city' => 'Laredo', 'state' => 'TX', 'zip' => '78041', 'line1' => '8100 San Dario Avenue',
                'email' => 'cuentas@acerosdelgado.test', 'phone' => '+1 555 0212', 'terms' => 45, 'credit' => 60_000_00,
                'locations' => [
                    ['bodega', 'Bodega Laredo', '8100 San Dario Avenue', 'Laredo', 'TX', '78041'],
                ],
            ],
            [
                'key' => 'harborworks', 'name' => 'Harborworks Marine Fabrication LLC',
                'city' => 'Savannah', 'state' => 'GA', 'zip' => '31404', 'line1' => '2200 President Street',
                'email' => 'billing@harborworks.test', 'phone' => '+1 555 0223', 'terms' => 30, 'credit' => 40_000_00,
                'locations' => [
                    ['dock', 'Savannah Dock 4', '2200 President Street', 'Savannah', 'GA', '31404'],
                ],
            ],
            [
                'key' => 'greatlakes', 'name' => 'Great Lakes Wind Components Inc.',
                'city' => 'Gary', 'state' => 'IN', 'zip' => '46403', 'line1' => '6100 Industrial Highway',
                'email' => 'accounts@glwindcomp.test', 'phone' => '+1 555 0234', 'terms' => 60, 'credit' => 120_000_00,
                'locations' => [
                    ['plant', 'Gary Component Plant', '6100 Industrial Highway', 'Gary', 'IN', '46403'],
                    ['staging', 'Peoria Staging Field', '3300 West Farmington Road', 'Peoria', 'IL', '61604'],
                ],
            ],
        ];

        $out = [];

        foreach ($rows as $r) {
            $customerId = $this->upsert('customers', [
                'company_name_normalized' => NameKey::for($r['name']),
            ], [
                'company_name' => $r['name'],
                'email' => $r['email'],
                'email_normalized' => strtolower($r['email']),
                'phone' => $r['phone'],
                'phone_normalized' => preg_replace('/\D+/', '', $r['phone']),
                'physical_line1' => $r['line1'],
                'physical_city' => $r['city'],
                'physical_state' => $r['state'],
                'physical_postal_code' => $r['zip'],
                'billing_same_as_physical' => true,
                'credit_limit_cents' => $r['credit'],
                'credit_approved' => true,
                'payment_terms_days' => $r['terms'],
                'status' => 'active',
            ]);

            $locations = [];

            foreach ($r['locations'] as $i => [$slug, $name, $line1, $city, $state, $zip]) {
                $locations[$slug] = $this->upsert('customer_locations', [
                    'customer_id' => $customerId,
                    'name' => $name,
                ], [
                    'line1' => $line1,
                    'city' => $city,
                    'state' => $state,
                    'postal_code' => $zip,
                    'country' => 'US',
                    'timezone' => in_array($state, ['GA'], true) ? 'America/New_York' : 'America/Chicago',
                    'is_primary' => $i === 0,
                ]);
            }

            $out[$r['key']] = ['id' => $customerId, 'locations' => $locations];
        }

        return $out;
    }

    /**
     * Ocho cargas repartidas por el ciclo de vida, incluidas una sobredimensionada
     * y una cancelada.
     *
     * @param  array<string, string>  $carriers
     * @param  array<string, array{id: string, locations: array<string, string>}>  $customers
     * @param  array<string, string>  $drivers
     * @param  array<string, string>  $equipment
     */
    private function loads(array $carriers, array $customers, array $drivers, array $equipment): void
    {
        $now = Carbon::now();
        $dispatcher = $this->users['dispatcher@demo.test'] ?? null;

        $rows = [
            ['GD-24001', 'permian', 'atlas', LoadStatus::Delivered, 'step_deck', 'Drilling mast section', 44_800, -12, false, 620, 4_850_00, 3_900_00],
            ['GD-24002', 'delgado', 'cordillera', LoadStatus::InTransit, 'flatbed', 'Rollos de acero laminado', 47_200, -1, false, 310, 2_150_00, 1_720_00],
            ['GD-24003', 'greatlakes', 'atlas', LoadStatus::Dispatched, 'rgn', 'Wind turbine nacelle', 96_000, 2, true, 480, 12_400_00, 9_920_00],
            ['GD-24004', 'harborworks', null, LoadStatus::Available, 'lowboy', 'Marine crane boom', 78_500, 6, true, 720, 9_800_00, null],
            ['GD-24005', 'permian', 'cordillera', LoadStatus::PodReceived, 'flatbed', 'Pipe bundles', 46_000, -20, false, 205, 1_680_00, 1_344_00],
            ['GD-24006', 'greatlakes', 'atlas', LoadStatus::Invoiced, 'double_drop', 'Transformer housing', 62_400, -34, true, 545, 7_250_00, 5_800_00],
            ['GD-24007', 'delgado', null, LoadStatus::Draft, 'flatbed', 'Perfiles estructurales', 41_000, 9, false, 288, 1_950_00, null],
            ['GD-24008', 'harborworks', 'bluewater', LoadStatus::Cancelled, 'flatbed', 'Deck plating', 38_000, -8, false, 190, 1_400_00, 1_120_00],

            // Entregadas y sin facturar, repartidas entre transportistas y en el
            // tiempo. Son las que le dan material a la mitad del dinero: con una
            // sola entregada salía UNA factura, un cobro y una comisión, y las
            // pantallas de facturas, cobros, liquidaciones e informes parecían
            // vacías en una demostración. `delivered` y no `pod_received` ni
            // `invoiced` porque es el único estado que la aplicación considera
            // facturable — un sembrador que se salte esa regla enseña un
            // producto que no existe.
            ['GD-24009', 'permian', 'atlas', LoadStatus::Delivered, 'rgn', 'Excavator, tracked', 71_000, -46, true, 690, 8_600_00, 6_880_00],
            ['GD-24010', 'delgado', 'cordillera', LoadStatus::Delivered, 'flatbed', 'Bobinas de aluminio', 44_500, -30, false, 340, 2_480_00, 1_984_00],
            ['GD-24011', 'greatlakes', 'bluewater', LoadStatus::Delivered, 'step_deck', 'Press brake frame', 58_200, -18, false, 415, 3_950_00, 3_160_00],
        ];

        foreach ($rows as [$number, $customerKey, $carrierKey, $status, $equipType, $commodity, $weight, $dayOffset, $oversize, $miles, $charge, $carrierRate]) {
            $customer = $customers[$customerKey];
            $pickupAt = $now->copy()->addDays($dayOffset)->setTime(8, 0);
            $deliveryAt = $pickupAt->copy()->addDays(2)->setTime(14, 0);
            $past = $dayOffset < 0;

            $loadId = $this->upsert('loads', ['load_number' => $number], [
                'customer_id' => $customer['id'],
                'carrier_id' => $carrierKey === null ? null : $carriers[$carrierKey],
                'carrier_locked_at' => $carrierKey === null ? null : $pickupAt->copy()->subDays(2),
                'dispatcher_user_id' => $status === LoadStatus::Draft ? null : $dispatcher,
                'status' => $status->value,
                'commodity' => $commodity,
                'weight_pounds' => $weight,
                'width_inches' => $oversize ? 144 : 96,
                'height_inches' => $oversize ? 174 : 150,
                'length_inches' => $oversize ? 780 : 576,
                'required_equipment_type_id' => $equipment[$equipType],
                'is_oversize' => $oversize,
                'is_overweight' => $weight > 80_000,
                'gross_vehicle_weight_pounds' => $weight + 32_000,
                'customer_charge_cents' => $charge,
                // Cero y no null: la columna es NOT NULL DEFAULT 0. Una carga
                // sin transportista todavía no tiene tarifa pactada, y el cero
                // es lo que el esquema entiende por eso.
                'carrier_gross_rate_cents' => $carrierRate ?? 0,
                // Se copia la tarifa del transportista EN EL MOMENTO de asignar,
                // no se lee del transportista al mostrar: si mañana cambia su
                // porcentaje, esta carga tiene que seguir liquidando con el que
                // se pactó.
                'carrier_dispatch_fee_bps' => $carrierKey === 'cordillera' ? 1200 : 1000,
                'miles' => $miles,
                'deadhead_miles' => random_int(10, 90),
                'planned_pickup_at' => $pickupAt,
                'planned_delivery_at' => $deliveryAt,
                'actual_pickup_at' => $past && $status !== LoadStatus::Cancelled ? $pickupAt->copy()->addMinutes(35) : null,
                'actual_delivery_at' => $past && in_array($status, [LoadStatus::Delivered, LoadStatus::PodReceived, LoadStatus::Invoiced], true)
                    ? $deliveryAt->copy()->addMinutes(50)
                    : null,
                'pod_received_at' => in_array($status, [LoadStatus::PodReceived, LoadStatus::Invoiced], true)
                    ? $deliveryAt->copy()->addHours(6)
                    : null,
                'cancelled_at' => $status === LoadStatus::Cancelled ? $pickupAt->copy()->subDay() : null,
                'cancellation_reason' => $status === LoadStatus::Cancelled
                    ? 'Customer rescheduled the fabrication run; load released.'
                    : null,
                'special_instructions' => $oversize
                    ? 'Oversize permits required in every state on the route. Escort assignment pending.'
                    : null,
            ]);

            $locationIds = array_values($customer['locations']);
            $pickupLocation = $locationIds[0];
            $deliveryLocation = $locationIds[count($locationIds) - 1];

            $this->upsert('load_stops', ['load_id' => $loadId, 'sequence' => 1], [
                'stop_type' => StopType::Pickup->value,
                'customer_location_id' => $pickupLocation,
                'appointment_type' => 'window',
                'window_start' => $pickupAt,
                'window_end' => $pickupAt->copy()->addHours(4),
                'planned_arrival_at' => $pickupAt,
                'actual_arrival_at' => $past && $status !== LoadStatus::Cancelled ? $pickupAt->copy()->addMinutes(20) : null,
            ]);

            $this->upsert('load_stops', ['load_id' => $loadId, 'sequence' => 2], [
                'stop_type' => StopType::Delivery->value,
                'customer_location_id' => $deliveryLocation,
                'appointment_type' => 'fcfs',
                'window_start' => $deliveryAt,
                'window_end' => $deliveryAt->copy()->addHours(6),
                'planned_arrival_at' => $deliveryAt,
                'actual_arrival_at' => in_array($status, [LoadStatus::Delivered, LoadStatus::PodReceived, LoadStatus::Invoiced], true)
                    ? $deliveryAt->copy()->addMinutes(40)
                    : null,
            ]);

            $this->loadCrew($loadId, $status, $carrierKey, $carriers, $drivers, $oversize);
        }

        // El contador arranca donde termina la serie sembrada.
        //
        // Sin esto, la primera carga que alguien da de alta en la demostración
        // sale GD-01000 al lado de ocho cargas GD-240xx, y parece que el sistema
        // numera al azar. La serie visible es lo primero que mira quien evalúa
        // esto, y una discontinuidad ahí resta más confianza de lo que costaría
        // arreglarla después.
        $highest = DB::table('loads')
            ->where('tenant_id', $this->tenantId)
            ->orderByDesc('load_number')
            ->value('load_number');

        if ($highest !== null && preg_match('/(\d+)$/', (string) $highest, $m) === 1) {
            DB::table('tenant_settings')
                ->where('tenant_id', $this->tenantId)
                ->update(['load_number_next_sequence' => ((int) $m[1]) + 1]);
        }
    }

    /**
     * Camión, conductor y permiso para las cargas que ya salieron.
     *
     * Sin esto los datos de demostración enseñaban una carga en `dispatched` sin
     * camión ni conductor asignado — un estado que el propio sistema no deja
     * alcanzar, porque Guards::forDispatch() lo bloquea. Unos datos que
     * contradicen las reglas son peores que no tener datos: quien los mira
     * aprende una forma de trabajar que la aplicación va a rechazar.
     *
     * @param  array<string, string>  $carriers
     * @param  array<string, string>  $drivers
     */
    private function loadCrew(
        string $loadId,
        LoadStatus $status,
        ?string $carrierKey,
        array $carriers,
        array $drivers,
        bool $oversize,
    ): void {
        // Solo desde `dispatched` en adelante. Una carga `available` sin camión
        // no es una incoherencia: es exactamente lo que significa ese estado.
        $rolling = [
            LoadStatus::Dispatched, LoadStatus::EnRouteToPickup, LoadStatus::AtPickup,
            LoadStatus::InTransit, LoadStatus::AtDelivery, LoadStatus::Delivered,
            LoadStatus::PodReceived, LoadStatus::Invoiced,
        ];

        if ($carrierKey === null || ! in_array($status, $rolling, true)) {
            return;
        }

        $carrierId = $carriers[$carrierKey] ?? null;

        if ($carrierId === null) {
            return;
        }

        $truck = DB::table('trucks')
            ->where('tenant_id', $this->tenantId)
            ->where('carrier_id', $carrierId)
            ->whereNull('deleted_at')
            ->where('status', 'active')
            ->value('id');

        $trailer = DB::table('trailers')
            ->where('tenant_id', $this->tenantId)
            ->where('carrier_id', $carrierId)
            ->whereNull('deleted_at')
            ->value('id');

        // El conductor tiene que ser de ESE transportista y estar al día. Coger
        // uno cualquiera sembraría justo la incoherencia que esto viene a
        // arreglar, solo que más difícil de ver.
        $driver = DB::table('drivers')
            ->where('tenant_id', $this->tenantId)
            ->whereNull('deleted_at')
            ->where('status', '!=', 'inactive')
            ->whereDate('license_expires_at', '>', Carbon::now())
            ->whereDate('medical_card_expires_at', '>', Carbon::now())
            ->whereIn('id', function ($q) use ($carrierId): void {
                // La tabla puente se llama driver_carrier_relationships: un
                // conductor puede trabajar para varios transportistas a lo largo
                // del tiempo, y la relación tiene fechas.
                $q->select('driver_id')
                    ->from('driver_carrier_relationships')
                    ->where('carrier_id', $carrierId)
                    ->whereNull('deleted_at');
            })
            ->value('id');

        // Se PREFIERE el conductor atado a driver@demo.test cuando trabaja para
        // este transportista. No es un capricho de los datos: sin esto, la
        // cuenta de demostración de conductor entra con sus quince permisos y no
        // ve ninguna carga — menú lleno y pantallas vacías, que es la peor
        // combinación posible para juzgar si algo funciona.
        $demoDriver = DB::table('user_tenant_memberships')
            ->where('tenant_id', $this->tenantId)
            ->where('role', 'driver')
            ->whereNotNull('driver_id')
            ->value('driver_id');

        if ($demoDriver !== null) {
            $worksHere = DB::table('driver_carrier_relationships')
                ->where('driver_id', $demoDriver)
                ->where('carrier_id', $carrierId)
                ->whereNull('deleted_at')
                ->exists();

            $eligible = DB::table('drivers')
                ->where('id', $demoDriver)
                ->where('status', '!=', 'inactive')
                ->whereDate('license_expires_at', '>', Carbon::now())
                ->whereDate('medical_card_expires_at', '>', Carbon::now())
                ->exists();

            if ($worksHere && $eligible) {
                $driver = $demoDriver;
            }
        }

        // Sin conductor apto de ese transportista, se coge cualquiera al día:
        // el esquema de demostración no siempre ata conductores a transportistas.
        $driver ??= DB::table('drivers')
            ->where('tenant_id', $this->tenantId)
            ->whereNull('deleted_at')
            ->where('status', '!=', 'inactive')
            ->whereDate('license_expires_at', '>', Carbon::now())
            ->whereDate('medical_card_expires_at', '>', Carbon::now())
            ->value('id');

        if ($truck !== null) {
            $this->upsert('load_assignments', ['load_id' => $loadId, 'resource_type' => 'truck'], [
                'truck_id' => $truck,
                'is_primary' => true,
                'assigned_by_user_id' => null,
            ]);
        }

        if ($trailer !== null) {
            $this->upsert('load_assignments', ['load_id' => $loadId, 'resource_type' => 'trailer'], [
                'trailer_id' => $trailer,
                'is_primary' => true,
                'assigned_by_user_id' => null,
            ]);
        }

        if ($driver !== null) {
            $this->upsert('load_assignments', ['load_id' => $loadId, 'resource_type' => 'driver'], [
                'driver_id' => $driver,
                'is_primary' => true,
                'assigned_by_user_id' => null,
            ]);
        }

        // Una carga sobredimensionada que ya salió tiene su permiso aprobado por
        // una persona. Es la puerta de cumplimiento más dura del sistema y los
        // datos tienen que respetarla.
        if ($oversize) {
            $approver = DB::table('user_tenant_memberships')
                ->where('tenant_id', $this->tenantId)
                ->where('role', 'admin')
                ->value('user_id');

            DB::table('loads')->where('id', $loadId)->update([
                'permit_ready_approved_by_user_id' => $approver,
                'permit_ready_approved_at' => Carbon::now()->subDays(4),
                'oversize_validated_by_user_id' => $approver,
                'oversize_validated_at' => Carbon::now()->subDays(4),
            ]);
        }
    }

    /**
     * Ata las cuentas de demostración a los datos.
     *
     * Sin esto, carrier@demo.test entra con 37 permisos de ámbito `carrier` y no
     * ve NADA, porque no está atado a ningún transportista; y driver@demo.test
     * igual. El menú saldría lleno y todas las pantallas vacías, que es la peor
     * combinación posible para juzgar si algo funciona.
     *
     * @param  array<string, string>  $carriers
     * @param  array<string, string>  $drivers
     */
    private function linkDemoUsers(array $carriers, array $drivers): void
    {
        $now = Carbon::now();

        if (isset($this->users['carrier@demo.test'])) {
            DB::table('user_tenant_memberships')
                ->where('tenant_id', $this->tenantId)
                ->where('user_id', $this->users['carrier@demo.test'])
                ->where('role', Role::Carrier->value)
                ->update(['carrier_id' => $carriers['atlas'], 'updated_at' => $now]);

            $this->upsert('carrier_users', [
                'carrier_id' => $carriers['atlas'],
                'user_id' => $this->users['carrier@demo.test'],
            ], [
                'is_primary' => true,
                'title' => 'Operations Manager',
            ]);
        }

        if (isset($this->users['driver@demo.test'])) {
            DB::table('user_tenant_memberships')
                ->where('tenant_id', $this->tenantId)
                ->where('user_id', $this->users['driver@demo.test'])
                ->where('role', Role::Driver->value)
                ->update(['driver_id' => $drivers['salas'], 'updated_at' => $now]);

            DB::table('drivers')
                ->where('id', $drivers['salas'])
                ->update(['user_id' => $this->users['driver@demo.test'], 'updated_at' => $now]);
        }

        // El despachador lleva DOS de los seis transportistas. Que no los lleve
        // todos es el punto: es la única forma de comprobar en pantalla que el
        // ámbito `assigned` estrecha de verdad.
        if (isset($this->users['dispatcher@demo.test'])) {
            foreach (['atlas', 'northline'] as $key) {
                $this->upsert('dispatcher_resource_assignments', [
                    'dispatcher_user_id' => $this->users['dispatcher@demo.test'],
                    'resource_type' => 'carrier',
                    'resource_id' => $carriers[$key],
                ], [
                    'start_date' => $now->copy()->subDays(120),
                    'end_date' => null,
                    'assigned_by_user_id' => $this->users['admin@demo.test'] ?? null,
                    'reason' => 'Cartera asignada en la incorporación del despachador.',
                ]);
            }
        }
    }

    // ------------------------------------------------------------------ utilería

    /**
     * Inserta o actualiza por una clave natural y devuelve el id.
     *
     * Se usa el query builder y no Eloquent a propósito: son noventa y dos
     * modelos con casts, mutadores y eventos, y un seeder que los atraviesa todos
     * acaba dependiendo de detalles de cada uno. Aquí lo que interesa es que las
     * filas queden exactamente como se declaran.
     *
     * @param  array<string, mixed>  $key
     * @param  array<string, mixed>  $values
     */
    private function upsert(string $table, array $key, array $values): string
    {
        $scope = [...$key, 'tenant_id' => $this->tenantId];

        $existing = DB::table($table)->where($scope)->first(['id']);
        $now = Carbon::now();

        $hasTimestamps = ! in_array($table, ['document_expirations'], true);

        if ($existing !== null) {
            DB::table($table)->where('id', $existing->id)->update(
                $hasTimestamps ? [...$values, 'updated_at' => $now] : $values
            );

            return (string) $existing->id;
        }

        $id = (string) Str::uuid();

        DB::table($table)->insert([
            'id' => $id,
            ...$scope,
            ...$values,
            ...($hasTimestamps ? ['created_at' => $values['created_at'] ?? $now, 'updated_at' => $values['updated_at'] ?? $now] : []),
        ]);

        return $id;
    }

    /**
     * Gastos sobre las cargas ya entregadas.
     *
     * Están puestos para que se vean los CUATRO tratamientos, no para llenar una
     * tabla. Sin un gasto excluido de por medio, las dos formas posibles de
     * calcular la tarifa de despacho dan exactamente el mismo número, y la
     * decisión de cuál es la correcta parecería no importar — que es justo la
     * trampa que estos datos existen para evitar.
     *
     * La carga sobredimensionada lleva su permiso y su escolta como excluidos:
     * son dinero que solo pasa por las manos del transportista.
     */
    private function expenses(): void
    {
        $categories = DB::table('expense_categories')
            ->where('tenant_id', $this->tenantId)
            ->get(['id', 'code', 'treatment'])
            ->keyBy('code');

        $admin = DB::table('user_tenant_memberships')
            ->where('tenant_id', $this->tenantId)
            ->where('role', 'admin')
            ->value('user_id');

        if ($admin === null) {
            // Sin usuarios de demostración sembrados no hay a quién atribuir el
            // gasto, y `submitted_by_user_id` no admite nulo. Se salta en vez de
            // reventar: este sembrador corre en despliegues donde el de usuarios
            // no se ha ejecutado.
            return;
        }

        $rows = [
            ['GD-24003', 'permit', 340000, 'Permiso de sobredimensión Texas–Oklahoma'],
            ['GD-24003', 'escort', 185000, 'Dos escoltas, tramo I-40'],
            ['GD-24003', 'fuel', 62000, 'Combustible anticipado en Amarillo'],
            ['GD-24001', 'lumper', 15000, 'Maniobra de descarga en destino'],
            ['GD-24001', 'tolls', 8400, 'Peajes de la ruta'],
            ['GD-24005', 'lumper', 7500, 'Maniobra en el patio del cliente'],
            ['GD-24005', 'other', 4000, 'Reimpresión de documentación'],
            ['GD-24006', 'permit', 96000, 'Permiso de altura, corredor de Illinois'],
            ['GD-24006', 'repair', 21000, 'Cambio de neumático en ruta'],
            // Uno que LO ASUME LA CASA sobre una carga que sí se factura. Sin él,
            // el margen bruto salía idéntico a la tarifa de despacho en todas
            // las filas del informe, y dos columnas con el mismo número siempre
            // parecen un fallo aunque sean correctas.
            ['GD-24009', 'other', 18000, 'Cortesía al cliente por una demora nuestra'],
            ['GD-24010', 'fuel', 34000, 'Combustible adelantado en Monterrey'],
        ];

        foreach ($rows as [$loadNumber, $code, $cents, $description]) {
            $load = DB::table('loads')
                ->where('tenant_id', $this->tenantId)
                ->where('load_number', $loadNumber)
                ->first(['id', 'carrier_id']);

            if ($load === null || ! isset($categories[$code])) {
                continue;
            }

            // El tratamiento se COPIA de la categoría, no se consulta después.
            // Es lo que exige la columna: `treatment_snapshot`. Si mañana se
            // reclasifica «peajes» de retención a absorbido, las liquidaciones
            // ya cerradas no pueden cambiar de importe.
            $this->upsert('expenses', [
                'load_id' => $load->id,
                'category_id' => $categories[$code]->id,
            ], [
                'carrier_id' => $load->carrier_id,
                'treatment_snapshot' => $categories[$code]->treatment,
                'amount_cents' => $cents,
                'description' => $description,
                'incurred_on' => Carbon::now()->subDays(random_int(3, 20)),
                'status' => 'approved',
                'submitted_by_user_id' => $admin,
                'reviewed_by_user_id' => $admin,
                'reviewed_at' => Carbon::now()->subDays(2),
            ]);
        }
    }

    /**
     * La mitad del dinero: facturar, cobrar, liquidar y devengar comisiones.
     *
     * LLAMA AL CÓDIGO REAL —InvoiceBuilder, PaymentLedger, SettlementBuilder,
     * CommissionLedger— en vez de meter filas a mano. Dos motivos:
     *
     *  1. Un sembrador que fabrica sus propias facturas se separa de la
     *     aplicación en cuanto alguien cambia una regla, y entonces la
     *     demostración enseña un producto que no existe.
     *  2. Así sembrar es también una prueba de humo del circuito entero: si
     *     algo de la cadena está roto, `db:seed` lo dice.
     *
     * Sin esto la demostración enseñaba facturas, cobros, liquidaciones y
     * comisiones VACÍAS, y los informes todos a cero — que es peor que no
     * tenerlos.
     */
    private function money(): void
    {
        $adminId = DB::table('user_tenant_memberships')
            ->where('tenant_id', $this->tenantId)
            ->where('role', 'admin')
            ->value('user_id');

        if ($adminId === null) {
            // Igual que en expenses(): sin usuarios de demostración no hay a
            // quién atribuir nada, y las columnas de autor no admiten nulo.
            return;
        }

        $actor = $this->actorFor((string) $adminId);

        $porTransportista = Load::query()
            ->where('tenant_id', $this->tenantId)
            ->where('status', 'delivered')
            ->whereNotNull('carrier_id')
            ->where('carrier_gross_rate_cents', '>', 0)
            ->orderBy('load_number')
            ->get()
            ->groupBy('carrier_id');

        if ($porTransportista->isEmpty()) {
            return;
        }

        $facturas = [];

        foreach ($porTransportista as $carrierId => $cargas) {
            $yaFacturadas = DB::table('invoice_line_items')
                ->whereIn('load_id', $cargas->pluck('id')->all())
                ->whereNull('deleted_at')
                ->pluck('load_id')
                ->all();

            $pendientes = $cargas->reject(fn (Load $l): bool => in_array($l->id, $yaFacturadas, true))->values();

            if ($pendientes->isEmpty()) {
                continue;
            }

            // Una factura por transportista, con el plazo de la empresa.
            $facturas[] = app(InvoiceBuilder::class)->fromLoads(
                $actor,
                (string) $carrierId,
                $pendientes->all(),
                TenantPolicy::for($this->tenantId)->paymentTermsDays,
            );
        }

        $this->sendAndCollect($actor, $facturas);
        $this->settle($actor, $porTransportista);
        $this->paySomeCommissions($actor);
    }

    /**
     * Emite las facturas y cobra algunas.
     *
     * Se reparten a propósito: una cobrada entera, una a medias, y una vencida
     * hace tres meses y sin cobrar. Sin ese reparto la antigüedad del cobro
     * enseña un solo tramo y no se ve para qué sirve.
     *
     * @param  list<string>  $facturas
     */
    private function sendAndCollect(Actor $actor, array $facturas): void
    {
        foreach (array_values($facturas) as $i => $invoiceId) {
            $factura = DB::table('invoices')->where('id', $invoiceId)->first();

            if ($factura === null || $factura->status !== 'draft') {
                continue;
            }

            // La tercera se deja vencida y sin cobrar; las demás salen hoy.
            $emitida = $i === 2 ? Carbon::now()->subDays(100) : Carbon::now()->subDays(3);
            $vence = $emitida->copy()->addDays((int) $factura->payment_terms_days);

            // Espejo de InvoiceController::send(). Aquí no hay petición HTTP que
            // pueda llamarlo, y son tres columnas; el DINERO, que es lo que
            // puede desviarse, sí sale del código real.
            DB::table('invoices')->where('id', $invoiceId)->update([
                'status' => 'sent',
                'issue_date' => $emitida,
                'sent_at' => $emitida,
                'due_date' => $vence,
                'updated_at' => Carbon::now(),
            ]);

            $total = (int) $factura->total_cents;

            $cobro = match ($i % 3) {
                0 => $total,                        // cobrada entera
                1 => (int) round($total * 0.4),     // a medias
                default => 0,                       // vencida y sin cobrar
            };

            if ($cobro <= 0) {
                continue;
            }

            PaymentLedger::record($actor, (object) [
                'id' => $invoiceId,
                'invoice_number' => $factura->invoice_number,
            ], [
                'amount_cents' => $cobro,
                'method' => $i % 2 === 0 ? 'wire' : 'check',
                'status' => 'succeeded',
                'reference' => sprintf('DEMO-%04d', 1000 + $i),
                'received_at' => $emitida->copy()->addDays(2)->toDateString(),
                'notes' => null,
            ]);
        }
    }

    /**
     * Liquida al primer transportista, para que la pantalla no salga vacía.
     *
     * @param  \Illuminate\Support\Collection<string, \Illuminate\Support\Collection<int, Load>>  $porTransportista
     */
    private function settle(Actor $actor, $porTransportista): void
    {
        $carrierId = (string) $porTransportista->keys()->first();
        $cargas = $porTransportista->get($carrierId);

        $yaLiquidadas = DB::table('carrier_settlement_lines')
            ->whereIn('load_id', $cargas->pluck('id')->all())
            ->whereNull('deleted_at')
            ->pluck('load_id')
            ->all();

        $pendientes = $cargas->reject(fn (Load $l): bool => in_array($l->id, $yaLiquidadas, true))->values();

        if ($pendientes->isEmpty()) {
            return;
        }

        // Reutiliza la instantánea que congeló la factura: es el punto entero de
        // SettlementBuilder y conviene que la demostración lo enseñe.
        app(SettlementBuilder::class)->fromLoads($actor, $carrierId, $pendientes->all());
    }

    /**
     * Marca pagada la mitad de lo devengado, para que la pantalla de comisiones
     * enseñe las dos caras.
     */
    private function paySomeCommissions(Actor $actor): void
    {
        $ids = DB::table('dispatcher_commissions')
            ->where('tenant_id', $this->tenantId)
            ->where('status', 'accrued')
            ->orderBy('created_at')
            ->pluck('id')
            ->all();

        if ($ids === []) {
            return;
        }

        CommissionLedger::markPaid($actor, array_map(
            static fn ($id): string => (string) $id,
            array_slice($ids, 0, (int) ceil(count($ids) / 2)),
        ));
    }

    /**
     * Un Actor de verdad para el administrador de la demostración.
     *
     * Los constructores de dinero piden un Actor porque de él sacan la empresa y
     * a quién atribuir cada apunte. En un sembrador no hay petición, así que se
     * arma a mano con los mismos datos que tendría en una.
     */
    private function actorFor(string $userId): Actor
    {
        $u = app(TenantContext::class)->withoutTenant(fn () => DB::table('users')
            ->where('id', $userId)
            ->first(['email', 'first_name', 'last_name', 'locale', 'timezone']));

        return new Actor(
            userId: $userId,
            email: (string) ($u->email ?? ''),
            firstName: (string) ($u->first_name ?? ''),
            lastName: (string) ($u->last_name ?? ''),
            locale: Locale::tryFrom((string) ($u->locale ?? 'en')) ?? Locale::En,
            timezone: (string) ($u->timezone ?? 'America/New_York'),
            isPlatformSuperAdmin: false,
            tenantId: $this->tenantId,
            role: Role::Admin,
        );
    }

    private function report(): void
    {
        $counts = [];

        $tablas = [
            'carriers', 'carrier_onboardings', 'fmcsa_verifications', 'documents',
            'trucks', 'trailers', 'drivers', 'customers', 'customer_locations',
            'loads', 'load_stops',
            // La mitad del dinero. Sin estas filas la demostración enseñaba
            // facturas, cobros y comisiones vacías, y los informes a cero.
            'expenses', 'financial_snapshots', 'invoices', 'invoice_line_items',
            'payments', 'carrier_settlements', 'dispatcher_commissions',
        ];

        foreach ($tablas as $table) {
            $counts[] = [$table, DB::table($table)->where('tenant_id', $this->tenantId)->count()];
        }

        $this->command->info('Datos de demostración para Demo Dispatch:');
        $this->command->table(['Tabla', 'Filas'], $counts);
        $this->command->warn('Datos inventados: ningún número DOT, licencia ni persona corresponde a nadie real.');
    }
}
