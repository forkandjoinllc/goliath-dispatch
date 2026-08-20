<?php

declare(strict_types=1);

namespace App\Models\Scopes;

use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

/**
 * Estrecha toda consulta a la empresa activa.
 *
 * Es la primera línea de defensa; la segunda son las claves foráneas compuestas
 * `(tenant_id, padre_id)` del esquema (ver database/schema/85_*.sql). La base de
 * datos impide *escribir* mal; este scope impide *leer* de más. Hacen falta las
 * dos: ninguna cubre lo de la otra.
 */
/**
 * @implements Scope<Model>
 */
final class TenantScope implements Scope
{
    /**
     * @param  Builder<covariant Model>  $builder
     */
    public function apply(Builder $builder, Model $model): void
    {
        $tenantId = app(TenantContext::class)->requireForQuery($model::class);

        if ($tenantId === false) {
            return; // withoutTenant(): todas las empresas, a propósito.
        }

        if ($tenantId === null) {
            // Ámbito de plataforma: las filas que no pertenecen a ninguna empresa
            // cliente (un lead del sitio público de Goliath). NO es «todas»: un
            // `return` aquí dejaría los leads de todas las empresas a la vista
            // del formulario de contacto público.
            $builder->whereNull($model->qualifyColumn('tenant_id'));

            return;
        }

        $builder->where($model->qualifyColumn('tenant_id'), $tenantId);
    }
}
