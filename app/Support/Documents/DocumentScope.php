<?php

declare(strict_types=1);

namespace App\Support\Documents;

use App\Authorization\Actor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Models\Document;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Estrecha una consulta de documentos al ámbito concedido.
 *
 * Es el cuarto puente de este tipo que hago —después de las cargas de un
 * conductor, sus fichas y sus equipos— y esta vez lo escribí ANTES que la
 * pantalla, no después de descubrir que estaba vacía.
 *
 * El problema aquí es peor que en los anteriores. Un documento no apunta a un
 * transportista: apunta a un DUEÑO POLIMÓRFICO —`owner_type` + `owner_id`— que
 * puede ser un transportista, un conductor, un camión, un remolque o una carga.
 * Así que «los documentos de mi transportista» no es un WHERE ni un EXISTS: es
 * la unión de cinco preguntas distintas, una por cada tipo de dueño.
 *
 * Escribirlo mal tiene dos formas de fallar y las dos son malas: de menos, y el
 * transportista no ve el certificado de seguro que él mismo subió; de más, y ve
 * los de otro transportista.
 */
final class DocumentScope
{
    /**
     * @param  Builder<Document>  $query
     * @return Builder<Document>
     */
    public static function apply(
        Builder $query,
        PermissionChecker $checker,
        Actor $actor,
        Scope $scope,
    ): Builder {
        if ($scope === Scope::Platform) {
            return $query;
        }

        $query->where('documents.tenant_id', $actor->tenantId);

        return match ($scope) {
            Scope::Tenant => $query,

            // Un transportista ve lo suyo, lo de sus conductores y lo de sus
            // equipos. Sus CARGAS no: los documentos de una carga
            // —comprobantes de entrega, confirmaciones de tarifa— se ven desde
            // la carga, con el permiso de la carga.
            Scope::Carrier => self::forCarriers($query, array_filter([$actor->carrierId])),

            Scope::Assigned => self::forCarriers($query, $actor->assignments->carrierIds),

            // Un conductor ve SUS documentos: su licencia, su tarjeta médica.
            // No los de su transportista — el certificado de seguro de la
            // empresa no es asunto suyo.
            Scope::Own => $actor->driverId === null
                ? $query->whereRaw('1 = 0')
                : $query->where('owner_type', 'driver')->where('owner_id', $actor->driverId),
        };
    }

    /**
     * Los documentos cuyo dueño pertenece a alguno de estos transportistas.
     *
     * @param  Builder<Document>  $query
     * @param  list<string>  $carrierIds
     * @return Builder<Document>
     */
    private static function forCarriers(Builder $query, array $carrierIds): Builder
    {
        if ($carrierIds === []) {
            // Sin transportistas no hay nada que demostrar. Cero filas, no todas.
            return $query->whereRaw('1 = 0');
        }

        return $query->where(function (Builder $q) use ($carrierIds): void {
            // El transportista mismo.
            $q->where(function (Builder $inner) use ($carrierIds): void {
                $inner->where('owner_type', 'carrier')->whereIn('owner_id', $carrierIds);
            });

            // Sus conductores, por la tabla puente.
            $q->orWhere(function (Builder $inner) use ($carrierIds): void {
                $inner->where('owner_type', 'driver')
                    ->whereIn('owner_id', function ($sub) use ($carrierIds): void {
                        $sub->select('driver_id')
                            ->from('driver_carrier_relationships')
                            ->whereIn('carrier_id', $carrierIds)
                            ->whereNull('deleted_at');
                    });
            });

            // Sus camiones y sus remolques, que sí llevan carrier_id.
            foreach ([['truck', 'trucks'], ['trailer', 'trailers']] as [$type, $table]) {
                $q->orWhere(function (Builder $inner) use ($type, $table, $carrierIds): void {
                    $inner->where('owner_type', $type)
                        ->whereIn('owner_id', function ($sub) use ($table, $carrierIds): void {
                            $sub->select('id')->from($table)
                                ->whereIn('carrier_id', $carrierIds)
                                ->whereNull('deleted_at');
                        });
                });
            }
        });
    }

    /**
     * ¿Puede este actor tocar un documento de este dueño?
     *
     * La comprobación de SUBIDA, que va al revés que la de lectura: al leer se
     * estrecha una consulta, al subir hay que decidir sobre un dueño concreto
     * que llega en la petición. Sin esto, cualquiera con `document:upload`
     * podría colgarle un documento al transportista de otro.
     */
    public static function ownsTarget(Actor $actor, Scope $scope, string $ownerType, string $ownerId): bool
    {
        if (in_array($scope, [Scope::Platform, Scope::Tenant], true)) {
            return true;
        }

        if ($scope === Scope::Own) {
            return $ownerType === 'driver' && $ownerId === $actor->driverId;
        }

        $carrierIds = $scope === Scope::Carrier
            ? array_filter([$actor->carrierId])
            : $actor->assignments->carrierIds;

        if ($carrierIds === []) {
            return false;
        }

        return match ($ownerType) {
            'carrier' => in_array($ownerId, $carrierIds, true),
            'driver' => DB::table('driver_carrier_relationships')
                ->where('driver_id', $ownerId)
                ->whereIn('carrier_id', $carrierIds)
                ->whereNull('deleted_at')
                ->exists(),
            'truck', 'trailer' => DB::table($ownerType === 'truck' ? 'trucks' : 'trailers')
                ->where('id', $ownerId)
                ->whereIn('carrier_id', $carrierIds)
                ->whereNull('deleted_at')
                ->exists(),

            // Una carga, por el transportista que la lleva. Aquí sí, y no en
            // `apply()` de más arriba: LEER la lista de documentos de un
            // transportista no incluye los de sus cargas —eso se ve desde la
            // carga—, pero SUBIR el comprobante de una carga suya tiene que
            // poder hacerlo. Son dos preguntas distintas sobre el mismo tipo de
            // dueño, y contestarlas igual romperia una de las dos.
            'load' => DB::table('loads')
                ->where('id', $ownerId)
                ->whereIn('carrier_id', $carrierIds)
                ->whereNull('deleted_at')
                ->exists(),

            default => false,
        };
    }
}
