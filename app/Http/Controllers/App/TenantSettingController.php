<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\AuditAction;
use App\Enums\CommissionBasis;
use App\Support\Audit;
use App\Support\Finance\FeeBase;
use App\Support\Geo\Regions;
use App\Support\Branding\Brand;
use App\Support\Branding\Templates;
use App\Support\Storage\DocumentStore;
use App\Support\TenantContext;
use App\Support\InertiaPage;
use App\Support\Tenancy\TenantPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Los ajustes de la empresa.
 *
 * Aquí vive la POLÍTICA: con qué tarifa y qué comisión nace una carga, a cuántos
 * días vence una factura, con cuánta antelación se avisa de una caducidad, cómo
 * se numeran cargas y facturas, y sobre qué base se calcula la tarifa de
 * despacho. Seis sitios del código leen esta fila en vivo y hasta ahora solo se
 * podía cambiar entrando a MySQL.
 *
 * QUÉ NO SE PUEDE CAMBIAR AQUÍ, Y POR QUÉ
 *
 *  • Los CONTADORES de numeración (`load_number_next_sequence`,
 *    `invoice_number_next_sequence`). El prefijo sí; el contador no. Bajarlo
 *    repetiría números de factura ya emitidos, y dos facturas con el mismo
 *    número es un problema contable, no una molestia. Se enseñan para saber por
 *    dónde va la cuenta.
 *  • La política de RETENCIÓN (meses de archivo, años de purga). Cambiarla tiene
 *    consecuencias legales y no debería ser un campo más de un formulario que
 *    alguien rellena de paso. Se enseña, no se edita.
 *
 * Cambiar los valores por defecto NO reescribe nada de lo ya creado: una carga
 * guarda su tarifa y su comisión en sus propias columnas desde que se acordó, y
 * una factura emitida conserva su plazo. Esto solo decide con qué nacen las
 * siguientes.
 */
final class TenantSettingController
{
    use InertiaPage;

    public function edit(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'tenant:settings:read', null, $policy);

        // `platform` por las etiquetas del estado de la suscripción
        // (`platform.status.trialing`…): el panel del plan las usa y viven en
        // ese diccionario porque las comparte con las pantallas de plataforma.
        $this->usesDictionary($request, ['settings', 'platform', 'nav', 'common', 'validation']);

        $fila = $this->row((string) $actor->tenantId);

