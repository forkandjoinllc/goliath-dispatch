<?php

declare(strict_types=1);

namespace App\Support\Loads;

use App\Support\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * Contarle a despacho lo que el transportista contestó a la tarifa.
 *
 * ## El defecto
 *
 * La pantalla que ve el transportista le pide el motivo con esta frase, en los
 * dos idiomas:
 *
 * > Rejecting or requesting changes needs a reason. **Without one, dispatch has
 * > to call to find out what happened.**
 *
 * Le pide algo a cambio de una contrapartida concreta: si lo escribe, despacho
 * no tendrá que llamarle. Escribirlo no ahorraba ninguna llamada, porque
 * `RateConfirmationController::decide()` guardaba la decisión y el motivo y no
 * avisaba a nadie — cero llamadas al notificador, y ni un solo `rateconf.*` en
 * el catálogo de sucesos.
 *
 * Despacho se enteraba de que le habían rechazado la tarifa **solo si se le
 * ocurría abrir esa carga**. Mientras tanto la carga está parada: sin
 * confirmación aceptada no hay tarifa comprometida, y el transportista está
 * esperando una respuesta a un motivo que nadie ha leído.
 *
 * ## Los sucesos salen del enum, no de una lista a mano
 *
 * Hay uno por cada valor de `RateConfirmation::DECISIONES`. Si mañana aparece
 * una cuarta decisión, el guardián de `tests/Unit/Suite` exige su rótulo en los
 * dos idiomas y su casilla de preferencias antes de dejarla pasar — en vez de
 * que se mande un aviso sin nombre, o no se mande ninguno.
 *
 * ## A quién se avisa
 *
 * A quien puede EMITIR la confirmación: `load:financials:update`, el mismo
 * permiso que exige `issue()`. Es la simetría correcta — quien manda el papel
 * es quien tiene que enterarse de la respuesta. El transportista contesta con
 * `load:rateconf:respond`, que es `Scope::Carrier` y por tanto nunca lo tiene
 * nadie de la casa.
 */
final class RateResponse
{
    /** Quién se entera: el mismo permiso que hace falta para emitir el papel. */
    public const PERMISO = 'load:financials:update';

    /** El aviso de que una confirmación lleva días sin respuesta. */
    public const SIN_CONTESTAR = 'load.rateconf.unanswered';

    /** La clave del suceso de una decisión concreta. */
    public static function sucesoDe(string $decision): string
    {
        return 'load.rateconf.'.$decision;
    }

    /** Todas las claves de suceso que esta clase puede escribir. */
    public static function sucesos(): array
    {
        $claves = array_map(self::sucesoDe(...), RateConfirmation::DECISIONES);
        $claves[] = self::SIN_CONTESTAR;

        return $claves;
    }

    /**
     * Avisa de la decisión del transportista.
     *
     * @return int cuántos avisos se escribieron
     */
    public static function announce(object $carga, string $decision, ?string $motivo): int
    {
        $tenantId = (string) $carga->tenant_id;

        if ($tenantId === '' || ! in_array($decision, RateConfirmation::DECISIONES, true)) {
            return 0;
        }

        $transportista = $carga->carrier_id === null
            ? null
            : DB::table('carriers')->where('id', $carga->carrier_id)->value('legal_name');

        return Notifier::toPermissionHolders(
            tenantId: $tenantId,
            permission: self::PERMISO,
            eventKey: self::sucesoDe($decision),
            // Por DECISIÓN y no por carga: el transportista puede rechazar hoy
            // y aceptar la reemisión de mañana, y las dos cosas hay que
            // contarlas. Con la carga sola en la clave, la segunda no sonaría.
            dedupeKey: self::sucesoDe($decision).':'.$carga->id.':'.($carga->carrier_gross_rate_cents ?? 0),
            params: [
                'load' => (string) $carga->load_number,
                'carrier' => $transportista === null ? '—' : (string) $transportista,
                // Recortado: esto va al asunto de un correo y el campo admite
                // dos mil caracteres. Completo está en la pantalla del papel,
                // que es adonde lleva el enlace.
                'reason' => $motivo === null || trim($motivo) === ''
                    ? '—'
                    : mb_strimwidth(trim($motivo), 0, 160, '…'),
            ],
            actionUrl: '/loads/'.$carga->id.'/rate-confirmation',
            subjectType: 'load',
            subjectId: (string) $carga->id,
        );
    }
}
