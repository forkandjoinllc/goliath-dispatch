<?php

declare(strict_types=1);

namespace App\Models\Concerns;

use App\Models\Scopes\TenantScope;
use App\Models\Tenant;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Para todo modelo cuya tabla tenga `tenant_id`.
 *
 * Hace tres cosas: estrecha las lecturas, rellena `tenant_id` al crear, y
 * bloquea el intento de mover una fila de una empresa a otra.
 */
trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        static::addGlobalScope(new TenantScope);

        static::creating(function (self $model): void {
            if ($model->getAttribute('tenant_id') !== null) {
                return;
            }

            $tenantId = app(TenantContext::class)->id();

            if ($tenantId !== null) {
                $model->setAttribute('tenant_id', $tenantId);
            }
            // Si no hay empresa en contexto no inventamos una: la columna es
            // NOT NULL y la base de datos rechazará el INSERT con un error que
            // dice exactamente qué pasó.
        });

        static::updating(function (self $model): void {
            if (! $model->isDirty('tenant_id')) {
                return;
            }

            // Cambiar tenant_id no es una operación legítima en ningún flujo.
            // Si alguna vez hiciera falta migrar datos entre empresas, sería un
            // procedimiento explícito, auditado y fuera de Eloquent.
            throw new \LogicException(
                'No se puede mover '.static::class.' de una empresa a otra cambiando tenant_id.'
            );
        });
    }

    /** @return BelongsTo<Tenant, $this> */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /**
     * Quita el estrechamiento por empresa en ESTA consulta.
     *
     * Úsalo solo donde la ausencia de frontera sea el propósito (informes de
     * plataforma, barridos de retención). En una consulta de producto es casi
     * siempre un error.
     *
     * @return Builder<static>
     */
    public static function withoutTenantScope(): Builder
    {
        return static::withoutGlobalScope(TenantScope::class);
    }
}
