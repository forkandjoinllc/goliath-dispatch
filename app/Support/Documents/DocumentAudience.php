<?php

declare(strict_types=1);

namespace App\Support\Documents;

use App\Authorization\Actor;
use App\Enums\Role;
use Illuminate\Support\Facades\DB;

/**
 * A quién se le avisa de que un documento caduca.
 *
 * ## El defecto
 *
 * El formulario de subida promete, debajo de la fecha de vencimiento:
 *
 * > Se le avisará {days} días antes, y la puerta de despacho bloquea en cuanto
 * > vence.
 *
 * El aviso lo manda el barrido nocturno con
 * `Notifier::toPermissionHolders(permission: 'document:read', …)`, y
 * `Notifier::recipients()` solo mete a los roles cuyo alcance llega a
 * `Scope::Tenant`: **administrador y contabilidad, y nadie más**.
 *
 * `document:upload` lo tienen además el despachador (`Assigned`), el
 * transportista (`Carrier`) y el CONDUCTOR (`Own`). Los tres leen esa frase al
 * subir un papel con fecha. Ninguno de los tres recibía nada.
 *
 * El caso caro es el conductor con su tarjeta médica: lee que se le avisará,
 * deja de vigilar la fecha a mano, y el día que vence se entera porque la puerta
 * de cumplimiento le cierra la carga. La aplicación le pidió que confiara en un
 * aviso que no existía para él.
 *
 * ## Y la regla que lo tapaba tenía buen motivo, para OTRA cosa
 *
 * `Notifier` explica por qué exige alcance de empresa:
 *
 * > el rol transportista tiene `invoice:read` con alcance Carrier, y avisarle de
 * > que «hay facturas vencidas» le contaría que existen las de los demás.
 *
 * Es cierto — de un aviso AGREGADO. «Hay facturas vencidas» habla de un montón
 * que no es suyo. «Su certificado de seguro vence el 3 de marzo» habla de UN
 * papel, con su `subjectId`, que es suyo entero. La regla se escribió para el
 * primer caso y se aplicó a los dos.
 *
 * Y la prueba de que el producto ya sabía distinguirlos está al lado:
 * `document.rejected` SÍ le llega al transportista, por `Notifier::toCarrier`,
 * desde el lote de los avisos del transportista. El mismo documento, el mismo
 * dueño, el mismo canal — y el vencimiento se quedó fuera.
 *
 * ## El reparto
 *
 * Las dos listas son exhaustivas y su unión es exactamente `DocumentOwners`.
 * Un dueño nuevo hay que clasificarlo o el guardián se pone en rojo.
 */
final class DocumentAudience
{
    /**
     * Dueños que tienen a alguien FUERA de la oficina a quien avisar.
     *
     * Son los cuatro que una persona elige en el formulario genérico, y los
     * mismos cuatro que `DocumentScope::carrierOf()` sabe resolver. No es
     * casualidad: son los que cuelgan de un transportista.
     *
     * @var array<string, string>
     */
    public const AVISADOS = [
        'carrier' => 'Su propia documentación: autoridad, seguro, W-9. La renueva él.',
        'driver' => 'La licencia y la tarjeta médica de una persona. La renueva ella, y al vencer se queda sin poder subirse al camión.',
        'truck' => 'Matrícula e inspección de un camión suyo. El taller es suyo.',
        'trailer' => 'Matrícula e inspección de un remolque suyo, con las mismas fechas que el camión.',
    ];

    /**
     * Dueños cuyo papel es de la casa, y por qué no hay a quién avisar fuera.
     *
     * Coincide con lo que `DocumentScope::forCarriers()` ya decide: el
     * transportista no ve estos documentos desde la pantalla de documentos. Un
     * aviso sobre algo que quien lo recibe no puede abrir es una campana que
     * suena para nada.
     *
     * @var array<string, string>
     */
    public const SOLO_LA_OFICINA = [
        'load' => 'Los papeles de una carga —comprobante de entrega, confirmación de tarifa— se ven desde la carga, y no caducan.',
        'expense' => 'El recibo de un gasto. No tiene vencimiento que vigilar.',
        'permit' => 'El permiso de sobredimensión lo saca la casa y vence con el viaje.',
        'route_survey' => 'El estudio de ruta acompaña al permiso y muere con él: no hay nada que renovar.',
        'escort' => 'El papel del escolta lo contrata la casa.',
    ];

    /**
     * Lo que HOY no se avisa y se sabe, con su motivo.
     *
     * El despachador tiene `document:upload` y `document:read` con alcance
     * ASIGNADO, así que lee la promesa al subir y no entra en `recipients()`,
     * que exige alcance de empresa. Meterlo exigiría resolver, por cada
     * documento y por cada despachador, si ese transportista está entre los
     * suyos — y `Notifier` tiene escrito por qué no monta un `Actor` por miembro
     * y por noche.
     *
     * Mientras tanto NO SE LE PROMETE: el formulario le dice la verdad, que el
     * aviso va a la oficina y no a él. Una deuda declarada que la pantalla
     * respeta no es una mentira; es un hueco con nombre.
     *
     * @var array<string, string>
     */
    public const SIN_AVISO_HOY = [
        'dispatcher' => 'Alcance ASIGNADO: para avisarle habría que resolver por documento si ese transportista es de los suyos, y el barrido no monta un Actor por miembro. El formulario no se lo promete.',
    ];

    /** ¿Este dueño tiene a alguien fuera de la oficina a quien avisar? */
    public static function tieneAvisados(string $ownerType): bool
    {
        return array_key_exists($ownerType, self::AVISADOS);
    }

    /**
     * El usuario que ES este conductor, si lo hay.
     *
     * La licencia de un conductor es suya antes que de su transportista: es la
     * que le quitan a él en una inspección. Se resuelve por la afiliación, que
     * es donde vive `driver_id`, y solo si sigue activa — a quien ya no trabaja
     * aquí no se le avisa de nada.
     */
    public static function personaDe(object $documento): ?string
    {
        if ((string) ($documento->owner_type ?? '') !== 'driver') {
            return null;
        }

        $id = (string) ($documento->owner_id ?? '');

        if ($id === '') {
            return null;
        }

        $valor = DB::table('user_tenant_memberships')
            ->where('tenant_id', (string) ($documento->tenant_id ?? ''))
            ->where('driver_id', $id)
            ->where('role', Role::Driver->value)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->value('user_id');

        return $valor === null ? null : (string) $valor;
    }

    /**
     * ¿A ESTE actor le va a llegar el aviso de un documento de este dueño?
     *
     * Es lo que contesta el formulario. No se deduce de la pantalla: se calcula
     * con las mismas reglas del emisor, porque una promesa que se calcula aparte
     * es una promesa que se descuadra.
     */
    public static function avisaAlActor(Actor $actor, string $ownerType): bool
    {
        return match ($actor->role) {
            // La oficina con alcance de empresa: `recipients()` los mete a los dos.
            Role::Admin, Role::Accounting, Role::PlatformSuperAdmin => true,

            // El transportista, por los cuatro que cuelgan de él.
            Role::Carrier => self::tieneAvisados($ownerType),

            // El conductor, solo por lo suyo. Los otros tres dueños no son de
            // él aunque sean de su transportista.
            Role::Driver => $ownerType === 'driver',

            // Ver SIN_AVISO_HOY.
            Role::Dispatcher => false,

            null => false,
        };
    }
}
