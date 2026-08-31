<?php

declare(strict_types=1);

namespace App\Support\Documents;

/**
 * Qué documentos existen, de quién son y cuáles son obligatorios.
 *
 * La lista de tipos la impone el esquema con un CHECK; lo que esta clase añade
 * es **cuáles hacen falta para poder trabajar**, que el esquema no dice y es la
 * pregunta que de verdad se hace todos los días.
 *
 * Los tres obligatorios de un transportista no son una elección de diseño:
 *
 *  - `certificate_of_insurance` — sin seguro vigente, un siniestro lo paga la
 *    oficina de despacho. Es el documento que vence y el que nadie vigila.
 *  - `certificate_of_authority` — la autoridad operativa de la FMCSA. Sin ella
 *    el transportista no puede mover carga interestatal, legalmente.
 *  - `carrier_agreement` — el contrato firmado. Es lo que hace exigible todo
 *    lo demás, incluida la tarifa de despacho.
 *
 * Del conductor, la licencia y la tarjeta médica. Del equipo, la matrícula y la
 * inspección anual.
 *
 * De la CARGA no hay ninguno obligatorio: sus papeles —albarán, comprobante de
 * entrega, tique de báscula— nacen del viaje, no del alta. Ver el bloque de
 * carga en el catálogo.
 */
final class DocumentTypes
{
    /**
     * tipo => [dueño, obligatorio]
     *
     * @var array<string, array{0: string, 1: bool}>
     */
    private const CATALOG = [
        // Transportista
        'certificate_of_insurance' => ['carrier', true],
        'certificate_of_authority' => ['carrier', true],
        'carrier_agreement' => ['carrier', true],
        'w9' => ['carrier', false],
        'notice_of_assignment' => ['carrier', false],
        'change_of_payee' => ['carrier', false],
        'other_onboarding' => ['carrier', false],

        // Conductor
        'cdl_front' => ['driver', true],
        'cdl_back' => ['driver', false],
        'medical_card' => ['driver', true],
        'driver_other' => ['driver', false],

        // Equipo
        'truck_registration' => ['truck', true],
        'trailer_registration' => ['trailer', true],
        'annual_inspection' => ['truck', true],
        'equipment_photo' => ['truck', false],
        'equipment_video' => ['truck', false],

        // Carga
        //
        // Ninguno es OBLIGATORIO, y no por descuido. `requiredFor()` alimenta la
        // puerta de cumplimiento del transportista —«¿qué le falta para poder
        // llevar carga?»—, y un comprobante de entrega no puede existir antes de
        // la entrega. Declararlo obligatorio bloquearía a todo transportista
        // recién dado de alta por no tener el papel de un viaje que aún no ha
        // hecho. Lo que exige el comprobante es la PUERTA DE `pod_received`, que
        // vive en Guards y mira esta carga, no este transportista.
        'bol' => ['load', false],
        'pod' => ['load', false],
        'receipt' => ['load', false],
        'lumper_receipt' => ['load', false],
        'scale_ticket' => ['load', false],

        // Genéricos
        'other' => ['carrier', false],
    ];

    public static function isKnown(string $type): bool
    {
        return isset(self::CATALOG[$type]);
    }

    public static function isRequired(string $type): bool
    {
        return self::CATALOG[$type][1] ?? false;
    }

    /**
     * Los tipos que puede tener un dueño de esta clase.
     *
     * `annual_inspection` está declarada para camión pero vale para remolque:
     * los dos se inspeccionan. Se resuelve aquí en vez de duplicar la entrada.
     *
     * @return list<string>
     */
    public static function forOwner(string $ownerType): array
    {
        $types = [];

        foreach (self::CATALOG as $type => [$owner, $required]) {
            if ($owner === $ownerType) {
                $types[] = $type;
            }
        }

        if ($ownerType === 'trailer') {
            $types[] = 'annual_inspection';
            $types[] = 'equipment_photo';
        }

        return array_values(array_unique($types));
    }

    /**
     * Los tipos OBLIGATORIOS de un dueño de esta clase.
     *
     * Es lo que consulta la puerta de despacho para saber qué falta. Antes solo
     * miraba si algún documento estaba vencido, lo que dejaba pasar a un
     * transportista sin ningún documento — y eso es lo contrario de un control.
     *
     * @return list<string>
     */
    public static function requiredFor(string $ownerType): array
    {
        return array_values(array_filter(
            self::forOwner($ownerType),
            static fn (string $type): bool => self::isRequired($type),
        ));
    }
}
