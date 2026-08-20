<?php

declare(strict_types=1);

namespace App\Http\Requests\Marketing;

final class StoreCarrierSignupRequest extends PublicFormRequest
{
    protected function formName(): string
    {
        return 'carrier_signup';
    }

    /** @return array<string, mixed> */
    protected function fieldRules(): array
    {
        return [
            'legal_name' => ['required', 'string', 'max:200'],
            'dba' => ['nullable', 'string', 'max:200'],
            // USDOT y MC se validan por FORMA, no por existencia: comprobar contra
            // FMCSA aquí encadenaría el formulario público a la disponibilidad de
            // un servicio externo. La verificación real ocurre en el alta, ya
            // dentro del sistema, y ahí sí puede fallar y reintentarse.
            'dot_number' => ['required', 'string', 'regex:/^\d{5,8}$/'],
            'mc_number' => ['nullable', 'string', 'regex:/^(MC)?\d{5,8}$/i'],
            'website' => ['nullable', 'url:http,https', 'max:255'],

            'contact_first_name' => ['required', 'string', 'max:100'],
            'contact_last_name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'email:rfc', 'max:255'],
            'phone' => ['required', 'string', 'max:32'],

            'physical_line1' => ['required', 'string', 'max:200'],
            'physical_line2' => ['nullable', 'string', 'max:200'],
            'physical_city' => ['required', 'string', 'max:120'],
            'physical_state' => ['required', 'string', 'size:2'],
            'physical_postal_code' => ['required', 'string', 'max:12'],

            'mailing_same_as_physical' => ['boolean'],
            'mailing_line1' => ['nullable', 'required_if:mailing_same_as_physical,false', 'string', 'max:200'],
            'mailing_line2' => ['nullable', 'string', 'max:200'],
            'mailing_city' => ['nullable', 'required_if:mailing_same_as_physical,false', 'string', 'max:120'],
            'mailing_state' => ['nullable', 'required_if:mailing_same_as_physical,false', 'string', 'size:2'],
            'mailing_postal_code' => ['nullable', 'required_if:mailing_same_as_physical,false', 'string', 'max:12'],

            'preferred_locale' => ['required', 'in:en,es'],
            'uses_factoring' => ['boolean'],

            'lead_consent' => ['accepted'],
            'privacy_consent' => ['accepted'],
            'terms_consent' => ['accepted'],
        ];
    }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'mailing_same_as_physical' => $this->boolean('mailing_same_as_physical'),
            'uses_factoring' => $this->boolean('uses_factoring'),
            'physical_state' => $this->filled('physical_state')
                ? mb_strtoupper((string) $this->input('physical_state')) : null,
            'mailing_state' => $this->filled('mailing_state')
                ? mb_strtoupper((string) $this->input('mailing_state')) : null,
            // «MC123456» y «123456» son el mismo número; se normaliza a dígitos
            // para que la unicidad por empresa no dependa de cómo lo escribieron.
            'mc_number' => $this->filled('mc_number')
                ? preg_replace('/^MC/i', '', trim((string) $this->input('mc_number'))) : null,
        ]);
    }
}
