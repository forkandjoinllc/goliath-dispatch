<?php

declare(strict_types=1);

namespace App\Support\Fmcsa;

use App\Services\Fmcsa\FmcsaDirectory;
use App\Support\Tenancy\TenantPolicy;
use Illuminate\Support\Facades\DB;

/**
 * Si la revalidación de FMCSA está pasando de verdad, y desde cuándo.
 *
 * ## El defecto
 *
 * La pantalla de ajustes tiene un campo, «Volver a comprobar FMCSA cada
 * (días)», y no dice absolutamente nada más. Quien escribe un 7 ahí se queda
 * con que cada siete días se comprueba algo. Hoy, en esta instalación, no se
 * comprueba nada: el directorio de FMCSA está atado al adaptador de
 * demostración, `isLive()` devuelve falso, y el propio barrido lo dice por
 * consola —«Sin credenciales de FMCSA: no se revalidó a nadie»— donde no lo
 * lee nadie.
 *
 * Un campo que acepta un número y no gobierna nada es la misma familia que el
 * permiso que no manda: la pantalla donde se toma la decisión tiene que decir
 * si la decisión tiene efecto.
 *
 * ## Lo que esta clase NO afirma
 *
 * Que haya proveedor conectado no significa que la revalidación esté corriendo:
 * hace falta además que el planificador ejecute `notifications:sweep`. Por eso
 * se devuelven las dos cosas por separado —`providerLive` y `lastVerifiedAt`— y
 * la pantalla las cuenta por separado. Juntarlas en un solo semáforo verde
 * sería inventarse una garantía.
 */
final class RevalidationState
{
    /**
     * @return array{days: int, providerLive: bool, lastVerifiedAt: string|null, dueCount: int}
     */
    public static function for(string $tenantId): array
    {
        $dias = TenantPolicy::for($tenantId)->fmcsaReverificationDays;

        $ultima = DB::table('carriers')
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at')
            ->max('fmcsa_last_verified_at');

        // Cuántos transportistas llevan más del plazo sin comprobarse. Es el
        // número que convierte «no está conectado» en algo con tamaño: sin él,
        // el aviso se lee como una nota técnica y no como una cola de trabajo.
        $corte = now()->subDays($dias);

        $vencidos = DB::table('carriers')
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at')
            ->where(fn ($q) => $q->whereNull('fmcsa_last_verified_at')
                ->orWhere('fmcsa_last_verified_at', '<', $corte))
            ->count();

        return [
            'days' => $dias,
            'providerLive' => app(FmcsaDirectory::class)->isLive(),
            'lastVerifiedAt' => $ultima === null ? null : substr((string) $ultima, 0, 16),
            'dueCount' => $vencidos,
        ];
    }
}
