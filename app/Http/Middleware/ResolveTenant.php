<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\Tenant;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Fija la empresa activa para el resto de la petición.
 *
 * El orden de resolución importa y es este:
 *
 *  1. `sessions.active_tenant_id` — la fuente de verdad para un usuario con
 *     sesión. Está en una columna, no dentro del blob `payload`, precisamente
 *     para poder leerla y auditarla con SQL.
 *  2. El dominio personalizado verificado, para las páginas públicas de una
 *     empresa (sitio de marketing, enlaces públicos de seguimiento). Sin
 *     verificar no cuenta: si bastara con apuntar un DNS a nuestro servidor,
 *     cualquiera elegiría de qué empresa servir las páginas.
 *  3. Nada: contexto de PLATAFORMA (null). Es el sitio público de Goliath, y
 *     las consultas se estrechan a `tenant_id IS NULL`. Ver TenantContext para
 *     por qué eso es un ámbito y no la ausencia de uno.
 *
 * Nunca lee la empresa de un parámetro de la petición. Un `?tenant=` sería una
 * fuga de una línea.
 */
final class ResolveTenant
{
    public function __construct(private readonly TenantContext $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        // set() SIEMPRE, incluso con null. Dejar el contexto sin definir haría
        // que el formulario público de contacto lanzase al leer `leads`, cuando
        // lo correcto es que vea los de la plataforma. El estado «sin definir»
        // queda reservado para lo que de verdad lo necesita: trabajos en cola y
        // comandos de consola que olvidaron decir en nombre de quién trabajan.
        $this->context->set($this->fromSession($request) ?? $this->fromHost($request));

        return $next($request);
    }

    private function fromSession(Request $request): ?string
    {
        if (! $request->hasSession() || ! $request->session()->isStarted()) {
            return null;
        }

        $sessionId = $request->session()->getId();

        $row = DB::table('sessions')
            ->select('active_tenant_id', 'revoked_at')
            ->where('id', $sessionId)
            ->first();

        // Una sesión revocada no aporta empresa: la petición sigue, y el
        // middleware de autenticación la echará. Aquí solo evitamos que una
        // sesión revocada siga leyendo datos de su empresa.
        if ($row === null || $row->revoked_at !== null) {
            return null;
        }

        return $row->active_tenant_id;
    }

    private function fromHost(Request $request): ?string
    {
        $host = $request->getHost();

        // `tenants` no tiene columna tenant_id, así que no lleva el scope
        // global; se consulta directamente.
        return Tenant::query()
            ->whereNull('deleted_at')
            ->where('custom_domain', $host)
            ->whereNotNull('custom_domain_verified_at')
            ->value('id');
    }
}
