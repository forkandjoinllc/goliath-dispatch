<?php

declare(strict_types=1);

namespace App\Support;

use App\Exceptions\MissingTenantContextException;
use Closure;

/**
 * La empresa en cuyo nombre se está trabajando ahora mismo.
 *
 * Es un singleton por petición (o por trabajo en cola). El scope global de
 * Eloquent lo lee para estrechar toda consulta, así que su corrección importa
 * más que la de casi cualquier otra clase del proyecto.
 *
 * Hay CUATRO estados, y la diferencia entre los dos últimos es la que suele
 * costar entender:
 *
 *  • **con empresa** — lo normal. Toda consulta se estrecha a ese tenant_id.
 *
 *  • **sin definir** — nadie ha dicho nada. Consultar una tabla con tenant en
 *    este estado LANZA. No devuelve cero filas: devolver cero filas hace que un
 *    olvido parezca "no hay datos", y ese error se descubre en producción con un
 *    informe vacío. Lanzar lo descubre en la primera prueba.
 *
 *  • **la plataforma** (`set(null)`) — se está actuando en nombre del sitio
 *    público de Goliath, no de ninguna empresa cliente. Las consultas se
 *    estrechan a `tenant_id IS NULL`. Es un ámbito real, no la ausencia de uno:
 *    un formulario de contacto enviado desde goliathdispatch.com produce un lead
 *    de la plataforma; el mismo formulario en el dominio propio de una empresa
 *    produce un lead de esa empresa. Por eso `leads.tenant_id` y
 *    `quote_requests.tenant_id` admiten NULL y el resto de tablas no.
 *
 *  • **sin frontera** (`withoutTenant()`) — se ven TODAS las empresas a la vez.
 *    Informes de plataforma y barridos de retención. Hay que pedirlo a la cara y
 *    se ve en un diff.
 */
final class TenantContext
{
    private ?string $tenantId = null;

    private bool $initialised = false;

    /** Verdadero mientras se ejecuta un bloque withoutTenant(). */
    private bool $unscoped = false;

    public function set(?string $tenantId): void
    {
        $this->tenantId = $tenantId;
        $this->initialised = true;
    }

    public function forget(): void
    {
        $this->tenantId = null;
        $this->initialised = false;
        $this->unscoped = false;
    }

    public function id(): ?string
    {
        return $this->tenantId;
    }

    public function hasTenant(): bool
    {
        return $this->tenantId !== null;
    }

    public function isUnscoped(): bool
    {
        return $this->unscoped;
    }

    /**
     * Cómo debe estrecharse una consulta.
     *
     * Devuelve `false` para «no estreches nada» y una cadena o `null` para el
     * valor de tenant_id que hay que exigir. Se distingue así, y no con un
     * `?string`, porque null es un valor de ámbito legítimo (la plataforma) y
     * confundirlo con «sin frontera» dejaría los leads de todas las empresas a
     * la vista del sitio público.
     *
     *
     * @throws MissingTenantContextException
     */
    public function requireForQuery(string $modelClass): string|null|false
    {
        if ($this->unscoped) {
            return false;
        }

        if (! $this->initialised) {
            throw MissingTenantContextException::for($modelClass);
        }

        return $this->tenantId;
    }

    /** Verdadero cuando se actúa en nombre de la plataforma, no de una empresa. */
    public function isPlatform(): bool
    {
        return $this->initialised && $this->tenantId === null && ! $this->unscoped;
    }

    /**
     * Ejecuta $callback actuando como la empresa dada, y restaura el estado
     * anterior pase lo que pase.
     *
     * @template T
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    public function runAs(string $tenantId, Closure $callback): mixed
    {
        return $this->restoring(function () use ($tenantId, $callback) {
            $this->tenantId = $tenantId;
            $this->initialised = true;
            $this->unscoped = false;

            return $callback();
        });
    }

    /**
     * Ejecuta $callback sin frontera de empresa. Para la plataforma y los
     * trabajos de mantenimiento, no para "arreglar" una consulta que falla.
     *
     * @template T
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    public function withoutTenant(Closure $callback): mixed
    {
        return $this->restoring(function () use ($callback) {
            $this->unscoped = true;

            return $callback();
        });
    }

    /**
     * @template T
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    private function restoring(Closure $callback): mixed
    {
        $tenantId = $this->tenantId;
        $initialised = $this->initialised;
        $unscoped = $this->unscoped;

        try {
            return $callback();
        } finally {
            $this->tenantId = $tenantId;
            $this->initialised = $initialised;
            $this->unscoped = $unscoped;
        }
    }
}
