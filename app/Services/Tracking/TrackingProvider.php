<?php

declare(strict_types=1);

namespace App\Services\Tracking;

/**
 * De dónde salen las posiciones de un camión.
 *
 * La misma forma que `FmcsaDirectory`, `DocumentStore`, `RouteProvider`,
 * `BillingProvider` e `InvoicePaymentProvider`: una interfaz, un adaptador que
 * funciona sin credenciales y que se identifica como tal, y una línea en
 * `AppServiceProvider` que ata el de verdad el día que haya cuenta.
 *
 * El esquema ya nombra a los candidatos en su restricción: `mock`,
 * `trucker_tools`, `macropoint`, `highway`, `manual`. `name()` tiene que
 * devolver uno de esos cinco o el INSERT lo rechaza la base de datos, que es
 * donde se quiere que se rechace.
 *
 * `manual` no es un proveedor con implementación: es lo que se escribe cuando
 * quien reporta la posición es una PERSONA de despacho —marcó la llegada a una
 * parada, o colgó el teléfono y anotó dónde estaba el camión—. Esos partes no
 * pasan por aquí; entran por `Ingestion::manual()`. La distinción importa
 * porque es la que separa lo que la aplicación SABE de lo que le contaron, y va
 * escrita en cada fila.
 */
interface TrackingProvider
{
    /** Uno de los cinco de `chk_tracking_events_provider`. */
    public function name(): string;

    /**
     * ¿Hay una cuenta de verdad detrás?
     *
     * Falso quiere decir que nadie va a mandar posiciones solo, y la pantalla
     * tiene que decirlo en vez de dejar una sesión abierta que parece que está
     * escuchando algo.
     */
    public function isLive(): bool;

    /**
     * Lo que el proveedor tenga desde la última vez.
     *
     * Un proveedor de verdad que empuje por webhook devuelve aquí una lista
     * vacía y entrega por su propia puerta; el que haya que consultar, consulta.
     *
     * @param  array<string, mixed>  $sesion  la fila de `tracking_sessions`
     * @return list<PositionReport>
     */
    public function poll(array $sesion): array;
}
