<?php

declare(strict_types=1);

namespace App\Authorization;

use Illuminate\Database\Eloquent\Model;

/**
 * Los hechos del registro sobre el que se actúa, que permiten evaluar los
 * ámbitos estrechos.
 *
 * Todo es opcional porque no todo recurso tiene todos los hechos. Pero ojo: un
 * recurso sin ningún hecho de ámbito NO puede demostrarse dentro de `assigned` ni
 * de `own`, y la comprobación lo rechaza. Es la conducta correcta — un objeto sin
 * dueño conocido no pertenece a nadie.
 */
final readonly class ResourceContext
{
    public function __construct(
        public ?string $tenantId = null,
        public ?string $carrierId = null,
        public ?string $dispatcherUserId = null,
        public ?string $ownerUserId = null,
        public ?string $driverId = null,
        public ?string $truckId = null,
        public ?string $trailerId = null,
        public ?string $groupId = null,
    ) {}

    /**
     * Construye el contexto a partir de un modelo, leyendo solo los atributos
     * que existan. Evita repetir el mismo mapeo en cada controlador.
     */
    public static function fromModel(Model $model): self
    {
        $get = static fn (string $column): ?string => $model->getAttribute($column);

        return new self(
            tenantId: $get('tenant_id'),
            carrierId: $get('carrier_id'),
            dispatcherUserId: $get('dispatcher_user_id'),
            ownerUserId: $get('owner_user_id') ?? $get('created_by_user_id') ?? $get('user_id'),
            driverId: $get('driver_id'),
            truckId: $get('truck_id'),
            trailerId: $get('trailer_id'),
            groupId: $get('group_id'),
        );
    }

    public function hasNoScopingFacts(): bool
    {
        return $this->carrierId === null
            && $this->dispatcherUserId === null
            && $this->ownerUserId === null
            && $this->driverId === null
            && $this->truckId === null
            && $this->trailerId === null
            && $this->groupId === null;
    }
}
