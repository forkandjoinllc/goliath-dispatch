<?php

declare(strict_types=1);

namespace App\Support\Drivers;

use App\Enums\DriverStatus;

/**
 * ¿Puede este conductor llevar una carga?
 *
 * ## Por qué esto es una clase
 *
 * Porque la respuesta estaba escrita CUATRO veces, y las cuatro decían lo
 * mismo por casualidad: `Loads\Guards`, la puerta de asignación de
 * `LoadAssignmentController`, el aviso de `LoadController` y el filtro de la
 * lista de conductores. Las cuatro comparaban contra `'inactive'` a mano.
 *
 * Mientras hubo un solo estado que bloqueaba, cuatro copias de una comparación
 * no hacían daño. Al añadir «en espera» y «dado de baja», cuatro copias son
 * cuatro sitios donde falta uno: un conductor dado de baja habría seguido
 * saliendo en el selector de asignación, y la única señal habría sido alguien
 * preguntando por qué le aparece un conductor que ya no trabaja aquí.
 *
 * ## Qué bloquea y qué no
 *
 * Bloquean los tres estados que dicen «hoy no»: inactivo, en espera y dado de
 * baja. **Fuera de servicio no bloquea**, y eso es a propósito: es el estado de
 * quien está fuera de turno, y planificar mañana la carga de quien hoy descansa
 * es lo normal. Cambiar eso sería otra decisión, tomada por otra razón.
 */
final class Employment
{
    /**
     * Los estados en los que un conductor no puede ir a una carga, cada uno con
     * la clave del aviso que lo explica.
     *
     * Un mapa y no una lista: quien bloquea tiene que poder DECIR por qué, y
     * «no está disponible» a secas manda a buscar el motivo a otra pantalla.
     *
     * @var array<string, string>
     */
    private const BLOQUEAN = [
        'inactive' => 'driverInactive',
        'on_hold' => 'driverOnHold',
        'terminated' => 'driverTerminated',
    ];

    /** Los estados que se pueden PONER a mano desde la ficha del conductor. */
    public const POR_LA_PUERTA_DE_EMPLEO = [
        DriverStatus::Available->value,
        DriverStatus::OnHold->value,
        DriverStatus::Terminated->value,
    ];

    public static function bloquea(mixed $status): bool
    {
        return array_key_exists(self::valor($status), self::BLOQUEAN);
    }

    /** La clave de `loads.assign.*` que explica el bloqueo, o nada. */
    public static function motivo(mixed $status): ?string
    {
        return self::BLOQUEAN[self::valor($status)] ?? null;
    }

    /** @return list<string> */
    public static function bloqueantes(): array
    {
        return array_keys(self::BLOQUEAN);
    }

    /** ¿Es una baja, con su decisión de recontratación detrás? */
    public static function esBaja(mixed $status): bool
    {
        return self::valor($status) === DriverStatus::Terminated->value;
    }

    private static function valor(mixed $status): string
    {
        return $status instanceof DriverStatus ? $status->value : (string) $status;
    }
}
