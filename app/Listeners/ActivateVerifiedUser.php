<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Auth\Events\Verified;

/**
 * Pasa a `active` la cuenta que acaba de verificar su correo.
 *
 * ESTO ARREGLA UN FALLO EN PRODUCCIÓN, no es una mejora. `users` tiene DOS
 * columnas que hablan del mismo momento y no se hablaban entre ellas:
 *
 *   • `email_verified_at`, que es la de Laravel y la que marca su flujo de
 *     verificación.
 *   • `status`, que es la del esquema portado y la ÚNICA que mira
 *     App\Actions\Auth\AttemptLogin, que rechaza todo lo que no sea `active`.
 *
 * `ProvisionTenant` crea al administrador como `pending_verification` y le manda
 * el correo. El enlace marcaba `email_verified_at`… y nada más. El estado se
 * quedaba en `pending_verification` para siempre, así que quien se daba de alta
 * por el formulario público verificaba su correo y AUN ASÍ no podía entrar
 * nunca, sin ningún mensaje que explicara por qué. Las cuentas de demostración
 * no lo enseñaban porque el sembrador las crea ya activas.
 *
 * Se escucha el evento en vez de tocar AttemptLogin porque las dos columnas
 * significan cosas distintas y las dos hacen falta: `email_verified_at` dice que
 * la dirección es suya, `status` dice si la cuenta puede operar. Un
 * administrador puede suspender a alguien cuyo correo sigue verificado.
 */
final class ActivateVerifiedUser
{
    public function handle(Verified $event): void
    {
        $user = $event->user;

        if (! $user instanceof User) {
            return;
        }

        // Solo desde los dos estados que significan «todavía no ha terminado de
        // entrar». Un suspendido o un desactivado que pulse un enlace viejo de
        // verificación NO se reactiva solo: eso convertiría el correo en una
        // puerta trasera para saltarse una suspensión.
        if (! in_array($user->status, [UserStatus::PendingVerification, UserStatus::Invited], true)) {
            return;
        }

        $user->forceFill(['status' => UserStatus::Active])->save();
    }
}
