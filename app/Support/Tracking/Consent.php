<?php

declare(strict_types=1);

namespace App\Support\Tracking;

use App\Authorization\Actor;
use App\Enums\AuditAction;
use App\Support\Audit;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * El consentimiento del conductor para que se rastree su ubicación.
 *
 * ## El defecto
 *
 * La pantalla de rastreo decía —y sigue diciendo— esto:
 *
 * > «El rastreo de ubicación envía la posición GPS de este conductor a despacho
 * > y a los clientes que vean el enlace público mientras la carga está en
 * > tránsito. El rastreo NO PUEDE INICIARSE hasta que el conductor otorgue su
 * > consentimiento, y SE DETIENE DE INMEDIATO si el consentimiento se retira.»
 *
 * No había puerta, ni registro, ni forma de retirarlo. `consent_records` estaba
 * vacía, `drivers.tracking_consent_granted_at` solo se pintaba, el mensaje
 * `errors.trackingConsentMissing` no lo usaba nadie, y ni los sucesos
 * `consent_granted`/`consent_revoked` ni la acción de bitácora
 * `tracking.consent_changed` los escribía nadie. Todo estaba previsto —hasta el
 * permiso `tracking:consent` con ámbito propio, concedido SOLO al conductor— y
 * nada estaba conectado.
 *
 * Es el mismo patrón de los tres lotes anteriores, en el sitio donde peor
 * sienta: la ubicación en vivo de una persona, enseñada además a terceros.
 *
 * ## El consentimiento es sobre UN TEXTO
 *
 * `policy_version` no es burocracia. Alguien consintió una frase concreta, y si
 * esa frase cambia, lo que consintió ya no es lo que se le pide ahora. Por eso
 * la versión es una constante de esta clase y la comprobación exige la versión
 * VIGENTE: cambiar el texto de `tracking.consent.description` obliga a subir la
 * versión, y al subirla todo el mundo vuelve a «no otorgado» y hay que volver a
 * preguntar. Es incómodo a propósito — es lo que distingue pedir permiso de
 * haberlo pedido una vez.
 *
 * Se guarda además el idioma en que se leyó. Un consentimiento sobre un texto en
 * un idioma que el conductor no lee no vale gran cosa, y aquí la mitad de los
 * conductores trabajan en español.
 *
 * ## Solo el conductor
 *
 * `tracking:consent` es `Scope::Own` y solo lo tiene el rol `driver`. Un
 * despachador no puede marcar la casilla por él, ni siquiera «porque lo dijo por
 * teléfono»: eso sería el despachador afirmando algo, no el conductor
 * consintiendo, y guardar lo segundo cuando pasó lo primero es exactamente la
 * clase de mentira que este lote existe para quitar. Un conductor sin cuenta de
 * portal no puede consentir, y entonces su ubicación no se rastrea.
 *
 * ## Lo que este código NO es
 *
 * Es un registro y una puerta. **No es una afirmación de que esto satisfaga
 * ninguna obligación legal de ningún sitio**, ni de que el texto que se enseña
 * sea suficiente donde se use. Qué haya que pedir, cómo y con qué redacción es
 * una cuestión legal, y quien despliegue esto tiene que resolverla con su
 * abogado. Lo que aquí se garantiza es más modesto y comprobable: que sin un
 * consentimiento vigente el rastreo no arranca, y que al retirarlo se para.
 */
final class Consent
{
    public const TIPO = 'tracking_location';

    /**
     * La versión del texto que se consiente.
     *
     * SUBIRLA CUANDO CAMBIE `tracking.consent.description` en cualquiera de los
     * dos idiomas. Al subirla, los consentimientos anteriores dejan de contar y
     * se vuelve a preguntar; eso es lo correcto, no un efecto secundario.
     */
    public const VERSION = '2026-09-tracking-v1';

    /** ¿Tiene este usuario un consentimiento vigente para la versión de hoy? */
    public static function vigente(?string $tenantId, ?string $userId): bool
    {
        if ($userId === null) {
            return false;
        }

        return self::ultimo($tenantId, $userId) !== null;
    }

    /**
     * El consentimiento vigente, o nulo.
     *
     * «Vigente» es: otorgado, no retirado, y sobre la versión de HOY del texto.
     */
    public static function ultimo(?string $tenantId, string $userId): ?object
    {
        return app(TenantContext::class)->withoutTenant(fn () => DB::table('consent_records')
            ->where('user_id', $userId)
            ->where('consent_type', self::TIPO)
            ->where('policy_version', self::VERSION)
            ->where('granted', 1)
            ->whereNull('revoked_at')
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->orderByDesc('created_at')
            ->first());
    }

