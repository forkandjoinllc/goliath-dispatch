<?php

declare(strict_types=1);

namespace App\Services\Fmcsa;

/**
 * La ficha de un transportista tal y como la publica FMCSA.
 *
 * Es lo que el registro federal dice, no lo que la casa de despacho cree. Por
 * eso viaja en su propio objeto y no mezclada con el formulario: cuando las dos
 * versiones no coinciden hay que poder enseñar las dos.
 *
 * Todos los campos son opcionales salvo el USDOT. FMCSA publica fichas
 * incompletas —transportistas nuevos sin calificación de seguridad, empresas sin
 * número MC porque solo operan dentro de un estado— y un objeto que exigiera
 * todo obligaría a inventar lo que falta.
 */
final readonly class FmcsaCarrier
{
    public function __construct(
        public string $dotNumber,
        public ?string $mcNumber = null,
        public ?string $legalName = null,
        public ?string $dbaName = null,
        public ?string $phone = null,
        public ?string $line1 = null,
        public ?string $city = null,
        public ?string $state = null,
        public ?string $postalCode = null,
        public ?string $country = 'US',
        public ?string $entityType = null,
        /** 'AUTHORIZED', 'NOT AUTHORIZED', 'OUT OF SERVICE'… tal cual lo publica el registro. */
        public ?string $operatingStatus = null,
        public ?bool $allowedToOperate = null,
        public ?string $safetyRating = null,
        public ?string $safetyRatingDate = null,
        public ?int $powerUnits = null,
        public ?int $driverCount = null,
        /** De dónde salió esto. Va DENTRO del dato, no en un comentario. */
        public string $source = 'unknown',
    ) {}

    /**
     * La proyección que se guarda en `fmcsa_verifications.normalized`.
     *
     * @return array<string, mixed>
     */
    public function toNormalized(): array
    {
        return [
            'dot_number' => $this->dotNumber,
            'mc_number' => $this->mcNumber,
            'legal_name' => $this->legalName,
            'dba_name' => $this->dbaName,
            'phone' => $this->phone,
            'address' => [
                'line1' => $this->line1,
                'city' => $this->city,
                'state' => $this->state,
                'postal_code' => $this->postalCode,
                'country' => $this->country,
            ],
            'entity_type' => $this->entityType,
            'operating_status' => $this->operatingStatus,
            'allowed_to_operate' => $this->allowedToOperate,
            'safety_rating' => $this->safetyRating,
            'safety_rating_date' => $this->safetyRatingDate,
            'power_units' => $this->powerUnits,
            'driver_count' => $this->driverCount,
            'source' => $this->source,
        ];
    }

    /**
     * Lo que la pantalla necesita, en las claves que usa el formulario.
     *
     * @return array<string, mixed>
     */
    public function toForm(): array
    {
        return [
            'dotNumber' => $this->dotNumber,
            'mcNumber' => $this->mcNumber,
            'legalName' => $this->legalName,
            'dba' => $this->dbaName,
            'phone' => $this->phone,
            'line1' => $this->line1,
            'city' => $this->city,
            'state' => $this->state,
            'postalCode' => $this->postalCode,
            'country' => $this->country,
            'entityType' => $this->entityType,
            'operatingStatus' => $this->operatingStatus,
            'allowedToOperate' => $this->allowedToOperate,
            'safetyRating' => $this->safetyRating,
            'safetyRatingDate' => $this->safetyRatingDate,
            'powerUnits' => $this->powerUnits,
            'driverCount' => $this->driverCount,
        ];
    }
}
