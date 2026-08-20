<?php

declare(strict_types=1);

namespace App\Exceptions;

use RuntimeException;

/**
 * Se consultó una tabla con empresa sin que nadie hubiese dicho en nombre de
 * qué empresa se trabaja.
 *
 * Casi siempre es una de estas tres cosas:
 *
 *  1. Un trabajo en cola que no serializó el tenant_id. Envuélvelo en
 *     `TenantContext::runAs($tenantId, ...)`.
 *  2. Un comando de consola. Si es de mantenimiento, `withoutTenant(...)`.
 *  3. Una petición que no pasó por el middleware ResolveTenant.
 *
 * Lo que NO debe hacerse es envolver en `withoutTenant()` para que deje de
 * fallar: eso convierte un olvido en una fuga entre empresas.
 */
class MissingTenantContextException extends RuntimeException
{
    public static function for(string $modelClass): self
    {
        return new self(
            "Se consultó {$modelClass} sin contexto de empresa. Usa ".
            'TenantContext::runAs($tenantId, ...) o, si de verdad es una '.
            'operación de plataforma, TenantContext::withoutTenant(...).'
        );
    }
}
