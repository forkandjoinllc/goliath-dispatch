<?php

declare(strict_types=1);

namespace App\Services\Map;

/**
 * Quién dibuja el mapa del tablero.
 *
 * La misma forma que `FmcsaDirectory`, `DocumentStore`, `TrackingProvider` y
 * `VinDecoder`: una interfaz, un adaptador que funciona sin credenciales y que
 * se identifica como tal, y una línea en `AppServiceProvider` que ata el de
 * verdad el día que haya cuenta.
 *
 * ## Qué devuelve, y qué NO devuelve
 *
 * Devuelve lo que la pantalla necesita para pintar teselas: el nombre del
 * proveedor y su configuración. No devuelve posiciones: las posiciones salen de
 * `tracking_events` y de las paradas, y no dependen de quién ponga el fondo.
 *
 * Esa separación es la que hace que el tablero siga sirviendo sin clave: los
 * PIN de recogida y entrega y los conductores se dibujan igual, sobre un fondo
 * liso en vez de sobre una carretera. Un tablero que no pinta nada sin cuenta
 * de Google sería un tablero que no se puede probar.
 *
 * ## La clave de Google Maps no es un secreto
 *
 * La API de mapas de Google corre EN EL NAVEGADOR y su clave viaja al
 * navegador: es pública por diseño. Lo que la protege no es esconderla —no se
 * puede— sino restringirla por dominio en la consola de Google, que es donde
 * hay que hacerlo. Por eso esta clave viaja en la carga de la página y las de
 * Stripe o el FMCSA no: no son la misma clase de cosa.
 *
 * Aun así entra por el `.env` DEL SERVIDOR y no se versiona, porque una clave
 * sin restringir sí se puede gastar.
 */
interface MapProvider
{
    /** `google` o `none`. Lo que la pantalla usa para elegir cómo pintar. */
    public function name(): string;

    /**
     * ¿Hay teselas de verdad detrás?
     *
     * Falso quiere decir que el mapa se dibuja sobre fondo liso, y la pantalla
     * tiene que decirlo en vez de dejar un rectángulo gris que parece que
     * está cargando algo.
     */
    public function isLive(): bool;

    /**
     * Lo que el navegador necesita para montar el mapa.
     *
     * @return array<string, mixed>
     */
    public function clientConfig(): array;
}