    /** ¿Puede rastrearse a este conductor? */
    public static function permiteRastrear(string $tenantId, string $driverId): bool
    {
        $userId = self::cuentaDe($tenantId, $driverId);

        return $userId !== null && self::vigente($tenantId, $userId);
    }

    /**
     * La cuenta de acceso de un conductor, si tiene.
     *
     * Se resuelve por la AFILIACIÓN (`user_tenant_memberships.driver_id`) y no
     * por `drivers.user_id`. Las dos columnas existen y solo la primera la
     * mantiene la aplicación: es la que rellena la invitación y la que lee
     * `ActorFactory` para dar `Actor::driverId`. `drivers.user_id` la escribe el
     * sembrador y nadie más, así que apoyarse en ella dejaría la puerta cerrada
     * para todo conductor invitado por el camino normal — y sin que nadie
     * entendiera por qué.
     */
    public static function cuentaDe(string $tenantId, string $driverId): ?string
    {
        $userId = app(TenantContext::class)->withoutTenant(fn () => DB::table('user_tenant_memberships')
            ->where('tenant_id', $tenantId)
            ->where('driver_id', $driverId)
            ->where('role', 'driver')
            ->whereNull('deleted_at')
            ->value('user_id'));

        return $userId === null ? null : (string) $userId;
    }

    /**
     * El conductor otorga su consentimiento.
     *
     * Se guarda desde dónde y con qué navegador. No es vigilancia: es lo que
     * permite distinguir, meses después, un consentimiento de una fila escrita a
     * mano en la base de datos.
     */
    public static function otorgar(Actor $actor, Request $request): string
    {
        $id = (string) Str::uuid();
        $ahora = CarbonImmutable::now();

        app(TenantContext::class)->withoutTenant(fn () => DB::table('consent_records')->insert([
            'id' => $id,
            'tenant_id' => $actor->tenantId,
            'user_id' => $actor->userId,
            'consent_type' => self::TIPO,
            'policy_version' => self::VERSION,
            'granted' => 1,
            'locale' => $actor->locale->value,
            'ip_address' => $request->ip(),
            'user_agent' => mb_substr((string) $request->userAgent(), 0, 1000),
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]));

        self::espejo($actor, $ahora);
        self::anotar($actor, true);

        return $id;
    }

    /**
     * El conductor lo retira.
     *
     * Marca TODOS sus consentimientos vivos, no solo el último: si por lo que
     * sea hubiera dos, retirar uno y dejar el otro haría que la puerta siguiera
     * abierta después de que la persona dijera que no.
     *
     * @return int sesiones de rastreo que se cerraron por esto
     */
    public static function retirar(Actor $actor): int
    {
        $ahora = CarbonImmutable::now();

        app(TenantContext::class)->withoutTenant(fn () => DB::table('consent_records')
            ->where('user_id', $actor->userId)
            ->where('consent_type', self::TIPO)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => $ahora, 'updated_at' => $ahora]));

        self::espejo($actor, null);
        self::anotar($actor, false);

        // «Se detiene de inmediato» es la mitad de la frase que la pantalla
        // lleva prometiendo desde el principio, y es la mitad que importa: un
        // consentimiento que se puede retirar pero no para nada no es un
        // consentimiento, es un formulario.
        return Sessions::cerrarPorRetirada($actor);
    }

    /**
     * La copia en `drivers`, para leer rápido. La verdad está en
     * `consent_records`.
     *
     * Por `Actor::driverId` —la ficha de quien está consintiendo— y no por
     * `drivers.user_id`, que la aplicación no mantiene.
     */
    private static function espejo(Actor $actor, ?CarbonImmutable $cuando): void
    {
        if ($actor->driverId === null) {
            return;
        }

        app(TenantContext::class)->withoutTenant(fn () => DB::table('drivers')
            ->where('id', $actor->driverId)
            ->update(['tracking_consent_granted_at' => $cuando, 'updated_at' => CarbonImmutable::now()]));
    }

    private static function anotar(Actor $actor, bool $otorgado): void
    {
        Audit::record(
            $actor,
            AuditAction::TrackingConsentChanged,
            entityType: 'consent_record',
            entityId: (string) $actor->userId,
            entityLabel: $actor->fullName(),
            after: ['granted' => $otorgado, 'policyVersion' => self::VERSION],
        );
    }
}
