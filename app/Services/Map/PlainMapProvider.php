<?php

declare(strict_types=1);

namespace App\Services\Map;

/**
 * Sin teselas: los puntos sobre fondo liso.
 *
 * No es un mapa roto ni un marcador de posición. Hace de verdad lo que un mapa
 * del tablero tiene que hacer —coloca cada recogida, cada entrega y cada
 * conductor en su sitio relativo, y deja acercar y alejar—, y lo único que le
 * falta es la carretera debajo.
 *
 * Es el adaptador que corre en la demostración, en las pruebas y en cualquier
 * instalación sin cuenta de Google. Que el tablero funcione sin cuenta de nadie
 * es lo que permite probarlo.
 */
final class PlainMapProvider implements MapProvider
{
    public function name(): string
    {
        return 'none';
    }

    public function isLive(): bool
    {
        return false;
    }

    public function clientConfig(): array
    {
        return [];
    }
}
