<?php

declare(strict_types=1);

namespace App\Support\Marketing;

use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Las empresas de factoring que el alta pública puede ofrecer, por NOMBRE.
 *
 * ## Por qué nombres y no identificadores
 *
 * Esta lista se pinta en una página que ve cualquiera. Mandar los UUID de
 * `factoring_companies` al navegador sería publicar los identificadores
 * internos de una tabla de la empresa a cambio de nada: el formulario no
 * necesita el identificador para funcionar, porque el nombre YA es único por
 * empresa —`factoring_companies_tenant_name_uq`— y el servidor puede resolverlo
 * él solo.
 *
 * Así que viaja un `list<string>` y vuelve un `string`. Quien elige de la lista
 * y quien escribe el nombre a mano mandan exactamente el mismo campo, y es el
 * servidor el que decide si eso tiene ficha detrás o no.
 *
 * ## Lo que NO viaja
 *
 * Ni contactos, ni correos, ni teléfonos, ni `funding_instructions`. La ficha de
 * una empresa de factoring tiene instrucciones de pago, y eso no sale a una
 * página pública por ningún motivo.
 *
 * ## Lo que esto SÍ publica, dicho claro
 *
 * Los nombres de las empresas de factoring con las que trabaja la casa de
 * despacho. Es una decisión deliberada del lote 46: sin lista no hay
 * desplegable, y sin desplegable el transportista escribe el nombre a mano con
 * una coma de más y la pregunta «¿con quién factoriza?» vuelve a no tener
 * respuesta. Solo salen las ACTIVAS, igual que en el panel.
 */
final class PublicFactoring
{
    /** Tope de seguridad: un desplegable con más de esto no es un desplegable. */
    private const MAXIMO = 200;

    /**
     * Los nombres que puede ofrecer el alta pública de ESTA empresa.
     *
     * Sin empresa —goliathdispatch.com— no hay lista que ofrecer y devuelve
     * vacío. Un desplegable vacío sería un filtro que no puede encontrar nada:
     * la pantalla enseña una casilla de texto en su lugar.
     *
     * @return list<string>
     */
    public static function names(TenantContext $context): array
    {
        if (! $context->hasTenant()) {
            return [];
        }

        return DB::table('factoring_companies')
            ->where('tenant_id', (string) $context->id())
            ->whereNull('deleted_at')
            ->where('active', true)
            ->orderBy('name')
            ->limit(self::MAXIMO)
            ->pluck('name')
            ->map(static fn ($n): string => (string) $n)
            ->values()
            ->all();
    }

    /**
     * La ficha activa que lleva ese nombre, si la hay.
     *
     * Devuelve el identificador cuando el nombre coincide con una empresa activa
     * de esta casa, y null cuando no. Null NO es un error: es «escribió un
     * nombre que no está en la lista», que es justo lo que la opción «Other»
     * existe para permitir.
     *
     * La comparación la hace MySQL con el cotejamiento de la columna
     * (`utf8mb4_0900_ai_ci`): insensible a mayúsculas y a acentos, que es como
     * la gente escribe el nombre de su empresa de factoring.
     */
    public static function resolve(?string $tenantId, string $name): ?string
    {
        $limpio = trim($name);

        if ($tenantId === null || $limpio === '') {
            return null;
        }

        $id = DB::table('factoring_companies')
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at')
            ->where('active', true)
            ->where('name', $limpio)
            ->value('id');

        return $id === null ? null : (string) $id;
    }
}
