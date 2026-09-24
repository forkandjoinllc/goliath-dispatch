<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * Qué clase de proveedor es.
 *
 * ## Por qué esta lista y no otra
 *
 * Son los que le cobran a un transportista todos los meses. El primero es el
 * que motivó la ficha: la arrendadora del camión o del remolque, que hoy vive
 * como un nombre tecleado en `trucks.lessor_name`.
 *
 * `factoring` NO está, y es a propósito: el factoraje ya tiene su propio
 * dominio, con sus contratos, sus avisos de cesión y su pantalla. Meterlo aquí
 * daría dos sitios donde dar de alta la misma empresa, y el segundo sería el
 * que se quedaría sin los avisos.
 *
 * `other` existe para que nadie tenga que mentir al elegir. Lo que se repita
 * bajo «otro» es la señal de que falta un tipo, y entonces se añade aquí —y la
 * restricción de la base se reconstruye desde esta misma lista, así que no
 * pueden separarse—.
 */
enum VendorType: string
{
    /** Arrendadora de camiones o remolques. */
    case Leasing = 'leasing';

    /** Taller: mantenimiento y reparación. */
    case Maintenance = 'maintenance';

    /** Aseguradora o corredor de seguros. */
    case Insurance = 'insurance';

    /** Combustible: tarjetas, redes de estaciones. */
    case Fuel = 'fuel';

    /** Piezas y neumáticos. */
    case Parts = 'parts';

    /** Grúa y asistencia en carretera. */
    case Towing = 'towing';

    /** Gestoría de permisos y licencias. */
    case Permitting = 'permitting';

    /** Cualquier otro. Ver el comentario de arriba. */
    case Other = 'other';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
