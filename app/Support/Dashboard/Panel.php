<?php

declare(strict_types=1);

namespace App\Support\Dashboard;

use App\Authorization\Actor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Http\Controllers\App\InvoiceController;
use App\Models\CarrierSettlement;
use App\Models\Document;
use App\Models\Expense;
use App\Models\Invoice;
use App\Models\Load;
use App\Support\Documents\DocumentScope;
use App\Support\Finance\Billable;
use App\Support\Loads\LoadScope;
use App\Support\Tenancy\TenantPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Lo que hay pendiente, para quien acaba de entrar.
 *
 * La pantalla de inicio era un volcado de la matriz de permisos: exacta, útil
 * para depurar una concesión, y sin una sola respuesta a la pregunta con la que
 * de verdad se abre la aplicación por la mañana, que es «¿qué me falta por
 * hacer?». Todas esas cifras ya existían; lo que no existía era un sitio donde
 * mirarlas juntas, así que cada una solo se veía si alguien se acordaba de
 * abrir su pantalla.
 *
 * Tres reglas que sostienen esta clase:
 *
 *  - **Cada tarjeta es una pregunta que alguien se hace, y al pulsarla lleva a
 *    la lista que la contesta.** Un número sobre el que no se puede actuar es
 *    decoración. Por eso ninguna tarjeta existe sin su `href`, y ese `href`
 *    apunta a la pantalla YA FILTRADA.
 *  - **Se cuenta con el mismo estrechamiento que usa esa pantalla.** No hay
 *    consultas nuevas inventadas aquí: se reutilizan `LoadScope`,
 *    `DocumentScope`, `ScopeFilter` y `Billable`. Si el panel contara por su
 *    cuenta, un despachador podría ver en el número lo que la lista le esconde
 *    — que es una fuga de información con forma de dígito.
 *  - **Una tarjeta que el actor no puede consultar no se calcula, no se manda
 *    y no aparece.** Se comprueba el permiso ANTES de la consulta, no después
 *    de traer las filas.
 *
 * Las etiquetas no viven aquí: cada tarjeta viaja con su clave y el cliente la
 * traduce con `dashboard.cards.<clave>`. Así el panel no tiene que saber en qué
 * idioma se está sirviendo.
 */
final class Panel
{
    /**
     * @param  array<string, mixed>|null  $policy
     * @return list<array{key: string, group: string, count: int, href: string, tone: string}>
     */
    public static function cards(Actor $actor, PermissionChecker $checker, ?array $policy): array
    {
        $tarjetas = [];

        foreach (self::builders() as $clave => $constructor) {
            $tarjeta = $constructor($actor, $checker, $policy);

            if ($tarjeta !== null) {
                $tarjetas[] = [...$tarjeta, 'key' => $clave];
            }
        }

        return $tarjetas;
    }

    /**
     * @return array<string, callable(Actor, PermissionChecker, ?array<string, mixed>): (array{group: string, count: int, href: string, tone: string}|null)>
     */
    private static function builders(): array
    {
        return [
            'loadsAvailable' => self::loads('available', '/loads?status=available', 'warn'),
            'loadsInTransit' => self::loads('in_transit', '/loads?status=in_transit', 'neutral'),
            'loadsDelivered' => self::loads('delivered', '/loads?status=delivered', 'neutral'),
            'loadsUninvoiced' => self::uninvoiced(...),
            'documentsExpiring' => self::documentsExpiring(...),
            'carriersFmcsaStale' => self::carriersFmcsaStale(...),
            'invoicesOverdue' => self::invoicesOverdue(...),
            'expensesPending' => self::expensesPending(...),
            'settlementsDraft' => self::settlementsDraft(...),
            'commissionsAccrued' => self::commissionsAccrued(...),
            'leadsUnassigned' => self::leadsUnassigned(...),
        ];
    }

    // ------------------------------------------------------------- operación

    /**
     * Cargas en un estado concreto, con el alcance del actor.
     *
     * Un conductor con alcance `own` cuenta solo las suyas; un despachador, las
     * de los transportistas que lleva. Es el mismo `LoadScope` que usa la
     * pantalla de cargas, así que el número y la lista no pueden discrepar.
     *
     * @return callable(Actor, PermissionChecker, ?array<string, mixed>): (array{group: string, count: int, href: string, tone: string}|null)
     */
    private static function loads(string $estado, string $href, string $tono): callable
    {
        return static function (Actor $actor, PermissionChecker $checker, ?array $policy) use ($estado, $href, $tono): ?array {
            $decision = $checker->can($actor, 'load:read', null, $policy);

            if (! $decision->allowed || $decision->scope === null) {
                return null;
            }

            $total = LoadScope::apply(
                Load::query()->where('loads.tenant_id', $actor->tenantId),
                $checker,
                $actor,
                $decision->scope,
            )->where('loads.status', $estado)->count();

            return [
                'group' => 'operations',
                'count' => $total,
                'href' => $href,
                'tone' => $total > 0 ? $tono : 'neutral',
            ];
        };
    }

