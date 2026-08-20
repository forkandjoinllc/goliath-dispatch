<?php

declare(strict_types=1);

namespace App\Http\Requests\Auth;

use App\Http\Requests\Marketing\PublicFormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * El alta de una empresa nueva.
 *
 * Hereda de PublicFormRequest porque es un formulario público y merece las
 * mismas tres defensas: es el endpoint más caro del sitio —crea siete filas y
 * manda un correo— y por tanto el más rentable de automatizar.
 */
final class SignupRequest extends PublicFormRequest
{
    protected function formName(): string
    {
        return 'signup';
    }

    /** @return array<string, mixed> */
    protected function fieldRules(): array
    {
        return [
            'company_name' => ['required', 'string', 'min:2', 'max:200'],
            'plan_code' => [
                'required', 'string',
                // Se comprueba contra la base de datos, no contra una lista en el
                // código: un plan retirado o privado no puede elegirse por mucho
                // que alguien mande su código a mano.
                Rule::exists('saas_plans', 'code')->where('is_public', true)->whereNull('deleted_at'),
            ],

            'first_name' => ['required', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
            'email' => [
                'required', 'email:rfc', 'max:255',
                Rule::unique('users', 'email_normalized')->whereNull('deleted_at'),
            ],
            'password' => ['required', 'confirmed', Password::min(12)->uncompromised()],

            'locale' => ['required', 'in:en,es'],
            'timezone' => ['nullable', 'string', 'max:64', 'timezone'],

            'privacy_consent' => ['accepted'],
            'terms_consent' => ['accepted'],
        ];
    }

    protected function prepareForValidation(): void
    {
        // Se recorta pero NO se pasa a minúsculas: la dirección se guarda tal y
        // como la escribió la persona, y la página final se la enseña. Si tecleó
        // «luis@forkanjoin.test» en vez de «forkandjoin», verla escrita como la
        // escribió es lo único que se lo revela.
        //
        // La unicidad no sufre: `users.email_normalized` está en
        // utf8mb4_0900_ai_ci, que es insensible a mayúsculas, y el modelo User
        // deriva esa columna con mb_strtolower al asignar `email`. Verificado
        // contra MySQL, no supuesto.
        $this->merge([
            'email' => trim((string) $this->input('email')),
        ]);
    }
}
