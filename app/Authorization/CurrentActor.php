<?php

declare(strict_types=1);

namespace App\Authorization;

use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * El Actor de ESTA petición, resuelto una sola vez.
 *
 * ActorFactory hace varias consultas (pertenencia, asignaciones, anulaciones,
 * estado del segundo factor). El armazón lo necesita para pintar el menú, el
 * middleware para autorizar, y el controlador para filtrar — tres veces la misma
 * pregunta. Este objeto está registrado como `scoped`, así que vive lo que dura
 * la petición y responde una vez.
 *
 * `policy()` va aquí por la misma razón: la matriz de roles consulta un ajuste de
 * la empresa (allow_dispatcher_resource_assignment) para decidir una concesión.
 * Si el menú se construyera con una política y la comprobación real con otra, el
 * menú mentiría — enseñaría un enlace que el servidor rechaza, o escondería uno
 * que sí funciona.
 */
final class CurrentActor
{
    private ?Actor $actor = null;

    private bool $resolved = false;

    /** @var array{allow_dispatcher_resource_assignment?: bool}|null */
    private ?array $policy = null;

    private bool $policyResolved = false;

    public function __construct(
        private readonly ActorFactory $factory,
        private readonly TenantContext $context,
    ) {}

    /** Nulo para un visitante sin sesión. */
    public function get(): ?Actor
    {
        if ($this->resolved) {
            return $this->actor;
        }

        $this->resolved = true;

        /** @var Request $request */
        $request = app('request');
        $user = $request->user();

        if ($user === null) {
            return null;
        }

        return $this->actor = $this->factory->for(
            $user,
            $this->context->id(),
            $request->hasSession() ? $request->session()->getId() : null,
        );
    }

    /** Para código que solo corre tras el middleware `auth`. */
    public function require(): Actor
    {
        $actor = $this->get();

        if ($actor === null) {
            throw new \LogicException(
                'Se pidió el Actor de la petición sin usuario autenticado. '
                .'Esta ruta necesita el middleware `auth`.'
            );
        }

        return $actor;
    }

    /**
     * Los ajustes de la empresa que influyen en la autorización.
     *
     * @return array{allow_dispatcher_resource_assignment?: bool}|null
     */
    public function policy(): ?array
    {
        if ($this->policyResolved) {
            return $this->policy;
        }

        $this->policyResolved = true;
        $actor = $this->get();

        if ($actor === null || $actor->tenantId === null) {
            return null;
        }

        return $this->policy = [
            'allow_dispatcher_resource_assignment' => (bool) DB::table('tenant_settings')
                ->where('tenant_id', $actor->tenantId)
                ->value('allow_dispatcher_resource_assignment'),
        ];
    }

    public function forget(): void
    {
        $this->actor = null;
        $this->resolved = false;
        $this->policy = null;
        $this->policyResolved = false;
    }
}