        return Inertia::render('App/Settings/Index', [
            'settings' => $this->present($fila),
            'subscription' => $this->subscription((string) $actor->tenantId),
            'readOnly' => [
                'loadNextSequence' => (int) ($fila->load_number_next_sequence ?? 0),
                'invoiceNextSequence' => (int) ($fila->invoice_number_next_sequence ?? 0),
                'operationalActiveMonths' => (int) ($fila->operational_active_months ?? 0),
                'operationalPurgeYears' => (int) ($fila->operational_purge_years_after_archive ?? 0),
                'financialRetentionYears' => (int) ($fila->financial_retention_years ?? 0),
            ],
            // La cara de la empresa: su logo, sus colores y su pie de correo.
            // Se edita aquí y se ve donde mira alguien que NO es usuario nuestro
            // — la página pública de rastreo y el correo que la reparte. Ver
            // App\Support\Branding\Brand.
            'branding' => Brand::for((string) $actor->tenantId),
            // Uno por evento reescribible. En LISTA y no uno suelto: declarar
            // un evento editable y no darle editor es prometer una puerta que no
            // existe, que es el defecto que este proyecto lleva media docena de
            // lotes cerrando.
            'templates' => $this->templates((string) $actor->tenantId),
            'feeBases' => array_map(static fn (FeeBase $b): string => $b->value, FeeBase::cases()),
            'commissionBases' => array_map(static fn (CommissionBasis $b): string => $b->value, CommissionBasis::cases()),
            'can' => [
                'update' => $checker->can($actor, 'tenant:settings:update', null, $policy)->allowed,
            ],
        ]);
    }

    public function update(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'tenant:settings:update', null, $current->policy());

        $data = $request->validate([
            // Dinero
            'dispatch_fee_base' => ['required', Rule::in(array_map(
                static fn (FeeBase $b): string => $b->value, FeeBase::cases()
            ))],
            'default_carrier_dispatch_fee_bps' => ['required', 'integer', 'min:0', 'max:10000'],
            'default_dispatcher_commission_bps' => ['required', 'integer', 'min:0', 'max:10000'],
            'dispatcher_commission_basis' => ['required', Rule::in(array_map(
                static fn (CommissionBasis $b): string => $b->value, CommissionBasis::cases()
            ))],
            'default_payment_terms_days' => ['required', 'integer', 'min:0', 'max:365'],

            // Numeración: solo el prefijo. Ver la cabecera de la clase.
            'load_number_prefix' => ['required', 'string', 'max:12', 'regex:/^[A-Z0-9-]+$/'],
            'invoice_number_prefix' => ['required', 'string', 'max:12', 'regex:/^[A-Z0-9-]+$/'],

            // Operación
            'document_expiration_warning_days' => ['required', 'integer', 'min:1', 'max:365'],
            'fmcsa_reverification_days' => ['required', 'integer', 'min:1', 'max:365'],
            'allow_dispatcher_resource_assignment' => ['required', 'boolean'],
            'require_oversize_admin_validation' => ['required', 'boolean'],
            'public_tracking_enabled' => ['required', 'boolean'],
            'public_tracking_token_ttl_hours' => ['required', 'integer', 'min:1', 'max:720'],

            // Contacto público
            'contact_phone' => ['nullable', 'string', 'max:32'],
            'contact_email' => ['nullable', 'email:rfc', 'max:255'],
            'support_email' => ['nullable', 'email:rfc', 'max:255'],
            'address_line1' => ['nullable', 'string', 'max:200'],
            'address_line2' => ['nullable', 'string', 'max:200'],
            'address_city' => ['nullable', 'string', 'max:120'],
            'address_country' => ['nullable', 'string', 'size:2'],
            'address_state' => ['nullable', 'string', 'max:3'],
            'address_postal_code' => ['nullable', 'string', 'max:12'],
        ]);

        $pais = $data['address_country'] ?? Regions::DEFAULT_COUNTRY;

        // El estado tiene que ser de ese país. La misma regla que en el resto de
        // direcciones: un desplegable sin comprobación en el servidor es una
        // cortesía, no una garantía.
        if (! Regions::isSubdivisionOf($pais, $data['address_state'] ?? null)) {
            return back()->withErrors(['address_state' => __('validation.state')])->withInput();
        }

        $antes = $this->row((string) $actor->tenantId);
        $ahora = CarbonImmutable::now();

        DB::table('tenant_settings')
            ->where('tenant_id', $actor->tenantId)
            ->update([...$data, 'updated_at' => $ahora]);

        // La política cacheada de esta petición ya no vale: seguir sirviendo la
        // anterior sería mentir en la pantalla que acaba de guardar.
        TenantPolicy::forget((string) $actor->tenantId);

        Audit::record(
            $actor,
            AuditAction::SettingsUpdated,
            entityType: 'tenant_settings',
            entityId: (string) $actor->tenantId,
            entityLabel: 'settings',
            before: $this->auditable($antes),
            after: $this->auditable((object) [...(array) $antes, ...$data]),
        );

        return back()->with('success', __('settings.flash.saved'));
    }

    // ------------------------------------------------------------------ ayudas

    private function row(string $tenantId): object
    {
        $fila = DB::table('tenant_settings')->where('tenant_id', $tenantId)->first();

        abort_if($fila === null, 404);

        return $fila;
    }

    /**
     * Guardar la cara de la empresa.
     *
     * Aparte del formulario de ajustes porque lleva un fichero: mezclarlo
     * obligaría a mandar el formulario entero como multipart cada vez que
     * alguien cambia un plazo de pago.
     */
    /**
     * Las plantillas reescribibles, en el idioma de la empresa.
     *
     * @return list<array<string, mixed>>
     */
    private function templates(string $tenantId): array
    {
        $locale = $this->tenantLocale($tenantId);

        return array_map(function (string $evento) use ($tenantId, $locale): array {
            $fila = Templates::find($tenantId, $evento, $locale);

            return [
                'event' => $evento,
                'locale' => $locale,
                'subject' => $fila?->subject,
                'body' => $fila === null || $fila->body === '' ? null : $fila->body,
                'tokens' => Templates::FICHAS[$evento] ?? [],
            ];
        }, Templates::EDITABLES);
    }

    /** El idioma en el que esta empresa le escribe a sus clientes. */
    private function tenantLocale(string $tenantId): string
    {
        $locale = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenants')
            ->where('id', $tenantId)
            ->value('default_locale'));

        return in_array($locale, ['en', 'es'], true) ? (string) $locale : 'en';
    }

    public function branding(Request $request, CurrentActor $current, PermissionChecker $checker, DocumentStore $store): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'tenant:settings:update', null, $current->policy());

        $data = $request->validate([
            // Un color es un dato con forma, no una cadena cualquiera: se exige
            // `#RRGGBB` aquí y se vuelve a comprobar al leer, porque una defensa
            // que solo está en el formulario se salta con un `update`.
            'primary_color' => ['nullable', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'accent_color' => ['nullable', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'email_footer' => ['nullable', 'string', 'max:500'],
            'logo' => ['nullable', 'file', 'max:2048', 'mimetypes:image/png,image/jpeg,image/webp,image/svg+xml'],
            'templates' => ['nullable', 'array'],
            'templates.*.event' => ['required', 'string', Rule::in(Templates::EDITABLES)],
            'templates.*.subject' => ['nullable', 'string', 'max:255'],
            'templates.*.body' => ['nullable', 'string', 'max:4000'],
        ]);

        Brand::save(
            (string) $actor->tenantId,
            $data['primary_color'] ?? null,
            $data['accent_color'] ?? null,
            $data['email_footer'] ?? null,
        );

        if ($request->hasFile('logo')) {
            Brand::saveLogo($store, (string) $actor->tenantId, $request->file('logo'));
        }

        // El texto del correo al cliente, en el idioma de la empresa.
        //
        // UNO y no dos: el correo sale en `tenants.default_locale`, así que un
        // segundo editor para el otro idioma sería un campo que nadie usa y que
        // nadie sabría que existe. Cuando haga falta escribirle a cada cliente
        // en su idioma habrá que poner idioma al cliente primero —está en «lo
        // que falta» de docs/tracking-link.md— y entonces este editor crece con
        // un motivo.
        foreach ($data['templates'] ?? [] as $plantilla) {
            Templates::save(
                (string) $actor->tenantId,
                (string) $plantilla['event'],
                $this->tenantLocale((string) $actor->tenantId),
                $plantilla['subject'] ?? null,
                $plantilla['body'] ?? null,
            );
        }

        Audit::record(
            $actor,
            AuditAction::SettingsUpdated,
            entityType: 'tenant_branding',
            entityId: (string) $actor->tenantId,
            entityLabel: (string) $actor->tenantId,
            after: ['branding' => true],
        );

        return back()->with('success', __('settings.brand.saved'));
    }

    /**
     * @return array<string, mixed>
     */
    private function present(object $f): array
    {
        return [
            'dispatch_fee_base' => (string) $f->dispatch_fee_base,
            'default_carrier_dispatch_fee_bps' => (int) $f->default_carrier_dispatch_fee_bps,
            'default_dispatcher_commission_bps' => (int) $f->default_dispatcher_commission_bps,
            'dispatcher_commission_basis' => (string) $f->dispatcher_commission_basis,
            'default_payment_terms_days' => (int) $f->default_payment_terms_days,
            'load_number_prefix' => (string) $f->load_number_prefix,
            'invoice_number_prefix' => (string) $f->invoice_number_prefix,
            'document_expiration_warning_days' => (int) $f->document_expiration_warning_days,
            'fmcsa_reverification_days' => (int) $f->fmcsa_reverification_days,
            'allow_dispatcher_resource_assignment' => (bool) $f->allow_dispatcher_resource_assignment,
            'require_oversize_admin_validation' => (bool) $f->require_oversize_admin_validation,
            'public_tracking_enabled' => (bool) $f->public_tracking_enabled,
            'public_tracking_token_ttl_hours' => (int) $f->public_tracking_token_ttl_hours,
            'contact_phone' => $f->contact_phone,
            'contact_email' => $f->contact_email,
            'support_email' => $f->support_email,
            'address_line1' => $f->address_line1,
            'address_line2' => $f->address_line2,
            'address_city' => $f->address_city,
            'address_country' => $f->address_country ?? Regions::DEFAULT_COUNTRY,
            'address_state' => $f->address_state,
            'address_postal_code' => $f->address_postal_code,
        ];
    }

    /**
     * Lo que va a la auditoría: solo lo que decide dinero.
     *
     * Un cambio de teléfono público no merece una fila de auditoría financiera,
     * y meterlo todo haría que el rastro que sí importa se perdiera entre ruido.
     *
     * @return array<string, mixed>
     */
    private function auditable(object $f): array
    {
        return [
            'dispatch_fee_base' => $f->dispatch_fee_base ?? null,
            'default_carrier_dispatch_fee_bps' => (int) ($f->default_carrier_dispatch_fee_bps ?? 0),
            'default_dispatcher_commission_bps' => (int) ($f->default_dispatcher_commission_bps ?? 0),
            'dispatcher_commission_basis' => $f->dispatcher_commission_basis ?? null,
            'default_payment_terms_days' => (int) ($f->default_payment_terms_days ?? 0),
        ];
    }

    /**
     * El plan de esta empresa, para que pueda verlo.
     *
     * Hasta ahora `tenant_subscriptions` se escribía al darse de alta y no la
     * leía nadie: ni la plataforma ni la propia empresa. Alguien podía estar en
     * un periodo de prueba a punto de acabarse sin tener dónde comprobarlo.
     *
     * Es de solo lectura. Cambiar de plan pasa por cobrar, y cobrar es otro
     * lote con su pasarela; poner aquí un botón que no cobra sería peor que no
     * ponerlo.
     *
     * @return array<string, mixed>|null
     */
    private function subscription(string $tenantId): ?array
    {
        $fila = DB::table('tenant_subscriptions as s')
            ->leftJoin('saas_plans as p', 'p.id', '=', 's.plan_id')
            ->where('s.tenant_id', $tenantId)
            ->first([
                's.status', 's.trial_ends_at', 's.current_period_end', 's.cancel_at_period_end',
                'p.code', 'p.name_en', 'p.name_es', 'p.monthly_price_cents',
                'p.max_users', 'p.max_carriers', 'p.max_loads_per_month',
            ]);

        if ($fila === null) {
            return null;
        }

        return [
            'status' => (string) $fila->status,
            'planCode' => $fila->code === null ? null : (string) $fila->code,
            'planNameEn' => $fila->name_en === null ? null : (string) $fila->name_en,
            'planNameEs' => $fila->name_es === null ? null : (string) $fila->name_es,
            'monthlyPriceCents' => $fila->monthly_price_cents === null ? null : (int) $fila->monthly_price_cents,
            'trialEndsOn' => $fila->trial_ends_at === null ? null : substr((string) $fila->trial_ends_at, 0, 10),
            'periodEndsOn' => $fila->current_period_end === null ? null : substr((string) $fila->current_period_end, 0, 10),
            'cancelAtPeriodEnd' => (bool) $fila->cancel_at_period_end,
        ];
    }

}
