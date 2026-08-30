<?php

declare(strict_types=1);

namespace App\Support\Tracking;

use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Los enlaces con los que un cliente sigue su carga sin tener cuenta.
 *
 * SE GUARDA EL HASH, NUNCA EL ENLACE. La columna `token_hash` es `char(64)
 * ascii_bin` —un sha256 en hexadecimal— y la búsqueda va por igualdad exacta,
 * así que no hace falta recorrer filas. Quien lea la base de datos, una copia de
 * seguridad o un volcado de soporte no puede abrir con eso el seguimiento de
 * nadie. Es el mismo trato que se les da a los vales de invitación, y el
 * diccionario portado ya lo daba por hecho: «cópielo ahora — no se mostrará de
 * nuevo».
 *
 * Un enlace muere de tres maneras distintas y la página pública las cuenta por
 * separado, porque al cliente le mandan a sitios distintos: uno que NO EXISTE
 * probablemente está mal copiado; uno VENCIDO se arregla pidiendo otro; y uno
 * REVOCADO se lo quitaron a propósito. Decir «no válido» a las tres sería
 * cómodo y le haría perder el tiempo a alguien.
 */
final class TrackingLinks
{
    /** Tope de horas de vida, por encima de lo que pida quien lo crea. */
    private const MAX_HORAS = 720;

    /**
     * Crea un enlace y devuelve el token EN CLARO, que es lo único que sale de
     * aquí y solo viaja a la pantalla que lo acaba de pedir.
     */
    public static function issue(
        string $tenantId,
        string $loadId,
        ?string $label,
        ?string $recipientEmail,
        ?int $ttlHours,
        ?string $createdByUserId,
    ): string {
        $plano = Str::random(48);
        $ahora = CarbonImmutable::now();

        $horas = max(1, min(
            $ttlHours ?? self::defaultTtlHours($tenantId),
            self::MAX_HORAS,
        ));

        DB::table('public_tracking_links')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'load_id' => $loadId,
            'token_hash' => hash('sha256', $plano),
            'label' => $label,
            'recipient_email' => $recipientEmail,
            'expires_at' => $ahora->addHours($horas),
            'created_by_user_id' => $createdByUserId,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return $plano;
    }

    /**
     * Encuentra el enlace por su token y dice en qué estado está.
     *
     * Va sin ámbito de empresa a propósito: quien abre esta dirección no tiene
     * sesión y por tanto no tiene empresa. El token ES la autorización, y de ahí
     * sale el `tenant_id` que estrecha todo lo demás — nunca al revés.
     *
     * @return array{state: string, link: object|null}
     */
    public static function resolve(string $plano): array
    {
        $fila = app(TenantContext::class)->withoutTenant(fn () => DB::table('public_tracking_links')
            ->where('token_hash', hash('sha256', $plano))
            ->whereNull('deleted_at')
            ->first());

        if ($fila === null) {
            return ['state' => 'not_found', 'link' => null];
        }

        if ($fila->revoked_at !== null) {
            return ['state' => 'revoked', 'link' => $fila];
        }

        if (CarbonImmutable::parse((string) $fila->expires_at)->isBefore(CarbonImmutable::now())) {
            return ['state' => 'expired', 'link' => $fila];
        }

        return ['state' => 'active', 'link' => $fila];
    }

    /**
     * Anota una visita.
     *
     * `view_count` y `last_viewed_at` son lo único que le dice a la despachadora
     * si el cliente llegó a abrir lo que le mandó. Se incrementa con `increment`
     * y no leyendo y sumando: dos visitas a la vez perderían una.
     */
    public static function recordView(string $id): void
    {
        app(TenantContext::class)->withoutTenant(fn () => DB::table('public_tracking_links')
            ->where('id', $id)
            ->update([
                'view_count' => DB::raw('view_count + 1'),
                'last_viewed_at' => CarbonImmutable::now(),
            ]));
    }

    public static function revoke(string $tenantId, string $loadId, string $id): bool
    {
        return DB::table('public_tracking_links')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->where('id', $id)
            ->whereNull('revoked_at')
            ->whereNull('deleted_at')
            ->update([
                'revoked_at' => CarbonImmutable::now(),
                'updated_at' => CarbonImmutable::now(),
            ]) > 0;
    }

    /**
     * Los enlaces de una carga, sin el token —que ya no existe en ninguna parte.
     *
     * @return list<array<string, mixed>>
     */
    public static function forLoad(string $tenantId, string $loadId): array
    {
        $ahora = CarbonImmutable::now();

        return DB::table('public_tracking_links')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->whereNull('deleted_at')
            ->orderByDesc('created_at')
            ->get()
            ->map(static function (object $l) use ($ahora): array {
                $vence = CarbonImmutable::parse((string) $l->expires_at);

                return [
                    'id' => (string) $l->id,
                    'label' => $l->label,
                    'recipientEmail' => $l->recipient_email,
                    'expiresAt' => $vence->format('Y-m-d H:i'),
                    'revokedAt' => $l->revoked_at === null ? null : substr((string) $l->revoked_at, 0, 16),
                    'viewCount' => (int) $l->view_count,
                    'lastViewedAt' => $l->last_viewed_at === null ? null : substr((string) $l->last_viewed_at, 0, 16),
                    'createdAt' => substr((string) $l->created_at, 0, 16),
                    'state' => $l->revoked_at !== null
                        ? 'revoked'
                        : ($vence->isBefore($ahora) ? 'expired' : 'active'),
                ];
            })
            ->all();
    }

    public static function enabledFor(string $tenantId): bool
    {
        return TenantPolicy::for($tenantId)->publicTrackingEnabled;
    }

    public static function defaultTtlHours(string $tenantId): int
    {
        return TenantPolicy::for($tenantId)->publicTrackingTtlHours;
    }
}
