<?php

declare(strict_types=1);

namespace App\Support;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Http\Controllers\App\NotificationController;
use Illuminate\Support\Facades\DB;

/**
 * Todo lo que el armazón autenticado necesita para pintarse: quién eres, en qué
 * empresa estás, a qué otras puedes cambiarte y qué entradas de menú te tocan.
 *
 * Va en una prop compartida y no en cada controlador porque el armazón envuelve
 * TODAS las páginas de la aplicación. Si cada controlador tuviera que aportarlo,
 * el día que a alguien se le olvide la página se renderiza sin menú — y ese
 * fallo es silencioso.
 */
final class AppShell
{
    public function __construct(
        private readonly CurrentActor $current,
        private readonly PermissionChecker $checker,
        private readonly TenantContext $context,
    ) {}

    /**
     * Nulo para peticiones sin sesión: el sitio público no lleva armazón y no
     * debe pagar ninguna consulta por él.
     *
     * @return array<string, mixed>|null
     */
    public function payload(): ?array
    {
        $actor = $this->current->get();

        if ($actor === null) {
            return null;
        }

        $policy = $this->current->policy();

        return [
            'actor' => [
                'name' => $actor->fullName(),
                'email' => $actor->email,
                'role' => $actor->role?->value,
                'isPlatformSuperAdmin' => $actor->isPlatformSuperAdmin,
                'mfaRequired' => $actor->mfaRequired,
                'mfaSatisfied' => $actor->mfaSatisfied,
                // Durante una suplantación el armazón lleva un aviso permanente.
                // Ocultarlo sería lo cómodo y lo indefendible: quien está a los
                // mandos tiene que ver en todo momento que actúa como otro y que
                // queda registrado.
                'impersonating' => $actor->isImpersonating(),
            ],
            'tenant' => $this->tenant($actor->tenantId),
            'memberships' => $this->memberships($actor->userId),
            'nav' => Navigation::for($actor, $this->checker, $policy),
            // La campana. Va en el armazón porque se pinta en TODAS las
            // pantallas: si dependiera del controlador, un olvido dejaría la
            // campana a cero sin que nadie lo notara — y una campana que miente
            // es peor que no tenerla.
            'unreadNotifications' => NotificationController::unreadCount($actor),
            // El correo de soporte de la empresa.
            //
            // Va en el armazón por el mismo motivo que la campana: lo necesitan
            // las pantallas donde alguien se ha quedado fuera —acceso denegado,
            // empresa suspendida— y esas se pintan desde sitios distintos. Si
            // dependiera del controlador, la que más falta hace sería la que se
            // olvidara.
            //
            // Se editaba en configuración desde el primer día y NO SE ENSEÑABA
            // EN NINGÚN SITIO. Alguien lo rellenaba creyendo que su gente sabría
            // a quién escribir, y su gente veía «consulte con un administrador»
            // sin más. Lo cazó tests/Unit/Suite/InertSettingsTest.php.
            'supportEmail' => $this->supportEmail($actor->tenantId),
        ];
    }

    /**
     * El correo al que escribe quien necesita ayuda en esta empresa.
     *
     * Nulo cuando no está puesto, y entonces la pantalla no promete un contacto
     * que no existe: enseñar un enlace vacío sería otra forma de mentir.
     */
    private function supportEmail(?string $tenantId): ?string
    {
        if ($tenantId === null) {
            return null;
        }

        $valor = $this->context->withoutTenant(fn () => DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->value('support_email'));

        return is_string($valor) && trim($valor) !== '' ? trim($valor) : null;
    }

    /**
     * @return array{id: string, name: string, slug: string, status: string}|null
     */
    private function tenant(?string $tenantId): ?array
    {
        if ($tenantId === null) {
            return null;
        }

        // `tenants` no lleva columna tenant_id, pero el scope global sí actúa
        // sobre las tablas que cuelgan de ella; se lee sin ámbito para que un
        // contexto de plataforma pueda mirarla igual.
        $row = $this->context->withoutTenant(fn () => DB::table('tenants')
            ->where('id', $tenantId)
            ->whereNull('deleted_at')
            ->first(['id', 'display_name', 'slug', 'status']));

        return $row === null ? null : [
            'id' => (string) $row->id,
            'name' => (string) $row->display_name,
            'slug' => (string) $row->slug,
            'status' => (string) $row->status,
        ];
    }

    /**
     * Las empresas a las que este usuario puede cambiarse.
     *
     * @return list<array{id: string, name: string, role: string}>
     */
    private function memberships(string $userId): array
    {
        return $this->context->withoutTenant(fn (): array => DB::table('user_tenant_memberships as m')
            ->join('tenants as t', 't.id', '=', 'm.tenant_id')
            ->where('m.user_id', $userId)
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
