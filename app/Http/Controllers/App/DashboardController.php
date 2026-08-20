<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\ActorFactory;
use App\Authorization\PermissionChecker;
use App\Authorization\Permissions;
use App\Authorization\RoleMatrix;
use App\Enums\Locale;
use App\Models\Session;
use App\Support\Dictionary;
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
 * No es el panel definitivo — eso es la fase 4. Es la respuesta honesta a «¿qué
 * puedo hacer con este usuario?»: quién eres, en qué empresa estás actuando, con
 * qué rol, y la lista exacta de permisos que eso te concede, con su ámbito.
 *
 * Que sea visible importa más de lo que parece. La matriz de permisos vive en
 * PHP y se prueba con Pest, pero hasta que alguien la ve en pantalla junto al
 * rol que la produjo, nadie puede señalar «ese ámbito está mal».
 */
final class DashboardController
{
    use InertiaPage;

    public function __invoke(
        Request $request,
        ActorFactory $factory,
        PermissionChecker $checker,
        TenantContext $context,
    ): Response {
        $user = $request->user();
        $sessionId = $request->session()->getId();

        $actor = $factory->for($user, $context->id(), $sessionId);

        /** @var Locale $locale */
        $locale = $request->attributes->get('locale', Locales::default());
        $this->usesDictionary($request, ['auth', 'nav']);

        $spanish = $locale === Locale::Es;

        // Los ajustes de la empresa deciden una concesión (ver RoleMatrix::resolve),
        // así que el listado tiene que evaluarse con la misma política que usaría
        // una comprobación de verdad. Si no, la pantalla mentiría.
        $policy = $actor->tenantId === null ? null : [
            'allow_dispatcher_resource_assignment' => (bool) DB::table('tenant_settings')
                ->where('tenant_id', $actor->tenantId)
                ->value('allow_dispatcher_resource_assignment'),
        ];

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
                    ? \App\Authorization\PermissionDescriptionsEs::get($key)
                    : $description,
            ];
        }

        ksort($granted);

        return Inertia::render('App/Dashboard', [
            'actor' => [
                'name' => $actor->fullName(),
                'email' => $actor->email,
                'role' => $actor->role?->value,
                'isPlatformSuperAdmin' => $actor->isPlatformSuperAdmin,
                'tenantId' => $actor->tenantId,
                'mfaRequired' => $actor->mfaRequired,
                'mfaSatisfied' => $actor->mfaSatisfied,
            ],
            'tenant' => $actor->tenantId === null ? null : $context->withoutTenant(
                fn () => DB::table('tenants')
                    ->where('id', $actor->tenantId)
                    ->first(['display_name', 'slug', 'status'])
            ),
            'memberships' => $this->memberships($request, $context),
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
     * empresa que quisiera mandando un id.
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

    /**
     * @return list<array{id: string, name: string, role: string}>
     */
    private function memberships(Request $request, TenantContext $context): array
    {
        return $context->withoutTenant(fn (): array => DB::table('user_tenant_memberships as m')
            ->join('tenants as t', 't.id', '=', 'm.tenant_id')
            ->where('m.user_id', $request->user()->id)
            ->where('m.status', 'active')
            ->whereNull('m.deleted_at')
            ->whereNull('t.deleted_at')
            ->orderBy('t.display_name')
            ->get(['t.id', 't.display_name as name', 'm.role'])
            ->map(fn ($row): array => [
                'id' => (string) $row->id,
                'name' => (string) $row->name,
                'role' => (string) $row->role,
            ])
            ->all());
    }
}
