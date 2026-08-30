<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/**
 * Una empresa suspendida deja de poder operar.
 *
 * `tenants.status` admitía `suspended` desde el primer día y no lo miraba
 * NADIE: una empresa suspendida seguía trabajando exactamente igual. El permiso
 * `platform:tenant:suspend` existía, la columna existía, y suspender no hacía
 * nada. Este middleware es lo que hace que signifique algo.
 *
 * Cuatro decisiones que conviene no deshacer sin pensarlo:
 *
 *  - **Solo se mira `tenants.status`, no la suscripción.** Que una suscripción
 *    esté `past_due` NO cierra la puerta: dejar sin sistema a una empresa
 *    porque una tarjeta falló un martes es una decisión de negocio, y no le
 *    toca tomarla al código. El barrido mueve la suscripción y avisa; cortar el
 *    acceso sigue siendo un acto humano y explícito.
 *  - **El super administrador de plataforma pasa.** Es quien tiene que entrar a
 *    arreglarlo. Un guardia que también deja fuera a quien puede levantar la
 *    suspensión convierte un impago en una avería.
 *  - **Se deja salir y cambiar de empresa.** Quien trabaja en dos empresas y
 *    una está suspendida tiene que poder irse a la otra sin borrar cookies, y
 *    cualquiera tiene que poder cerrar sesión. Bloquearlo todo deja a la gente
 *    encerrada en una pantalla.
 *  - **El sitio PÚBLICO no se toca.** Aquí solo se guarda lo autenticado. Si
 *    algún día hay que apagar también la web pública de una empresa suspendida,
 *    esa es otra decisión y otro sitio — y afecta a su marca, no a su acceso.
 */
final class EnsureTenantActive
{
    /** Rutas que siguen abiertas con la empresa suspendida. */
    private const ESCAPES = ['logout', 'switch-tenant', 'locale'];

    public function __construct(private readonly TenantContext $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        $tenantId = $this->context->id();

        if ($tenantId === null || $request->user() === null) {
            return $next($request);
        }

        if (in_array($request->path(), self::ESCAPES, true)) {
            return $next($request);
        }

        // `tenants` no lleva columna tenant_id y por tanto no arrastra el ámbito
        // global; se consulta directa.
        $estado = (string) $this->context->withoutTenant(
            fn () => DB::table('tenants')->where('id', $tenantId)->value('status'),
        );

        if ($estado !== 'suspended') {
            return $next($request);
        }

        if ($this->esSuperAdministrador($request)) {
            return $next($request);
        }

        // El diccionario se declara AQUÍ, en el atributo de la petición, igual
        // que hace `InertiaPage::usesDictionary` en los controladores. Funciona
        // aunque este middleware corra después de HandleInertiaRequests porque
        // la prop `dictionary` es un cierre que Inertia evalúa al serializar, no
        // al compartir. Sin esta línea la pantalla salía con las claves en
        // crudo: `platform.suspended.title` en el título, en el cuerpo y en el
        // enlace de salir.
        $request->attributes->set('dictionaryNamespaces', ['platform']);

        return Inertia::render('App/Suspended')
            ->toResponse($request)
            ->setStatusCode(403);
    }

    /**
     * ¿Es super administrador de plataforma?
     *
     * Se lee de `users`, no del Actor: el Actor se construye con el contexto de
     * empresa ya resuelto y este middleware corre antes de que nadie lo pida.
     * Es una consulta por petición y solo para empresas suspendidas, que son
     * las menos.
     */
    private function esSuperAdministrador(Request $request): bool
    {
        return (bool) $this->context->withoutTenant(
            fn () => DB::table('users')
                ->where('id', $request->user()->id)
                ->value('is_platform_super_admin'),
        );
    }
}