    /**
     * Trabajo hecho y no cobrado.
     *
     * Es la tarjeta que más dinero mueve: una carga entregada que nadie facturó
     * no aparece en ningún informe, porque los informes cuentan lo FACTURADO.
     * Sin esta tarjeta, la única forma de verla era abrir el alta de facturas y
     * fijarse.
     *
     * Pide los dos permisos: ver cargas para saber que existe, y crear facturas
     * para poder hacer algo al respecto. A quien solo puede lo primero, el
     * número le diría «hay dinero sin cobrar» y el enlace le daría un 403.
     *
     * @param  array<string, mixed>|null  $policy
     * @return array{group: string, count: int, href: string, tone: string}|null
     */
    private static function uninvoiced(Actor $actor, PermissionChecker $checker, ?array $policy): ?array
    {
        $lectura = $checker->can($actor, 'load:read', null, $policy);

        if (! $lectura->allowed || $lectura->scope === null
            || ! $lectura->scope->atLeast(Scope::Tenant)
            || ! $checker->can($actor, 'invoice:create', null, $policy)->allowed) {
            return null;
        }

        $total = Billable::query((string) $actor->tenantId)->count();

        return [
            'group' => 'finance',
            'count' => $total,
            'href' => '/invoices/create',
            'tone' => $total > 0 ? 'warn' : 'neutral',
        ];
    }

    // ----------------------------------------------------------- cumplimiento

    /**
     * Documentos caducados o a punto de caducar.
     *
     * El plazo sale de `tenant_settings.document_expiration_warning_days`, y el
     * predicado es LITERALMENTE el del filtro «caducan pronto» de la pantalla
     * de documentos: el enlace lleva a esa pantalla con ese filtro puesto, y si
     * los dos no contaran igual, pulsar la tarjeta enseñaría otra cifra.
     *
     * @param  array<string, mixed>|null  $policy
     * @return array{group: string, count: int, href: string, tone: string}|null
     */
    private static function documentsExpiring(Actor $actor, PermissionChecker $checker, ?array $policy): ?array
    {
        $decision = $checker->can($actor, 'document:read', null, $policy);

        if (! $decision->allowed || $decision->scope === null) {
            return null;
        }

        $dias = TenantPolicy::for($actor->tenantId)->documentWarningDays;

        $total = DocumentScope::apply(Document::query(), $checker, $actor, $decision->scope)
            ->whereNotNull('expiration_date')
            ->where('expiration_date', '<=', CarbonImmutable::now()->addDays($dias))
            ->count();

        return [
            'group' => 'compliance',
            'count' => $total,
            'href' => '/documents?expiring=1',
            'tone' => $total > 0 ? 'danger' : 'neutral',
        ];
    }

    /**
     * Transportistas cuya verificación en FMCSA se ha quedado vieja.
     *
     * «Vieja» lo define `tenant_settings.fmcsa_reverification_days`, que hasta
     * ahora se guardaba y no lo leía nadie. Cuenta también a los que no se han
     * verificado NUNCA: no tener verificación es peor que tenerla caducada, y
     * dejarlos fuera del número los dejaría fuera de la vista.
     *
     * @param  array<string, mixed>|null  $policy
     * @return array{group: string, count: int, href: string, tone: string}|null
     */
    private static function carriersFmcsaStale(Actor $actor, PermissionChecker $checker, ?array $policy): ?array
    {
        $decision = $checker->can($actor, 'carrier:read', null, $policy);

        if (! $decision->allowed || $decision->scope === null || ! $decision->scope->atLeast(Scope::Tenant)) {
            return null;
        }

        $limite = CarbonImmutable::now()->subDays(TenantPolicy::for($actor->tenantId)->fmcsaReverificationDays);

        $total = DB::table('carriers as c')
            ->where('c.tenant_id', $actor->tenantId)
            ->whereNull('c.deleted_at')
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('fmcsa_verifications as v')
                ->whereColumn('v.carrier_id', 'c.id')
                ->where('v.tenant_id', $actor->tenantId)
                ->where('v.checked_at', '>=', $limite))
            ->count();

