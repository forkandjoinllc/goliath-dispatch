<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * A quién se llama en un transportista, y para qué.
 *
 * Una empresa de camiones no tiene «un contacto»: tiene al que firma el
 * contrato, al que contesta a las tres de la mañana cuando un camión se para en
 * la I-35, al que manda los certificados de seguro y al que reclama el pago.
 * Llamar al equivocado no es un roce, es una carga parada.
 *
 * Lista cerrada y no texto libre a propósito, por lo mismo que en factoring: en
 * cuanto se deja escribir, en la misma base conviven «dispatch», «Despacho» y
 * «OPS», y entonces el campo ya no orienta a nadie ni sirve para filtrar.
 */
enum CarrierContactPosition: string
{
    /** El dueño o socio. Quien firma. */
    case Owner = 'owner';

    /** Quien asigna camiones y conductores del lado del transportista. */
    case Dispatch = 'dispatch';

    /** Seguridad y cumplimiento: horas de servicio, inspecciones, siniestros. */
    case Safety = 'safety';

    /** Papeles: autoridad, seguros, W-9, acuerdos. */
    case Compliance = 'compliance';

    /** Facturación y cobros del transportista hacia la casa de despacho. */
    case Billing = 'billing';

    /** Quien lleva a los conductores. */
    case DriverManager = 'driver_manager';

    /** Taller y averías en ruta. */
    case Maintenance = 'maintenance';

    /** El teléfono de guardia fuera de horario. Casi nunca tiene correo. */
    case AfterHours = 'after_hours';

    case Other = 'other';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
