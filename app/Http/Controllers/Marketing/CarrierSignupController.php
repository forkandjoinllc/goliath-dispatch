<?php

declare(strict_types=1);

namespace App\Http\Controllers\Marketing;

use App\Enums\Locale;
use App\Enums\OnboardingStatus;
use App\Http\Requests\Marketing\StoreCarrierSignupRequest;
use App\Models\Carrier;
use App\Models\CarrierOnboarding;
use App\Models\Lead;
use App\Support\Locales;
use App\Support\TenantContext;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;

/**
 * El alta pública de transportista.
 *
 * Hace una cosa distinta según DÓNDE se envíe, y la diferencia no es un detalle:
 *
 *  • **En el dominio propio de una empresa** hay un tenant, así que se crea un
 *    `carriers` de verdad con su `carrier_onboardings` en borrador. El
 *    transportista aparece en la cola de altas de esa empresa.
 *
 *  • **En el sitio de la plataforma** (goliathdispatch.com) NO hay empresa a la
 *    que pertenecer, y `carriers.tenant_id` es NOT NULL. Aquí sería fácil
 *    inventarse algo —crear un tenant «huérfano», o dejar la columna en null y
 *    quitar la restricción—; las dos cosas serían mentirle al esquema. Lo que se
 *    hace es lo honesto: se guarda como `lead` con origen `carrier_signup`, que
 *    es exactamente para lo que `leads` tiene columnas `dot_number` y
 *    `mc_number`. Comercial lo enruta a la empresa que corresponda.
 */
final class CarrierSignupController
{
    public function __construct(private readonly TenantContext $context) {}

    public function __invoke(StoreCarrierSignupRequest $request): RedirectResponse
    {
        $data = $request->validated();

        /** @var Locale $locale */
        $locale = $request->attributes->get('locale', Locales::default());

        DB::transaction(function () use ($data, $locale, $request): void {
            $lead = Lead::create([
                'first_name' => $data['contact_first_name'],
                'last_name' => $data['contact_last_name'],
                'email' => $data['email'],
                'phone' => $data['phone'],
                'company_name' => $data['legal_name'],
                'dot_number' => $data['dot_number'],
                'mc_number' => $data['mc_number'] ?? null,
                'locale' => $locale->value,
                'source' => 'carrier_signup',
                'source_path' => mb_substr((string) $request->headers->get('referer'), 0, 500) ?: null,
                'ip_address' => $request->ip(),
                'user_agent' => mb_substr((string) $request->userAgent(), 0, 1000),
            ]);

            if (! $this->context->hasTenant()) {
                return; // Sitio de la plataforma: el lead ES el resultado.
            }

            $carrier = Carrier::create([
                'legal_name' => $data['legal_name'],
                'dba' => $data['dba'] ?? null,
                'dot_number' => $data['dot_number'],
                'mc_number' => $data['mc_number'] ?? null,
                'contact_first_name' => $data['contact_first_name'],
                'contact_last_name' => $data['contact_last_name'],
                'email' => $data['email'],
                'phone' => $data['phone'],
                'website' => $data['website'] ?? null,
                'preferred_locale' => $data['preferred_locale'],
                'physical_line1' => $data['physical_line1'],
                'physical_line2' => $data['physical_line2'] ?? null,
                'physical_city' => $data['physical_city'],
                'physical_state' => $data['physical_state'],
                'physical_postal_code' => $data['physical_postal_code'],
                'physical_country' => 'US',
                ...$this->mailing($data),
                'uses_factoring' => $data['uses_factoring'] ?? false,
                'onboarding_status' => OnboardingStatus::Draft,
            ]);

            CarrierOnboarding::create([
                'carrier_id' => $carrier->id,
                'status' => OnboardingStatus::Draft,
            ]);

            $lead->forceFill(['status' => 'converted'])->save();
        });

        return back()->with('success', (string) __('marketing.carrierSignup.success.title'));
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function mailing(array $data): array
    {
        $same = (bool) ($data['mailing_same_as_physical'] ?? false);

        // Cuando es la misma, se COPIA en vez de dejarla vacía. Un cheque o una
        // liquidación se manda a la dirección postal, y leer «si está vacía usa
        // la física» en cada uno de esos sitios es donde acaba yendo un pago a la
        // dirección equivocada.
        return [
            'mailing_same_as_physical' => $same,
            'mailing_line1' => $same ? $data['physical_line1'] : ($data['mailing_line1'] ?? null),
            'mailing_line2' => $same ? ($data['physical_line2'] ?? null) : ($data['mailing_line2'] ?? null),
            'mailing_city' => $same ? $data['physical_city'] : ($data['mailing_city'] ?? null),
            'mailing_state' => $same ? $data['physical_state'] : ($data['mailing_state'] ?? null),
            'mailing_postal_code' => $same ? $data['physical_postal_code'] : ($data['mailing_postal_code'] ?? null),
            'mailing_country' => 'US',
        ];
    }
}
