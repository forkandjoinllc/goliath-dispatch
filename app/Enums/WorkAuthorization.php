<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * Cómo está autorizado a trabajar un conductor, cuando alguien lo ha registrado.
 *
 * Existe porque algunas cargas lo exigen POR CONTRATO —accesos a ciertas
 * instalaciones federales, sobre todo— y el despachador necesita saber a quién
 * puede ofrecérselas sin llamar a preguntar. No existe para clasificar a nadie.
 *
 * Tres cosas que van juntas con este enum y que no se pueden separar de él:
 *
 *  • El campo es OPCIONAL. «No consta» es un estado legítimo y permanente: se
 *    puede dar de alta, verificar, asignar y pagar a un conductor sin que esto
 *    se rellene nunca.
 *  • Del lado de la CARGA, un requisito de este tipo obliga a decir de dónde
 *    sale. Un requisito de ciudadanía sin contrato detrás que lo exija es
 *    discriminación por estatus migratorio (8 U.S.C. § 1324b), no una regla de
 *    negocio. Esto no es asesoramiento legal: que lo mire un abogado.
 *  • El sistema NUNCA descarta a nadie solo. Compara y dice cumple / no cumple /
 *    no consta; asigna una persona.
 */
enum WorkAuthorization: string
{
    case UsCitizen = 'us_citizen';

    case PermanentResident = 'permanent_resident';

    /** Autorización de empleo vigente (EAD). */
    case EmploymentAuthorization = 'employment_authorization';

    case Other = 'other';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
