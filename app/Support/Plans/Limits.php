<?php

declare(strict_types=1);

namespace App\Support\Plans;

use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Los topes del plan: qué se cuenta, contra qué, y cuándo bloquea.
 *
 * `saas_plans` trae `max_users`, `max_carriers` y `max_loads_per_month` desde el
 * primer día, la pantalla de suscripción los VENDE con esas palabras, y hasta el
 * lote 56 no los leía nadie. Se podían crear los usuarios que fuera en el plan
 * más pequeño. El mismo defecto que los interruptores del lote 55 —algo que la
 * pantalla promete y el código no cumple— pero en la parte comercial, donde
 * además falla en las dos direcciones: quien paga el plan grande no recibe nada
 * a cambio de la diferencia.
 *
 * ## Qué ocupa asiento, y qué no
 *
 * `max_users` cuenta SOLO al personal de la empresa de dispatch: `admin`,
 * `accounting` y `dispatcher`. Las cuentas de portal —`carrier` y `driver`— no
 * ocupan asiento, y esto no es generosidad, es la única lectura que no es
 * absurda: el plan Starter vende cinco usuarios y quince transportistas, así que
 * si cada chófer de cada transportista gastara asiento, el tope de transportistas
 * sería inalcanzable por construcción.
 *
 * Y no es hipotético. La empresa de demostración, recién sembrada, tiene tres
 * personas de plantilla y dos cuentas de portal: contando todo son 5 de 5 y no
 * podría contratar a un segundo despachador porque uno de sus transportistas
 * tiene un chófer dado de alta. Contando plantilla son 3 de 5, que es lo que
 * cualquiera entiende al leer la oferta.
 *
 * Ocupan asiento los estados `active` e `invited`: una invitación pendiente ya
 * está gastada. Si no contara, se invitaría a diez personas con cinco asientos y
 * el error saltaría al ACEPTAR — es decir, en la cara de la persona invitada, que
 * es justo quien no puede arreglarlo.
 *
 * `max_carriers` cuenta los transportistas vivos menos los RECHAZADOS: un
 * expediente que se rechazó no es un transportista con el que se trabaje, y
 * dejarlo contando castigaría a quien filtra bien.
 *
 * `max_loads_per_month` cuenta las cargas creadas en el mes natural en curso.
 * Cuenta la creación, no el estado: una carga cancelada se creó, ocupó trabajo y
 * cuenta. El mes va en la zona horaria de la aplicación, igual que el resto de
 * los informes; que `tenants.default_timezone` exista y nadie la lea es otra
 * deuda, pero resolverla SOLO aquí dejaría este contador diciendo un número y los
 * informes diciendo otro, que es peor que la deuda.
 *
 * ## Contar no es bloquear
 *
 * `limits_enforced_at` en la suscripción decide si el tope es un muro o un aviso.
 * Nulo: se cuenta y se enseña. Con fecha: bloquea. Ver la migración
 * 2026_09_05_100000 para por qué existe esa distinción y por qué no se puede
 * encender sobre una empresa que ya está por encima.
 *
 * Una empresa SIN suscripción no tiene plan, y sin plan no hay tope: falta de
 * configuración no es falta de permiso, la misma regla que la validación de
 * sobredimensión del lote 55.
 */
final class Limits
{
    public const USERS = 'users';

    public const CARRIERS = 'carriers';

    public const LOADS = 'loadsThisMonth';

    /**
     * Recurso => columna de `saas_plans`.
     *
     * Esta lista es el contrato que comprueba tests/Unit/Suite/PlanLimitsTest.php:
     * toda columna `max_*` del esquema tiene que estar aquí y tener quien la
     * aplique. Una columna nueva que se venda en la pantalla y no aparezca en
     * este mapa es exactamente el defecto que este lote existe para cerrar.
     */
    public const COLUMNS = [
        self::USERS => 'max_users',
        self::CARRIERS => 'max_carriers',
        self::LOADS => 'max_loads_per_month',
    ];

    /** Los roles que ocupan asiento. El portal no. */
    public const SEAT_ROLES = ['admin', 'accounting', 'dispatcher'];

    /** Estados de afiliación que ocupan asiento. */
    private const SEAT_STATUSES = ['active', 'invited'];

    /**
     * Uso y tope de los tres recursos.
     *
     * @return array<string, array{used: int, limit: int|null, enforced: bool}>
     */
    public static function usage(string $tenantId): array
    {
        $plan = self::plan($tenantId);

        return app(TenantContext::class)->withoutTenant(function () use ($tenantId, $plan): array {
            $aplica = $plan !== null && $plan->limits_enforced_at !== null;

            $usados = [
                self::USERS => DB::table('user_tenant_memberships')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('role', self::SEAT_ROLES)
                    ->whereIn('status', self::SEAT_STATUSES)
                    ->whereNull('deleted_at')
                    ->count(),
                self::CARRIERS => DB::table('carriers')
                    ->where('tenant_id', $tenantId)
                    ->where('onboarding_status', '!=', 'rejected')
                    ->whereNull('deleted_at')
                    ->count(),
                self::LOADS => DB::table('loads')
                    ->where('tenant_id', $tenantId)
                    ->whereNull('deleted_at')
                    ->where('created_at', '>=', CarbonImmutable::now()->startOfMonth())
                    ->count(),
            ];

            $salida = [];

            foreach (self::COLUMNS as $recurso => $columna) {
                $tope = $plan === null || $plan->{$columna} === null ? null : (int) $plan->{$columna};

                $salida[$recurso] = [
                    'used' => $usados[$recurso],
                    'limit' => $tope,
                    'enforced' => $aplica,
                ];
            }

            return $salida;
        });
    }

    /**
     * ¿Está lleno este recurso, de forma que crear uno más debe rechazarse?
     *
     * Falso siempre que el tope no se aplique o no exista. La comparación es
     * `>=` y no `>`: con cinco de cinco ya no cabe el sexto.
     */
    public static function isFull(string $tenantId, string $resource): bool
    {
        $uso = self::usage($tenantId)[$resource] ?? null;

        if ($uso === null || ! $uso['enforced'] || $uso['limit'] === null) {
            return false;
        }

        return $uso['used'] >= $uso['limit'];
    }

    /**
     * Los recursos que ya están por encima de su tope, se aplique o no.
     *
     * Lo usa la pantalla de plataforma para NEGARSE a encender el bloqueo sobre
     * una empresa que ya lo incumple: primero la conversación, después el muro.
     *
     * @return list<string>
     */
    public static function over(string $tenantId): array
    {
        $fuera = [];

        foreach (self::usage($tenantId) as $recurso => $uso) {
            if ($uso['limit'] !== null && $uso['used'] > $uso['limit']) {
                $fuera[] = $recurso;
            }
        }

        return $fuera;
    }

    /**
     * La suscripción de la empresa con las columnas de tope de su plan.
     *
     * Se lee sin ámbito de empresa porque también la mira la plataforma, que
     * actúa fuera de una empresa concreta.
     */
    private static function plan(string $tenantId): ?object
    {
        return app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_subscriptions as s')
            ->join('saas_plans as p', 'p.id', '=', 's.plan_id')
            ->where('s.tenant_id', $tenantId)
            ->orderByDesc('s.created_at')
            ->first([
                's.limits_enforced_at',
                'p.max_users',
                'p.max_carriers',
                'p.max_loads_per_month',
            ]));
    }
}
