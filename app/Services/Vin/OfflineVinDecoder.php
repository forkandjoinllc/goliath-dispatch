<?php

declare(strict_types=1);

namespace App\Services\Vin;

use App\Support\Equipment\Vin;
use App\Support\Equipment\Wmi;

/**
 * Lo que el VIN dice de sí mismo, sin preguntarle a nadie.
 *
 * No es un doble de pruebas: es el adaptador que corre en cualquier
 * instalación sin salida a internet, y el que tapa los huecos cuando el
 * servicio de la NHTSA no contesta. Sabe dos de las tres cosas:
 *
 *  - el **año**, de la posición 10, que está normalizada;
 *  - la **marca**, del WMI, cuando está en la tabla corta de `Wmi`.
 *
 * El **modelo** no lo sabe ni lo puede saber: vive en las posiciones 4-8, que
 * cada fabricante define a su manera. Devolver ahí cualquier cosa sería
 * inventarse el dato, así que se deja vacío para que lo escriba la persona.
 */
final class OfflineVinDecoder implements VinDecoder
{
    public function decode(string $vin): ?DecodedVin
    {
        // El dígito de control, antes que nada. Rellenar marca y año de un
        // número mal copiado es peor que no rellenar nada: sale un vehículo
        // verosímil que no es el que la persona tiene delante.
        if (! Vin::sumaBien($vin)) {
            return null;
        }

        $resultado = new DecodedVin(
            make: Wmi::de($vin),
            model: null,
            year: Vin::ano($vin),
            sources: [DecodedVin::DEL_NUMERO],
        );

        return $resultado->isEmpty() ? null : $resultado;
    }

    public function isLive(): bool
    {
        return false;
    }

    public function name(): string
    {
        return 'offline';
    }
}
