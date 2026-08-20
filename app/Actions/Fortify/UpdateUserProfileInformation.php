<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Models\User;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Laravel\Fortify\Contracts\UpdatesUserProfileInformation;

/**
 * El stub de Fortify escribe una columna `name`. Aquí no existe: el esquema
 * portado tiene `first_name` y `last_name` por separado, porque las cartas de
 * confirmación de tarifa y los certificados de firma nombran a la persona por su
 * apellido. Usar el stub tal cual habría fallado en tiempo de ejecución, no de
 * compilación.
 *
 * La unicidad del correo se comprueba contra `email_normalized`, no contra
 * `email`, que es lo que impone el índice de la base de datos.
 */
class UpdateUserProfileInformation implements UpdatesUserProfileInformation
{
    /**
     * @param  array<string, mixed>  $input
     */
    public function update(User $user, array $input): void
    {
        $normalized = mb_strtolower(trim((string) ($input['email'] ?? '')));

        Validator::make($input, [
            'first_name' => ['required', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
            'phone' => ['nullable', 'string', 'max:32'],
            'locale' => ['required', 'string', Rule::in(['en', 'es'])],
            'timezone' => ['required', 'string', 'max:64', 'timezone'],
            'email' => [
                'required',
                'email',
                'max:255',
                Rule::unique('users', 'email_normalized')
                    ->ignore($user->id)
                    // El índice único vive sobre `live_email_key`, que es NULL
                    // para las filas borradas en suave: una dirección liberada
                    // por un borrado debe poder reutilizarse.
                    ->whereNull('deleted_at'),
            ],
        ], [], [
            'first_name' => __('validation.attributes.first_name'),
            'last_name' => __('validation.attributes.last_name'),
        ])->validateWithBag('updateProfileInformation');

        if ($normalized !== $user->email_normalized) {
            $this->updateVerifiedUser($user, $input);

            return;
        }

        $user->forceFill([
            'first_name' => $input['first_name'],
            'last_name' => $input['last_name'],
            'phone' => $input['phone'] ?? null,
            'locale' => $input['locale'],
            'timezone' => $input['timezone'],
        ])->save();
    }

    /**
     * Cambiar de correo revoca la verificación: si no, alguien podría mover su
     * cuenta a una dirección que no controla y conservar el sello de verificada.
     *
     * @param  array<string, mixed>  $input
     */
    private function updateVerifiedUser(User $user, array $input): void
    {
        $user->forceFill([
            'first_name' => $input['first_name'],
            'last_name' => $input['last_name'],
            'phone' => $input['phone'] ?? null,
            'locale' => $input['locale'],
            'timezone' => $input['timezone'],
            'email' => $input['email'],
            'email_verified_at' => null,
        ])->save();

        $user->sendEmailVerificationNotification();
    }
}
