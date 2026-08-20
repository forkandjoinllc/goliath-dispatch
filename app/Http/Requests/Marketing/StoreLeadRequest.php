<?php

declare(strict_types=1);

namespace App\Http\Requests\Marketing;

final class StoreLeadRequest extends PublicFormRequest
{
    protected function formName(): string
    {
        return 'lead';
    }

    /** @return array<string, mixed> */
    protected function fieldRules(): array
    {
        return [
            'first_name' => ['required', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'email:rfc', 'max:255'],
            'phone' => ['nullable', 'string', 'max:32'],
            'company_name' => ['nullable', 'string', 'max:200'],
            'message' => ['nullable', 'string', 'max:4000'],
            // El consentimiento de contacto es obligatorio y se comprueba en el
            // servidor: una casilla marcada en el cliente no prueba nada.
            'lead_consent' => ['accepted'],
        ];
    }
}
