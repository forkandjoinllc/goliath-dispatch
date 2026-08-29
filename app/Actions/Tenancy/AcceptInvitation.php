<?php

declare(strict_types=1);

namespace App\Actions\Tenancy;

use App\Enums\Role;
use App\Enums\UserStatus;
use App\Models\User;
use App\Support\Invitations\Invitations;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use stdClass;

/**
 * Acepta una invitación: activa la cuenta y la pertenencia, y quema el vale.
 *
 * Aceptar VERIFICA el correo. No se manda un segundo mensaje de verificación
 * después: el vale llegó a esa dirección y quien lo usó lo sacó de ahí, que es
 * exactamente lo que la verificación demuestra. Pedirlo otra vez sería hacerle
 * dar dos vueltas a alguien por una prueba que ya está hecha.
 *
 * Todo en una transacción. A medias quedaría alguien con la contraseña puesta y
 * la pertenencia todavía en `invited`: entraría y no vería ninguna empresa.
 */
final class AcceptInvitation
{
    public function __construct(private readonly TenantContext $context) {}

    /**
     * @param  stdClass  $token  la fila viva de `verification_tokens`
     */
    public function __invoke(stdClass $token, ?string $password, string $firstName, string $lastName): User
    {
        return DB::transaction(function () use ($token, $password, $firstName, $lastName): User {
            /** @var User $user */
            $user = $this->context->withoutTenant(
                fn (): User => User::whereKey($token->user_id)->firstOrFail()
            );

            $ahora = CarbonImmutable::now();

            $cambios = [
                'first_name' => $firstName,
                'last_name' => $lastName,
                'status' => UserStatus::Active,
                'email_verified_at' => $user->email_verified_at ?? $ahora,
            ];

            // Solo si de verdad viene una. Quien ya tenía cuenta en otra empresa
            // conserva la suya: una invitación no es una forma de que un tercero
            // le cambie la contraseña a nadie.
            if ($password !== null && $password !== '') {
                $cambios['password'] = $password;
                $cambios['password_changed_at'] = $ahora;
                $cambios['must_change_password'] = false;
            }

            $user->forceFill($cambios)->save();

            $membership = DB::table('user_tenant_memberships')
                ->where('tenant_id', $token->tenant_id)
                ->where('user_id', $user->id)
                ->where('status', 'invited')
                ->whereNull('deleted_at')
                ->first(['id', 'role', 'carrier_id']);

            if ($membership !== null) {
                DB::table('user_tenant_memberships')
                    ->where('id', $membership->id)
                    ->update([
                        'status' => 'active',
                        'accepted_at' => $ahora,
                        'updated_at' => $ahora,
                    ]);

                $this->linkCarrierPortal($token, $membership, $user, $ahora);
            }

            Invitations::consume((string) $token->id);

            return $user->refresh();
        });
    }

    /**
     * El vínculo con el transportista, para que `$carrier->users` diga la verdad.
     *
     * La autorización no lo necesita —el Actor saca `carrier_id` de la propia
     * pertenencia—, pero la relación existe y una relación que siempre devuelve
     * vacío es una trampa para el siguiente que la use.
     */
    private function linkCarrierPortal(stdClass $token, stdClass $membership, User $user, CarbonImmutable $ahora): void
    {
        if ($membership->role !== Role::Carrier->value || $membership->carrier_id === null) {
            return;
        }

        DB::table('carrier_users')->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'tenant_id' => $token->tenant_id,
            'carrier_id' => $membership->carrier_id,
            'user_id' => $user->id,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);
    }
}
