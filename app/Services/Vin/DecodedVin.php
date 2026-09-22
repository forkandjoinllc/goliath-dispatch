<?php

declare(strict_types=1);

namespace App\Services\Vin;

/**
 * Lo que se sabe de un VIN, y de dónde se sabe.
 *
 * Los tres campos son opcionales por separado: el decodificador de respaldo
 * sabe el año y a veces la marca, y nunca el modelo. Un `DecodedVin` con dos
 * campos llenos y uno vacío es el caso NORMAL, no un error.
 */
final readonly class DecodedVin
{
    /** Leído del propio VIN, sin salir a ninguna parte. */
    public const DEL_NUMERO = 'vin';

    /** Contestado por la base de la NHTSA. */
    public const DE_LA_NHTSA = 'nhtsa';

    public function __construct(
        public ?string $make = null,
        public ?string $model = null,
        public ?int $year = null,
        /** @var list<string> Qué campo vino de dónde, para poder decirlo en pantalla. */
        public array $sources = [],
    ) {}

    public function isEmpty(): bool
    {
        return $this->make === null && $this->model === null && $this->year === null;
    }

    /**
     * Rellena lo que falta con otro resultado, sin pisar lo que ya hay.
     *
     * El orden importa y es el del que llama: lo que ya está puesto gana. Así
     * el vivo manda cuando contesta y el de respaldo solo tapa huecos.
     */
    public function completarCon(self $otro): self
    {
        return new self(
            make: $this->make ?? $otro->make,
            model: $this->model ?? $otro->model,
            year: $this->year ?? $otro->year,
            sources: array_values(array_unique([...$this->sources, ...$otro->sources])),
        );
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'make' => $this->make,
            'model' => $this->model,
            'year' => $this->year,
            'sources' => $this->sources,
        ];
    }
}
