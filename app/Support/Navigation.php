<?php

declare(strict_types=1);

namespace App\Support;

use App\Authorization\Actor;
use App\Authorization\PermissionChecker;

/**
 * El menú de la aplicación, decidido en el SERVIDOR.
 *
 * Cada entrada declara los permisos que la habilitan, y solo aparece si el actor
 * tiene alguno. Construirlo aquí y no en React no es una preferencia: un menú
 * armado en el cliente enseñaría enlaces que el servidor va a rechazar con un
 * 403, y un enlace que no lleva a ningún sitio es peor que un enlace ausente —
 * el usuario no sabe si le falta un permiso o si algo está roto.
 *
 * El orden de los grupos sigue el día de una oficina de despacho: primero lo
 * operativo, luego el cumplimiento, luego el dinero, luego lo que se mira de
 * vez en cuando.
 */
final class Navigation
{
    /**
     * grupo => [ [ruta, clave de etiqueta, permisos que la habilitan] ]
     *
     * Un permiso basta (canAny): quien solo puede LEER facturas debe ver la
     * entrada de facturas, aunque no pueda crearlas.
     */
    private const MENU = [
        'operations' => [
            ['loads', 'loads', ['load:read']],
            ['customers', 'customers', ['customer:read']],
            ['tracking', 'tracking', ['tracking:read']],
            ['permits', 'permits', ['permit:read']],
            ['messages', 'messages', ['message:read']],
        ],
        'compliance' => [
            ['carriers', 'carriers', ['carrier:read']],
            ['onboarding', 'onboarding', ['carrier:onboarding:read']],
            ['drivers', 'drivers', ['driver:read']],
            ['equipment', 'equipment', ['equipment:read']],
            ['documents', 'documents', ['document:read']],
            ['signatures', 'signatures', ['signature:request:read', 'signature:template:read']],
        ],
        'finance' => [
            ['invoices', 'invoices', ['invoice:read']],
            ['settlements', 'settlements', ['settlement:read']],
            ['expenses', 'expenses', ['expense:read', 'expense:submit']],
            ['payments', 'payments', ['payment:record', 'invoice:read']],
            ['factoring', 'factoring', ['factoring:read']],
        ],
        'insight' => [
            ['reports', 'reports', ['report:read']],
        ],
        'administration' => [
            ['assignments', 'assignments', ['assignment:read']],
            ['users', 'users', ['tenant:user:read']],
            ['settings', 'settings', ['tenant:settings:read']],
            ['audit', 'audit', ['audit:read']],
            ['leads', 'leads', ['lead:read']],
        ],
        'platform' => [
            ['platform/tenants', 'tenants', ['platform:tenant:read']],
            ['platform/plans', 'plans', ['platform:plan:read']],
            ['platform/health', 'platformHealth', ['platform:health:read']],
        ],
    ];

    /**
     * Rutas cuya pantalla existe de verdad. El resto se pinta apagada.
     *
     * Es una lista explícita y no una comprobación de rutas registradas a
     * propósito: una ruta puede existir y devolver un esqueleto. Esta constante
     * responde «¿está terminada?», que es lo que le importa a quien mira el menú,
     * y se amplía a mano al cerrar cada dominio.
     */
    private const BUILT = ['carriers', 'customers', 'loads', 'drivers'];

    /**
     * @param  array{allow_dispatcher_resource_assignment?: bool}|null  $policy
     * @return list<array{key: string, labelKey: string, items: list<array{href: string, labelKey: string, ready: bool}>}>
     */
    public static function for(Actor $actor, PermissionChecker $checker, ?array $policy = null): array
    {
        $groups = [];

        foreach (self::MENU as $group => $entries) {
            $items = [];

            foreach ($entries as [$route, $label, $permissions]) {
                if (! $checker->canAny($actor, $permissions, $policy)) {
                    continue;
                }

                $items[] = [
                    'href' => '/'.$route,
                    'labelKey' => 'nav.primary.'.$label,
                    // `ready` distingue lo construido de lo que todavía no.
                    // Enseñar la entrada en gris es más honesto que ocultarla:
                    // dice que el permiso existe y que la pantalla está por venir.
                    'ready' => in_array($route, self::BUILT, true),
                ];
            }

            if ($items === []) {
                continue;
            }

            $groups[] = [
                'key' => $group,
                'labelKey' => 'nav.groups.'.$group,
                'items' => $items,
            ];
        }

        return $groups;
    }
}
