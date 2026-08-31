<?php

declare(strict_types=1);

namespace App\Actions\Tenancy;

use App\Authorization\Actor;
use App\Enums\AuditAction;
use App\Enums\Role;
use App\Enums\UserStatus;
use App\Models\User;
use App\Notifications\UserInvitation;
use App\Support\Audit;
use App\Support\Invitations\Invitations;
use App\Support\Plans\Limits;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Invita a alguien a una empresa.
 *
 * Una persona NO es una cuenta por empresa. `users` no tiene `tenant_id` a
 * propósito: la misma dirección de correo puede trabajar para dos casas de
 * despacho, y lo que se crea por empresa es la PERTENENCIA. Por eso esto busca
 * primero si ya existe una cuenta con ese correo y, si existe, no la toca — le
 * cuelga una pertenencia nueva y le manda el vale. Crear una segunda cuenta con
 * el mismo correo ni siquiera es posible: `users_email_normalized_uq` lo impide
 * sobre las filas vivas.
 *
 * Todo dentro de una transacción: una pertenencia sin vale es alguien que
 * aparece en la lista de usuarios y no puede entrar jamás, y un vale sin
 * pertenencia es un enlace que revienta al pulsarlo.
 */
final class InviteUser
{
    public function __construct(private readonly TenantContext $context) {}

    /**
     * @param  array{email: string, first_name: string, last_name: string, role: Role, carrier_id: ?string, locale: string}  $input
     * @return array{userId: string, membershipId: string, isNewAccount: bool}
     */
    public function __invoke(Actor $actor, string $companyName, array $input): array
    {
        $tenantId = (string) $actor->tenantId;
        $email = trim($input['email']);
        $normalizado = mb_strtolower($email);

        return DB::transaction(function () use ($actor, $tenantId, $companyName, $input, $email, $normalizado): array {
            // `users` no lleva tenant_id, así que esta consulta cruza empresas a
            // propósito: se busca a la PERSONA, no a un empleado de esta casa.
            $user = $this->context->withoutTenant(
                fn (): ?User => User::where('email_normalized', $normalizado)->first()
            );

            $nueva = $user === null;

            if ($nueva) {
                // Sin `password` ni siquiera como null: la columna es nullable y
                // el cast `hashed` no tiene por qué recibir nada. La contraseña la
                // pone la propia persona al aceptar; que la eligiera quien invita
                // significaría que quien invita la conoce.
                $user = $this->context->withoutTenant(fn (): User => User::create([
                    'email' => $email,
                    'first_name' => $input['first_name'],
                    'last_name' => $input['last_name'],
                    'locale' => $input['locale'],
                    'status' => UserStatus::Invited,
                ]));
            }

            $this->guardAgainstDuplicate($tenantId, (string) $user->id, $input['role']);
            $this->guardAgainstPlanLimit($tenantId, $input['role']);

            $ahora = CarbonImmutable::now();
            $membershipId = (string) Str::uuid();

            DB::table('user_tenant_memberships')->insert([
                'id' => $membershipId,
                'tenant_id' => $tenantId,
                'user_id' => $user->id,
                'role' => $input['role']->value,
                'status' => 'invited',
                'carrier_id' => $input['carrier_id'],
                'invited_by_user_id' => $actor->auditUserId(),
                'invited_at' => $ahora,
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ]);

            $token = Invitations::issue($tenantId, (string) $user->id, $email, [
                'role' => $input['role']->value,
                'membership_id' => $membershipId,
            ]);

            $user->notify(new UserInvitation(
                token: $token,
                companyName: $companyName,
                inviterName: $actor->fullName(),
                roleLabelKey: 'users.roles.'.$input['role']->value,
                // El idioma de la persona invitada, no el de quien invita.
                idioma: $nueva ? $input['locale'] : $user->locale->value,
            ));

            Audit::record(
                $actor,
                AuditAction::RoleChanged,
                entityType: 'user_tenant_membership',
                entityId: $membershipId,
                entityLabel: $email,
                after: ['role' => $input['role']->value, 'status' => 'invited'],
            );

            return [
                'userId' => (string) $user->id,
                'membershipId' => $membershipId,
                'isNewAccount' => $nueva,
            ];
        });
    }

    /**
     * El tope de asientos del plan.
     *
     * Se comprueba al INVITAR y no al aceptar. Es la diferencia entre que el
     * error lo vea quien puede arreglarlo —el administrador que invita, que
     * puede liberar un asiento o mejorar el plan— y que lo vea la persona
     * invitada, que abre su enlace y se encuentra con que no cabe. Por eso una
     * invitación pendiente ya ocupa asiento en la cuenta.
     *
     * Solo para los roles de plantilla: las cuentas de portal de transportistas
     * y chóferes no gastan asiento. Ver App\Support\Plans\Limits.
     */
    private function guardAgainstPlanLimit(string $tenantId, Role $role): void
    {
        if (! in_array($role->value, Limits::SEAT_ROLES, true)) {
            return;
        }

        if (! Limits::isFull($tenantId, Limits::USERS)) {
            return;
        }

        throw ValidationException::withMessages([
            'email' => __('billing.limits.reached.users'),
        ]);
    }

    /**
     * La clave única es (tenant_id, user_id, role), así que una segunda
     * invitación al mismo papel reventaría con un error de base de datos. Se
     * contesta antes, y con un mensaje que dice cuál de las dos cosas pasa:
     * ya trabaja aquí, o ya se le invitó y todavía no ha contestado.
     */
    private function guardAgainstDuplicate(string $tenantId, string $userId, Role $role): void
    {
        $existente = DB::table('user_tenant_memberships')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('role', $role->value)
            ->whereNull('deleted_at')
            ->first(['status']);

        if ($existente === null) {
            return;
        }

        throw ValidationException::withMessages([
            'email' => $existente->status === 'invited'
                ? __('users.errors.alreadyInvited')
                : __('users.errors.alreadyMember'),
        ]);
    }
}
