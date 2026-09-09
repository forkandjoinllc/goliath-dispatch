<?php

declare(strict_types=1);

namespace App\Support\Documents;

use InvalidArgumentException;

/**
 * Qué documentos existen, de quién son, cuáles son obligatorios y quién los crea.
 *
 * La lista de tipos la impone el esquema con un CHECK; lo que esta clase añade
 * es **cuáles hacen falta para poder trabajar**, que el esquema no dice y es la
 * pregunta que de verdad se hace todos los días.
 *
 * ## El catálogo decía que el esquema mandaba y no le hacía caso
 *
 * El CHECK acepta VEINTISIETE tipos. Este catálogo tenía VEINTIDÓS, y los cinco
 * que faltaban no eran tipos muertos: cuatro los escribe la propia aplicación
 * —`rate_confirmation` desde `Loads\RateConfirmation`, y `permit`,
 * `route_survey` y `escort_document` desde `Oversize\Papers`—. Como no estaban
 * aquí, tampoco tenían rótulo, y `t()` devuelve la clave cuando no la encuentra:
 * la pantalla de documentos enseñaba literalmente
 *
 *     documents.types.rate_confirmation
 *
 * en la columna del tipo, en el <h1> de la ficha y en el título de la pestaña
 * del navegador, en los dos idiomas. Ocho filas de la base de datos de
 * demostración, y las cuatro restantes en cuanto alguien cuelga el papel de un
 * permiso.
 *
 * ## Por qué hacía falta un tercer eje y no solo cinco entradas
 *
 * Porque `forOwner()` contesta a la pregunta «¿qué puede ELEGIR una persona en
 * el formulario?» —alimenta el `Rule::in` de LoadDocumentController y los
 * desplegables de subida— y a la vez se usaba como si contestara a «¿qué tipos
 * existen?». No son la misma pregunta, y confundirlas es lo que produjo una
 * pantalla incapaz de nombrar sus propias filas.
 *
 * Añadir los cinco sin más habría abierto una puerta de verdad: un despachador
 * podría subir a mano un fichero declarándolo `rate_confirmation`, y
 * `RateConfirmation::estado()` busca exactamente por ese tipo para decidir si el
 * transportista aceptó la tarifa. Un fichero cualquiera pasaría por la
 * confirmación firmada.
 *
 * Por eso cada entrada dice ADEMÁS quién puede crearla:
 *
 *  - `PERSONA` — sale en los formularios de subida.
 *  - `SISTEMA` — solo lo escribe código de la aplicación. Existe, tiene nombre,
 *    se puede leer y filtrar; no se puede elegir.
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
    /** Lo elige una persona en un formulario de subida. */
    public const PERSONA = 'person';

    /** Solo lo escribe código de la aplicación. Se lee, no se elige. */
    public const SISTEMA = 'system';

    /**
     * tipo => [dueño, obligatorio, quién lo crea]
     *
     * El orden es el del CHECK del esquema por bloques de dueño, y la lista
     * tiene que cubrirlo ENTERO: `UnnamedValuesTest` compara las dos.
     *
     * @var array<string, array{0: string, 1: bool, 2: string}>
     */
    private const CATALOG = [
        // Transportista
        'certificate_of_insurance' => ['carrier', true, self::PERSONA],
        'certificate_of_authority' => ['carrier', true, self::PERSONA],
        'carrier_agreement' => ['carrier', true, self::PERSONA],
        'w9' => ['carrier', false, self::PERSONA],
        'notice_of_assignment' => ['carrier', false, self::PERSONA],
        'change_of_payee' => ['carrier', false, self::PERSONA],
        'other_onboarding' => ['carrier', false, self::PERSONA],

        // Conductor
        'cdl_front' => ['driver', true, self::PERSONA],
        'cdl_back' => ['driver', false, self::PERSONA],
        'medical_card' => ['driver', true, self::PERSONA],
        'driver_other' => ['driver', false, self::PERSONA],

        // Equipo
        'truck_registration' => ['truck', true, self::PERSONA],
        'trailer_registration' => ['trailer', true, self::PERSONA],
        'annual_inspection' => ['truck', true, self::PERSONA],
        'equipment_photo' => ['truck', false, self::PERSONA],
        'equipment_video' => ['truck', false, self::PERSONA],

        // Carga
        //
        // Ninguno es OBLIGATORIO, y no por descuido. `requiredFor()` alimenta la
        // puerta de cumplimiento del transportista —«¿qué le falta para poder
        // llevar carga?»—, y un comprobante de entrega no puede existir antes de
        // la entrega. Declararlo obligatorio bloquearía a todo transportista
        // recién dado de alta por no tener el papel de un viaje que aún no ha
        // hecho. Lo que exige el comprobante es la PUERTA DE `pod_received`, que
        // vive en Guards y mira esta carga, no este transportista.
        'bol' => ['load', false, self::PERSONA],
        'pod' => ['load', false, self::PERSONA],
        'receipt' => ['load', false, self::PERSONA],
        'lumper_receipt' => ['load', false, self::PERSONA],
        'scale_ticket' => ['load', false, self::PERSONA],

        // Genéricos
        'other' => ['carrier', false, self::PERSONA],

        // Los que escribe la APLICACIÓN, no una persona
        //
        // Los cinco estaban en el CHECK del esquema y en App\Enums\DocumentType
        // desde el primer día, y aquí no. Ninguno se elige en un formulario, y
        // por eso ninguno es PERSONA: si lo fueran, la pantalla de papeles de
        // una carga los ofrecería en su desplegable y alguien podría subir a
        // mano un fichero llamándolo confirmación de tarifa.
        //
        // Ninguno es obligatorio: los obligatorios alimentan la puerta de
        // cumplimiento del transportista —«¿qué le falta para poder llevar
        // carga?»— y un papel que nace de un viaje concreto no puede faltarle a
        // nadie antes del viaje. Es el mismo razonamiento del bloque de carga.

        // Loads\RateConfirmation: el PDF de la tarifa que se manda al
        // transportista. Owner `load`.
        'rate_confirmation' => ['load', false, self::SISTEMA],

        // Oversize\Papers, las tres ranuras. El dueño NO es la carga: es la
        // fila del permiso o del escolta, porque el papel se cuelga de ella.
        'permit' => ['permit', false, self::SISTEMA],
        'route_survey' => ['route_survey', false, self::SISTEMA],
        'escort_document' => ['escort', false, self::SISTEMA],

        // En el esquema y en el enum, sin escritor todavía. Se queda declarado
        // porque el CHECK lo acepta: el día que algo escriba una factura como
        // documento, la pantalla ya sabe nombrarla. Un tipo que el esquema
        // admite y el catálogo ignora es exactamente el defecto que este lote
        // cierra.
        'invoice' => ['load', false, self::SISTEMA],
    ];

    public static function isKnown(string $type): bool
    {
        return isset(self::CATALOG[$type]);
    }

    /**
     * Todos los tipos que existen, los elija una persona o no.
     *
     * Es lo que hace falta para NOMBRAR una fila y para ofrecer un filtro que
     * la encuentre. `forOwner()` no sirve para eso y usarlo era el defecto.
     *
     * @return list<string>
     */
    public static function all(): array
    {
        return array_keys(self::CATALOG);
    }

    /** Quién crea este tipo: PERSONA o SISTEMA. */
    public static function origin(string $type): string
    {
        return self::CATALOG[$type][2] ?? self::SISTEMA;
    }

    /**
     * Si este tipo hace falta para poder trabajar.
     *
     * LANZA con un tipo desconocido, y antes devolvía `false` en silencio. Un
     * `?? false` aquí contesta «no hace falta» a una pregunta sobre algo que no
     * sabe qué es, y esa es la forma exacta del defecto que este lote cierra:
     * una respuesta tranquilizadora sobre un valor que no se reconoce. Después
     * de este lote el catálogo cubre el CHECK entero, así que llegar aquí con
     * un tipo desconocido significa que la base de datos ya lo habría rechazado.
     */
    public static function isRequired(string $type): bool
    {
        if (! isset(self::CATALOG[$type])) {
            throw new InvalidArgumentException("Tipo de documento fuera del catálogo: {$type}");
        }

        return self::CATALOG[$type][1];
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

        foreach (self::CATALOG as $type => [$owner, $required, $origin]) {
            // Solo PERSONA, y es la línea que impide que este lote abra una
            // puerta: este método alimenta el `Rule::in` de la subida de papeles
            // de una carga y los desplegables del formulario. Con los cinco
            // nuevos dentro, alguien podría declarar un fichero cualquiera como
            // confirmación de tarifa.
            if ($owner === $ownerType && $origin === self::PERSONA) {
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
