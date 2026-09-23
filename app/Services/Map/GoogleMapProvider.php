<?php

declare(strict_types=1);

namespace App\Services\Map;

/**
 * Google Maps, con la clave del servidor.
 *
 * Se ata solo cuando hay clave. Sin ella no se ata este adaptador siquiera:
 * un proveedor «de verdad» sin credencial pintaría un mapa con la marca de
 * agua de «solo para desarrollo» encima, que es peor que un fondo liso honesto.
 */
final class GoogleMapProvider implements MapProvider
{
    public function __construct(
        private readonly string $clave,
        private readonly ?string $mapId,
    ) {}

    public function name(): string
    {
        return 'google';
    }

    public function isLive(): bool
    {
        return $this->clave !== '';
    }

    public function clientConfig(): array
    {
        return [
            // Pública por diseño: la API corre en el navegador. Lo que la
            // protege es la restricción por dominio, y eso se hace en Google.
            'apiKey' => $this->clave,
            'mapId' => $this->mapId,
        ];
    }
}
