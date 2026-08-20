<?php

declare(strict_types=1);

namespace App\Http\Responses;

use App\Models\Session;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\LoginResponse as LoginResponseContract;

/**
 * Fija la empresa activa justo después de iniciar sesión.
 *
 * Por qué aquí y no escuchando el evento Login: el evento se dispara dentro de
 * `Auth::login()`, y Fortify regenera el id de sesión DESPUÉS, en
 * PrepareAuthenticatedSession (protección contra fijación de sesión). Un listener
 * del evento escribiría en la fila vieja, que la regeneración deja atrás — el
 * síntoma es exactamente el que tuvo esta implementación antes de moverla:
 * `active_tenant_id` en NULL sin ningún error.
 *
 * Esta respuesta corre al final del pipeline, con el id ya definitivo.
 */
class LoginResponse implements LoginResponseContract
{
    public function toResponse($request): RedirectResponse|JsonResponse
    {
        $this->rememberActiveTenant($request);

        return $request->wantsJson()
            ? new JsonResponse('', 204)
            : redirect()->intended(config('fortify.home'));
    }

    private function rememberActiveTenant(Request $request): void
    {
        $user = $request->user();

        if (! $user instanceof User) {
            return;
        }

        // `user_tenant_memberships` lleva tenant_id y por tanto TenantScope. En
        // este punto todavía no hay empresa activa —es justo lo que estamos
        // averiguando—, así que la consulta tiene que ser explícitamente sin
        // frontera. Es uno de los pocos usos legítimos de withoutTenant().
        $tenantIds = app(TenantContext::class)->withoutTenant(
            fn () => $user->memberships()
                ->whereNull('deleted_at')
                ->where('status', 'active')
                ->pluck('tenant_id')
                ->unique()
                ->values()
        );

        // Fuerza la escritura de la sesión ANTES de tocar sus columnas. El
        // middleware StartSession guarda la sesión al final de la petición, es
        // decir DESPUÉS de esta respuesta: sin este save() la fila todavía no
        // existe, el UPDATE afecta a cero filas y Laravel inserta después una
        // fila limpia. El síntoma es active_tenant_id en NULL sin ningún error.
        //
        // El save() posterior de StartSession solo reescribe payload,
        // last_activity, user_id, ip_address y user_agent, así que no pisa las
        // columnas de dominio que fijamos aquí.
        $request->session()->save();

        Session::query()
            ->whereKey($request->session()->getId())
            ->update([
                // Con una sola empresa se elige sola. Con varias se queda en
                // NULL y decide el conmutador: adivinar aquí significaría
                // enseñarle a alguien los datos de la empresa equivocada.
                'active_tenant_id' => $tenantIds->count() === 1 ? $tenantIds->first() : null,
                // Cada inicio de sesión empieza sin segundo factor satisfecho,
                // aunque el usuario lo tenga configurado y lo hiciera ayer.
                'mfa_satisfied_at' => null,
                'revoked_at' => null,
                'revoked_reason' => null,
            ]);
    }
}
