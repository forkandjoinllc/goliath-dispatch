<?php

declare(strict_types=1);

namespace App\Support\Notifications;

use App\Authorization\RoleMatrix;
use App\Enums\Role;
use App\Enums\Scope;

/**
 * Qué avisos existen, a quién pueden llegarle y con qué permiso.
 *
 * ## El defecto
 *
 * La pantalla «De qué se le avisa» ofrecía diecisiete interruptores a todo el
 * mundo, y a un transportista o a un conductor **no puede llegarle ninguno**.
 * No por un fallo: `Notifier::recipients()` exige alcance de empresa o más, y
 * lo hace por un buen motivo escrito allí mismo —el rol transportista tiene
 * `invoice:read` con alcance de transportista, y avisarle de que «hay facturas
 * vencidas» le contaría que existen las de los demás—. El resultado es que esos
 * dos roles configuraban diecisiete cosas que nunca iban a ocurrirles.
 *
 * Y detrás había dos silencios de verdad. Al rechazar un documento, la pantalla
 * le EXIGE al revisor un motivo de diez caracteres como mínimo, con este
 * argumento escrito en la propia copia:
 *
 * > «Diga qué le falta o qué está mal — al menos diez caracteres. **El
 * > transportista lo va a leer**, y "rechazado" a secas garantiza una segunda
 * > subida igual de mala.»
 *
 * El motivo se guardaba, se podía leer en la ficha del documento… y nada se lo
 * decía. Lo mismo con las notas de correcciones de la incorporación. El
 * producto le pedía trabajo a una persona en nombre de un lector al que nunca
 * se le anunciaba que existiera.
 *
 * ## Por qué un registro
 *
 * Porque «a quién puede llegarle esto» estaba repartido entre el emisor, la
 * matriz de roles y una lista escrita a mano en el controlador de la pantalla,
 * y las tres podían decir cosas distintas sin que nadie se enterase. Aquí cada
 * suceso declara su permiso y su público, y de eso se derivan las dos cosas:
 * a quién se le manda y qué interruptores se le enseñan.
 */
final class Events
{
    /** Le llega a la oficina: quien tenga el permiso con alcance de empresa o más. */
    public const OFICINA = 'oficina';

    /** Le llega a UN transportista: los usuarios de ese transportista y nadie más. */
    public const TRANSPORTISTA = 'transportista';

    /**
     * Le llega a UNA persona: la dueña de eso.
     *
     * El caso del gasto. Quien lo presentó es quien tiene que enterarse de la
     * decisión — y hasta que se le dio `expense:read` con alcance propio, no
     * podía enterarse ni mirando.
     */
    public const PROPIO = 'propio';

    /**
     * Suceso => [permiso que hay que tener, a quién le llega].
     *
     * El permiso no es decoración: un aviso sobre algo que quien lo recibe no
     * puede abrir es una campana que suena para nada, y en el caso de la
     * oficina es además cómo se evita contarle a un rol lo que no le toca.
     *
     * El público puede ser UNO o VARIOS. Que fuera siempre uno era una
     * limitación de este registro, no del dominio: el vencimiento de un
     * documento le importa a la oficina Y al dueño del papel, y mientras aquí
     * solo cupo «oficina» el dueño no se enteraba de que su licencia caducaba
     * — con la pantalla prometiéndole que sí. Ver `docs/expiry-audience.md`.
     *
     * @var array<string, array{0: string, 1: string|list<string>}>
     */
    public const CATALOGO = [
        'document.expiring' => ['document:read', [self::OFICINA, self::TRANSPORTISTA, self::PROPIO]],
        'document.expired' => ['document:read', [self::OFICINA, self::TRANSPORTISTA, self::PROPIO]],
        'document.rejected' => ['document:read', self::TRANSPORTISTA],
        'carrier.reverification_due' => ['carrier:read', self::OFICINA],
        'onboarding.corrections_required' => ['carrier:onboarding:read', self::TRANSPORTISTA],
        'expense.rejected' => ['expense:read', self::PROPIO],
        'invoice.overdue' => ['invoice:read', self::OFICINA],
        'tracking.link_not_sent' => ['tracking:read', self::OFICINA],
        'lead.received' => ['lead:read', self::OFICINA],
        'lead.unattended' => ['lead:read', self::OFICINA],
        'lead.assigned' => ['lead:read', self::OFICINA],
        'signature.signed' => ['signature:request:read', self::OFICINA],
        'signature.declined' => ['signature:request:read', self::OFICINA],
        'signature.expired' => ['signature:request:read', self::OFICINA],
        'load.rateconf.accepted' => ['load:financials:update', self::OFICINA],
        'load.rateconf.rejected' => ['load:financials:update', self::OFICINA],
        'load.rateconf.changes_requested' => ['load:financials:update', self::OFICINA],
        'load.rateconf.unanswered' => ['load:financials:update', self::OFICINA],
        'subscription.trial_ending' => ['tenant:settings:read', self::OFICINA],
        'subscription.trial_ended' => ['tenant:settings:read', self::OFICINA],
    ];

    /**
     * Los sucesos que este rol puede llegar a recibir.
     *
     * Es lo que decide qué interruptores se enseñan. Antes la lista estaba
     * escrita a mano y era la misma para todos, así que un transportista veía
     * diecisiete que no podían ocurrirle.
     *
     * @return list<string>
     */
    public static function paraRol(Role $rol): array
    {
        $permisos = RoleMatrix::for($rol);
        $suyos = [];

        foreach (self::CATALOGO as $suceso => [$permiso, $_]) {
            $alcance = $permisos[$permiso] ?? null;

            if (! $alcance instanceof Scope) {
                continue;
            }

            // Las dos reglas son las del emisor, no una copia parecida:
            // a la oficina se le manda por permiso con alcance de empresa o
            // más; al transportista, por su afiliación, y su alcance propio
            // basta porque solo ve lo suyo.
            // Las tres reglas son las del emisor, no una copia parecida:
            //  - a la oficina, por permiso con alcance de empresa o más;
            //  - al transportista, por su afiliación, y su alcance propio basta
            //    porque solo ve lo suyo;
            //  - al dueño, cualquier alcance vale: la cosa es suya por
            //    construcción, y lo único que hay que comprobar es que su rol
            //    pueda leerla.
            // Con CUALQUIERA de sus públicos basta: un suceso que le llega al
            // dueño le llega, aunque su rol no sea el de la oficina.
            $llega = false;

            foreach (self::publicos($suceso) as $publico) {
                $llega = $llega || match ($publico) {
                    self::OFICINA => $alcance->atLeast(Scope::Tenant),
                    self::TRANSPORTISTA => $rol === Role::Carrier && $alcance->atLeast(Scope::Carrier),
                    self::PROPIO => true,
                    default => false,
                };
            }

            if ($llega) {
                $suyos[] = $suceso;
            }
        }

        return $suyos;
    }

    /** El permiso que hace falta para recibir este suceso. */
    public static function permiso(string $suceso): ?string
    {
        return self::CATALOGO[$suceso][0] ?? null;
    }

    /**
     * A quién le llega este suceso, siempre como lista.
     *
     * @return list<string>
     */
    public static function publicos(string $suceso): array
    {
        $publico = self::CATALOGO[$suceso][1] ?? null;

        if ($publico === null) {
            return [];
        }

        return is_array($publico) ? array_values($publico) : [$publico];
    }

    /** A quién le llega este suceso. */
    public static function publico(string $suceso): ?string
    {
        return self::publicos($suceso)[0] ?? null;
    }
}
