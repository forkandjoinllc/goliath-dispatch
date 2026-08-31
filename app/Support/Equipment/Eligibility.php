<?php

declare(strict_types=1);

namespace App\Support\Equipment;

use Carbon\CarbonImmutable;

/**
 * ¿Puede esta unidad ponerse en una carga?
 *
 * ## El defecto que esto cierra
 *
 * El diccionario de equipos decía, y dice, esto:
 *
 * > «Una unidad se da de alta pendiente de verificación. NO SE PUEDE PONER EN
 * > UNA CARGA hasta que alguien la haya revisado.»
 *
 * Y el comentario de EquipmentController lo repetía con otras palabras:
 * «`pending_verification` es lo que impide despacharla sin que alguien la haya
 * mirado». Las dos frases eran falsas. La asignación solo rechazaba
 * `out_of_service`: un camión recién dado de alta, que nadie había mirado, se
 * podía enganchar a una carga y salir a la carretera.
 *
 * Peor todavía: al asignar se GUARDA `next_inspection_due_at` en la instantánea,
 * como prueba de lo que se sabía en ese momento… sin mirar si ya había vencido.
 * El sistema anotaba diligentemente «la inspección de este camión venció hace
 * ocho meses» y lo asignaba igual.
 *
 * Y la asimetría estaba dentro de la MISMA función: para el conductor se
 * comprobaba el carné vencido y la tarjeta médica vencida; para la unidad, nada.
 *
 * ## Qué bloquea y qué no
 *
 * Bloquea lo que es un hecho comprobable y grave:
 *
 *  - fuera de servicio o archivada;
 *  - pendiente de verificar — la promesa del diccionario, ahora cierta;
 *  - inspección anual vencida;
 *  - matrícula vencida.
 *
 * Y una regla que gobierna las dos fechas: **una fecha que no consta NO
 * bloquea**. Nula es «nadie lo ha rellenado», no «está vencido». Cerrar la
 * puerta por un dato que falta pararía la operación de cualquiera que no lleve
 * el mantenimiento en este sistema, y les enseñaría a rellenar cualquier cosa
 * con tal de seguir — que es peor que no tener el dato. La misma regla que los
 * ajustes del lote 55 y los topes del 56: falta de configuración no es falta de
 * permiso.
 *
 * Los motivos se devuelven como CLAVES, y las traduce quien las pinta. Ver la
 * lección del lote 55 sobre props que ya vienen traducidas.
 */
final class Eligibility
{
    public const FUERA_DE_SERVICIO = 'outOfService';

    public const ARCHIVADA = 'archived';

    public const SIN_VERIFICAR = 'notVerified';

    public const INSPECCION_VENCIDA = 'inspectionOverdue';

    public const MATRICULA_VENCIDA = 'registrationExpired';

    /**
     * Todos los motivos por los que esta unidad no puede ir a una carga.
     *
     * Se devuelven TODOS y no el primero: quien prepara la unidad quiere saber
     * de una vez todo lo que le falta, no descubrirlo de uno en uno.
     *
     * @return list<string>
     */
    public static function reasons(UnitFacts $facts, ?CarbonImmutable $at = null): array
    {
        $hoy = ($at ?? CarbonImmutable::now())->startOfDay();
        $motivos = [];

        if ($facts->status === 'out_of_service') {
            $motivos[] = self::FUERA_DE_SERVICIO;
        }

        if ($facts->status === 'archived') {
            $motivos[] = self::ARCHIVADA;
        }

        if ($facts->status === 'pending_verification') {
            $motivos[] = self::SIN_VERIFICAR;
        }

        if ($facts->nextInspectionDueAt !== null && $facts->nextInspectionDueAt->startOfDay()->lt($hoy)) {
            $motivos[] = self::INSPECCION_VENCIDA;
        }

        if ($facts->registrationExpiresAt !== null && $facts->registrationExpiresAt->startOfDay()->lt($hoy)) {
            $motivos[] = self::MATRICULA_VENCIDA;
        }

        return $motivos;
    }

    /** ¿Puede ir a una carga? */
    public static function allows(UnitFacts $facts, ?CarbonImmutable $at = null): bool
    {
        return self::reasons($facts, $at) === [];
    }
}
