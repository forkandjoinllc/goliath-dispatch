<?php

declare(strict_types=1);

namespace App\Support\Equipment;

/**
 * Quién fabricó un vehículo, por las tres primeras letras de su VIN.
 *
 * ## Por qué esta tabla es CORTA a propósito
 *
 * Hay miles de WMI asignados en el mundo. Aquí están los fabricantes de camión
 * y remolque que de verdad aparecen en una flota de despacho de EE. UU., y ni
 * uno más. La razón no es la pereza: **una entrada equivocada rellena el campo
 * «Marca» con un fabricante que no es**, y ese error es peor que dejar el campo
 * en blanco, porque quien lo lee da por hecho que lo comprobó alguien.
 *
 * Lo que no está aquí no se adivina: se deja vacío para que lo escriba la
 * persona, o lo dice el decodificador vivo, que sí consulta la base oficial.
 *
 * Añadir una entrada es barato y es la forma prevista de que esto crezca. Lo
 * que no se puede es añadirla sin estar seguro.
 */
final class Wmi
{
    /**
     * WMI => fabricante.
     *
     * @var array<string, string>
     */
    public const FABRICANTES = [
        // Freightliner
        '1FU' => 'Freightliner',
        '1FV' => 'Freightliner',
        '3AK' => 'Freightliner',
        '3AL' => 'Freightliner',

        // Kenworth
        '1XK' => 'Kenworth',
        '1NK' => 'Kenworth',
        '2NK' => 'Kenworth',
        '3BK' => 'Kenworth',

        // Peterbilt
        '1XP' => 'Peterbilt',
        '1NP' => 'Peterbilt',
        '2NP' => 'Peterbilt',
        '3BP' => 'Peterbilt',

        // Volvo Trucks North America
        '4V4' => 'Volvo',
        '4V5' => 'Volvo',

        // Mack
        '1M1' => 'Mack',
        '1M2' => 'Mack',

        // International (Navistar)
        '1HT' => 'International',
        '3HA' => 'International',
        '3HS' => 'International',

        // Western Star
        '5KJ' => 'Western Star',
        '2WL' => 'Western Star',

        // Remolques
        '1UY' => 'Utility Trailer',
        '1GR' => 'Great Dane',
        '1JJ' => 'Wabash National',
        '1DW' => 'Fontaine',
    ];

    /** El fabricante de este VIN, o nulo si esta tabla no lo conoce. */
    public static function de(string $vin): ?string
    {
        $wmi = Vin::wmi($vin);

        return $wmi === null ? null : (self::FABRICANTES[$wmi] ?? null);
    }
}