        return [
            'group' => 'compliance',
            'count' => $total,
            'href' => '/carriers',
            'tone' => $total > 0 ? 'warn' : 'neutral',
        ];
    }

    // ------------------------------------------------------------------ dinero

    /**
     * @param  array<string, mixed>|null  $policy
     * @return array{group: string, count: int, href: string, tone: string}|null
     */
    private static function invoicesOverdue(Actor $actor, PermissionChecker $checker, ?array $policy): ?array
    {
        $decision = $checker->can($actor, 'invoice:read', null, $policy);

        if (! $decision->allowed || $decision->scope === null) {
            return null;
        }

        $query = $checker->scopeFilter($actor, $decision->scope)->apply(
            Invoice::query()->where('invoices.tenant_id', $actor->tenantId),
            ['carrier' => 'carrier_id'],
        );

        // Por FECHA, no por el estado `overdue`: ese solo lo escribe
        // PaymentLedger al anotar un cobro, así que una factura que cruza su
        // vencimiento sin que nadie la toque se queda en `sent` para siempre.
        $total = InvoiceController::applyOverdue($query)->count();

        return [
            'group' => 'finance',
            'count' => $total,
            'href' => '/invoices?overdue=1',
            'tone' => $total > 0 ? 'danger' : 'neutral',
        ];
    }

    /**
     * @param  array<string, mixed>|null  $policy
     * @return array{group: string, count: int, href: string, tone: string}|null
     */
    private static function expensesPending(Actor $actor, PermissionChecker $checker, ?array $policy): ?array
    {
        $decision = $checker->can($actor, 'expense:read', null, $policy);

        if (! $decision->allowed || $decision->scope === null) {
            return null;
        }

        $total = $checker->scopeFilter($actor, $decision->scope)->apply(
            Expense::query()->where('expenses.tenant_id', $actor->tenantId),
            ['carrier' => 'carrier_id', 'owner' => 'submitted_by_user_id'],
        )->where('expenses.status', 'submitted')->count();

        return [
            'group' => 'finance',
            'count' => $total,
            'href' => '/expenses?status=submitted',
            'tone' => $total > 0 ? 'warn' : 'neutral',
        ];
    }

    /**
     * @param  array<string, mixed>|null  $policy
     * @return array{group: string, count: int, href: string, tone: string}|null
     */
    private static function settlementsDraft(Actor $actor, PermissionChecker $checker, ?array $policy): ?array
    {
        $decision = $checker->can($actor, 'settlement:read', null, $policy);

        if (! $decision->allowed || $decision->scope === null) {
            return null;
        }

        $total = $checker->scopeFilter($actor, $decision->scope)->apply(
            CarrierSettlement::query()->where('carrier_settlements.tenant_id', $actor->tenantId),
            ['carrier' => 'carrier_id'],
        )->where('carrier_settlements.status', 'draft')->count();

        return [
            'group' => 'finance',
            'count' => $total,
            'href' => '/settlements?status=draft',
            'tone' => $total > 0 ? 'warn' : 'neutral',
        ];
    }

    /**
     * Comisiones devengadas y todavía sin pagar.
     *
     * Con `assignment:read`, que es el permiso de la pantalla de comisiones: al
     * despachador se le concede con alcance `own`, así que aquí ve lo SUYO —
     * que es justo lo que quiere saber al entrar.
     *
     * @param  array<string, mixed>|null  $policy
     * @return array{group: string, count: int, href: string, tone: string}|null
     */
    private static function commissionsAccrued(Actor $actor, PermissionChecker $checker, ?array $policy): ?array
    {
        $decision = $checker->can($actor, 'assignment:read', null, $policy);

        if (! $decision->allowed || $decision->scope === null) {
            return null;
        }

        $query = DB::table('dispatcher_commissions')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->where('status', 'accrued');

        if (! $decision->scope->atLeast(Scope::Tenant)) {
            $query->where('dispatcher_user_id', $actor->userId);
        }

        $total = $query->count();

        return [
            'group' => 'finance',
            'count' => $total,
            'href' => '/commissions?status=accrued',
            'tone' => $total > 0 ? 'warn' : 'neutral',
        ];
    }

    // ---------------------------------------------------------------- comercial

    /**
     * @param  array<string, mixed>|null  $policy
     * @return array{group: string, count: int, href: string, tone: string}|null
     */
    private static function leadsUnassigned(Actor $actor, PermissionChecker $checker, ?array $policy): ?array
    {
        if (! $checker->can($actor, 'lead:read', null, $policy)->allowed) {
            return null;
        }

        $total = DB::table('leads')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->whereNull('assigned_to_user_id')
            ->whereNotIn('status', ['converted', 'lost'])
            ->count();

        return [
            'group' => 'commercial',
            'count' => $total,
            'href' => '/leads?assigned=unassigned',
            'tone' => $total > 0 ? 'warn' : 'neutral',
        ];
    }
}
