<?php

declare(strict_types=1);

namespace App\Services\Tracking;

use Carbon\CarbonImmutable;

/**
 * Un parte de posición: lo que un proveedor de rastreo dice que pasó.
 *
 * ## Por qué no lleva coordenadas obligatorias
 *
 * Porque en esta aplicación NO HAY NI UNA COORDENADA. `load_stops` tiene
 * `latitude` y `longitude` desde el primer día y no las escribe nadie, y
 * `StopDerivedRouteProvider` devuelve la ruta sin geometría a propósito:
 * "inventar una distancia en línea recta la haría parecer un dato".
 *
 * La consecuencia para el rastreo es directa y hay que aceptarla entera: sin
 * coordenadas de las paradas no se puede interpolar un punto entre dos paradas,
 * y un punto interpolado sería exactamente la distancia en línea recta que ese
 * otro proveedor se negó a inventar — solo que dibujada en un mapa, que es la
 * forma más convincente que tiene un dato falso de parecer verdadero.
 *
 * Así que una posición aquí es un LUGAR CON NOMBRE («Laredo, TX»), no un par de
 * números. `latitude` y `longitude` existen en el parte porque un proveedor de
 * verdad sí las manda y la tabla las espera; el adaptador deducido las deja
 * nulas siempre, y la pantalla enseña el nombre.
 *
 * ## `reference` es la clave de idempotencia
 *
 * `tracking_events` tiene `unique (provider, raw_provider_reference)`. Quien
 * construye un parte tiene que dar una referencia que identifique el SUCESO y no
 * el momento en que se leyó: dos lecturas del mismo webhook, o dos pulsaciones
 * del mismo botón, tienen que chocar contra el índice en vez de duplicar la
 * línea de tiempo del cliente.
 */
final readonly class PositionReport
{
    /**
     * @param  string  $eventType  uno de los de `chk_tracking_events_event_type`
     * @param  string|null  $locationLabel  el lugar, con nombre
     * @param  string|null  $stopId  la parada a la que se refiere, si es una
     * @param  string  $reference  identifica el suceso; es la idempotencia
     */
    public function __construct(
        public string $eventType,
        public CarbonImmutable $occurredAt,
        public string $reference,
        public ?string $locationLabel = null,
        public ?string $stopId = null,
        public ?string $latitude = null,
        public ?string $longitude = null,
        public ?int $speedMph = null,
        public ?int $headingDegrees = null,
    ) {}
}
