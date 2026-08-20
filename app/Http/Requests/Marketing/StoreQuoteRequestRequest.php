<?php

declare(strict_types=1);

namespace App\Http\Requests\Marketing;

final class StoreQuoteRequestRequest extends PublicFormRequest
{
    protected function formName(): string
    {
        return 'quote';
    }

    /** @return array<string, mixed> */
    protected function fieldRules(): array
    {
        return [
            'contact_name' => ['required', 'string', 'max:200'],
            'email' => ['required', 'email:rfc', 'max:255'],
            'phone' => ['nullable', 'string', 'max:32'],
            'company_name' => ['nullable', 'string', 'max:200'],

            'commodity' => ['nullable', 'string', 'max:200'],
            // Las dimensiones se guardan en PULGADAS enteras y el peso en libras
            // enteras, igual que en el resto del sistema: una carga de 13'6" es
            // 162, no 13,5 pies. Nada de decimales en una medida que después
            // decide si hace falta permiso.
            'weight_pounds' => ['nullable', 'integer', 'min:0', 'max:2000000'],
            'length_inches' => ['nullable', 'integer', 'min:0', 'max:6000'],
            'width_inches' => ['nullable', 'integer', 'min:0', 'max:1200'],
            'height_inches' => ['nullable', 'integer', 'min:0', 'max:600'],

            'origin_city' => ['nullable', 'string', 'max:120'],
            'origin_state' => ['nullable', 'string', 'size:2'],
            'destination_city' => ['nullable', 'string', 'max:120'],
            'destination_state' => ['nullable', 'string', 'size:2'],
            'ready_date' => ['nullable', 'date', 'after_or_equal:today'],
            'equipment_preference' => ['nullable', 'string', 'max:120'],
            'is_oversize_suspected' => ['boolean'],
            'notes' => ['nullable', 'string', 'max:4000'],
            'lead_consent' => ['accepted'],
        ];
    }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'is_oversize_suspected' => $this->boolean('is_oversize_suspected'),
            'origin_state' => $this->filled('origin_state') ? mb_strtoupper((string) $this->input('origin_state')) : null,
            'destination_state' => $this->filled('destination_state') ? mb_strtoupper((string) $this->input('destination_state')) : null,
        ]);
    }
}
