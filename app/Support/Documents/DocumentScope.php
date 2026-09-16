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
     * Los tipos de dueño que este alcance puede LLEGAR A VER.
     *
     * ## El defecto
     *
     * El filtro de dueño de la pantalla de documentos ofrecía los nueve del
     * catálogo, a todo el mundo. Y `apply()` de aquí arriba recorta:
     *
     *  - con alcance PROPIO fuerza `owner_type = 'driver'`, así que **ocho de
     *    las nueve** opciones devuelven cero filas siempre, para cualquier
     *    conductor, en cualquier empresa;
     *  - con alcance de transportista o asignado, `forCarriers()` solo emite
     *    cuatro ramas, así que **cinco de nueve** son estructuralmente vacías —
     *    incluidas «carga» y «gasto», que son las de más volumen.
     *
     * La lista se vaciaba en silencio: ninguna señal de que esa opción no podía
     * casar con nada.
     *
     * `App\Support\Lists\FacetCounts` ya dice la regla para los atajos de esas
     * mismas pantallas: «el número de un atajo tiene que ser el número que sale
     * al pulsarlo». Un desplegable sin número es el caso en el que la promesa se
     * hace sin decir nada, y por eso se le escapó.
     *
     * ## Por qué aquí
     *
     * Porque es `apply()` leído al revés, igual que `carrierOf()` es
     * `forCarriers()` leído al revés. Las dos direcciones tienen que decir lo
     * mismo, y hay un guardián que las compara — el mismo que faltaba para
     * `carrierOf()` hasta el lote del aviso de vencimiento.
     *
     * @return list<string>
     */
    public static function ownerTypesFor(Scope $scope): array
    {
        return match ($scope) {
            Scope::Platform, Scope::Tenant => DocumentOwners::all(),

            // Las cuatro ramas de `forCarriers()`, en el mismo orden.
            Scope::Carrier, Scope::Assigned => ['carrier', 'driver', 'truck', 'trailer'],

            // La única rama de `Scope::Own`.
            Scope::Own => ['driver'],
        };
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

    /**
     * De qué transportista es este documento, si es de alguno.
     *
     * Es `forCarriers()` LEÍDO AL REVÉS: allí se pregunta «qué documentos son
     * de estos transportistas» y aquí «de qué transportista es este
     * documento». Las cuatro reglas tienen que ser las mismas cuatro —el
     * transportista mismo, sus conductores por la tabla puente, y sus camiones
     * y remolques por su `carrier_id`—, y hay un guardián que compara las dos
     * direcciones porque una tabla que se lee en dos sentidos se desincroniza
     * sin que nadie lo note.
     *
     * Devuelve null cuando el documento no cuelga de ningún transportista: una
     * carga, por ejemplo. Eso NO es un error — es que no hay a quién avisar.
     *
     * Acepta cualquier objeto con `owner_type` y `owner_id`, no solo el modelo:
     * el barrido nocturno recorre `DB::table('documents')` y montar un modelo
     * por fila para preguntar dos columnas sería pagar un hidratado por
     * documento y por noche. Es la misma firma que usa `CommissionOwner`.
     */
    public static function carrierOf(object $documento): ?string
    {
        $tipo = (string) $documento->owner_type;
        $id = (string) $documento->owner_id;

        if ($id === '') {
            return null;
        }

        if ($tipo === 'carrier') {
            return $id;
        }

        if ($tipo === 'driver') {
            $valor = DB::table('driver_carrier_relationships')
                ->where('driver_id', $id)
                ->whereNull('deleted_at')
                ->value('carrier_id');

            return $valor === null ? null : (string) $valor;
        }

        if ($tipo === 'truck' || $tipo === 'trailer') {
            $valor = DB::table($tipo === 'truck' ? 'trucks' : 'trailers')
                ->where('id', $id)
                ->whereNull('deleted_at')
                ->value('carrier_id');

            return $valor === null ? null : (string) $valor;
        }

        return null;
    }
}
