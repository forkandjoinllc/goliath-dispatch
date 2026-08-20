<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\Permissions;
use App\Authorization\PermissionDescriptionsEs;
use App\Authorization\RoleMatrix;
use App\Enums\Locale;
use App\Models\Session;
use App\Support\InertiaPage;
use App\Support\Locales;
use App\Support\TenantContext;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

/**
 * La pantalla que se ve justo después de entrar.
 *
 * No es el panel definitivo. Es la respuesta honesta a «¿qué puedo hacer con
 * este usuario?»: el rol, la empresa en la que se está actuando y la lista
 * exacta de permisos que eso concede, con su ámbito.
 *
 * Que sea visible importa más de lo que parece. La matriz de permisos vive en
 * PHP, pero hasta que alguien la ve en pantalla junto al rol que la produjo,
 * nadie puede señalar «ese ámbito está mal».
 *
 * Quién eres y en qué empresa estás ya no se calcula aquí: eso lo aporta el
 * armazón compartido (App\Support\AppShell) para TODAS las páginas.
 */
final class DashboardController
{
    use InertiaPage;

    public function __invoke(
        Request $request,
        CurrentActor $current,
        PermissionChecker $checker,
    ): Response {
        $actor = $current->require();

        /** @var Locale $locale */
        $locale = $request->attributes->get('locale', Locales::default());
        $this->usesDictionary($request, ['auth', 'nav']);

        $spanish = $locale === Locale::Es;

        // Se evalúa con la MISMA política que usaría una comprobación de verdad
        // (ver CurrentActor::policy). Con otra, la pantalla mentiría.
        $policy = $current->policy();

        $granted = [];
        foreach (Permissions::ALL as $key => $description) {
            $decision = $checker->can($actor, $key, null, $policy);

            if (! $decision->allowed) {
                continue;
            }

            $parts = Permissions::parts($key);
            $granted[$parts['resource']][] = [
                'key' => $key,
                'action' => $parts['action'],
                'scope' => $decision->scope?->value,
                'description' => $spanish
                    ? PermissionDescriptionsEs::get($key)
                    : $description,
            ];
        }

        ksort($granted);

        return Inertia::render('App/Dashboard', [
            'permissions' => $granted,
            'totals' => [
                'granted' => array_sum(array_map('count', $granted)),
                'catalog' => count(Permissions::ALL),
                'roleGrants' => $actor->role === null ? 0 : count(RoleMatrix::for($actor->role)),
            ],
        ]);
    }

    /**
     * Cambia la empresa activa de la sesión.
     *
     * Se comprueba que el usuario tenga una pertenencia ACTIVA en la empresa
     * destino antes de tocar nada: sin eso, cualquiera podría cambiarse a la
     * empresa que quisiera mandando un id. Que el menú solo ofrezca las suyas es
     * comodidad; esta comprobación es la que de verdad lo impide.
     */
    public function switchTenant(Request $request, TenantContext $context): RedirectResponse
    {
        $tenantId = (string) $request->input('tenant_id');

        $allowed = $context->withoutTenant(fn (): bool => DB::table('user_tenant_memberships')
            ->where('user_id', $request->user()->id)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->exists());

        abort_unless($allowed, 403);

        Session::query()->whereKey($request->session()->getId())->update([
            'active_tenant_id' => $tenantId,
            // Cambiar de empresa NO conserva el segundo factor: es una frontera
            // distinta y vuelve a exigirse si esa empresa lo pide.
            'mfa_satisfied_at' => null,
        ]);

        return back();
    }
}
