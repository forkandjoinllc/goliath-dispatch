<?php

declare(strict_types=1);

namespace App\Support\Oversize;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Compara las medidas de una carga con los límites de cada estado del recorrido.
 *
 * ESTO ORIENTA. NO DETERMINA. Lo dice el esquema en el comentario de
 * `oversize_rules` —«these drive guidance, never a legal determination»— y lo
 * dice esta clase en todo lo que escribe: las columnas se llaman
 * `permit_likely_required` y `escort_likely_required`, con «likely» dentro del
 * nombre, y `human_validation_status` empieza en `pending` porque el esquema
 * exige que una persona firme antes de despachar.
 *
 * La razón no es prudencia legal genérica: es que este cálculo NO PUEDE ser
 * suficiente. Le faltan los estados de paso cuando no hay proveedor de rutas,
 * le faltan las restricciones horarias y de fin de semana, le faltan los
 * puentes y las obras, y le falta que cada estado publica excepciones que no
 * caben en cinco números. Un programa que dijera «no hace falta permiso» con
 * esa información sería peor que no decir nada.
 *
 * TRES DECISIONES QUE SOSTIENEN LA CLASE:
 *
 *  - **Las entradas se congelan.** `inputs` guarda las medidas tal como estaban
 *    al evaluar. Si mañana alguien corrige el ancho, la evaluación vieja sigue
 *    diciendo sobre qué medidas se hizo — que es lo que permite entender por
 *    qué se firmó lo que se firmó.
 *  - **Faltar un dato NO es estar dentro de límite.** Una carga sin ancho
 *    escrito no es una carga de 102 pulgadas: es una carga que no se sabe.
 *    Sale `insufficient_data` y un aviso por cada medida que falta.
 *  - **Un estado sin reglas sembradas se avisa, no se supone.** Si el recorrido
 *    cruza un estado que la empresa no tiene en su tabla, eso es un hueco y se
 *    dice.
 */
final class Evaluator
{
    public const LIMPIO = 'clear';
    public const SOBREDIMENSIONADA = 'oversize';
    public const SOBREPESO = 'overweight';
    public const AMBAS = 'oversize_overweight';
    public const DATOS_INSUFICIENTES = 'insufficient_data';

    public const PENDIENTE = 'pending';
    public const VALIDADA = 'validated';
    public const RECHAZADA = 'rejected';

    /**
     * Claves de aviso. Se traducen en la pantalla, no aquí.
     *
     * Son las del diccionario PORTADO `oversize.json`, que ya traía un texto
     * para cada una en los dos idiomas. Inventarme claves nuevas habría dejado
     * las suyas sin usar y el aviso sin traducir.
     */
    public const FALTA_ANCHO = 'missingWidth';
    public const FALTA_ALTURA = 'missingHeight';
    public const FALTA_LARGO = 'missingLength';
    public const FALTA_PESO = 'missingGrossWeight';
    public const FALTA_EJE = 'missingAxleWeight';
    public const SIN_RUTA = 'noRoute';
    public const SIN_ESTADOS = 'noRouteStates';
    public const ESTADO_SIN_REGLAS = 'stateWithoutRules';

    /**
     * Evalúa una carga y escribe la fila.
     *
     * @param  array<string, object>  $reglas  por código de estado
     * @param  list<string>  $estados  del recorrido, en orden
     * @param  list<string>  $avisosDeRuta
     */
    public static function evaluate(
        object $carga,
        array $reglas,
        array $estados,
        array $avisosDeRuta,
        ?string $routeId,
        ?int $axleWeightPounds = null,
    ): string {
        $entradas = [
            'widthInches' => self::entero($carga->width_inches ?? null),
            'heightInches' => self::entero($carga->height_inches ?? null),
            'lengthInches' => self::entero($carga->length_inches ?? null),
            'grossWeightPounds' => self::entero($carga->gross_vehicle_weight_pounds ?? null),
            'weightPounds' => self::entero($carga->weight_pounds ?? null),
            'axleConfiguration' => $carga->axle_configuration ?? null,
            // El peso del eje más pesado NO se guarda en la carga y se teclea
            // en cada evaluación. Es del diccionario portado —«no se almacena
            // en la carga»— y tiene sentido: depende de cómo se cargue el
            // remolque ese día, no de la mercancía.
            'axleWeightPounds' => $axleWeightPounds,
        ];

        $avisos = $avisosDeRuta;

        // El peso que se compara: el bruto vehicular si está, y si no el de la
        // carga. NO son lo mismo —el bruto incluye tractor y remolque— y por eso
        // se avisa cuando se cae al segundo: comparar el peso de la mercancía
        // contra un límite de peso bruto da tranquilidad falsa.
        $pesoParaComparar = $entradas['grossWeightPounds'] ?? $entradas['weightPounds'];

        if ($entradas['widthInches'] === null) {
            $avisos[] = self::FALTA_ANCHO;
        }
        if ($entradas['heightInches'] === null) {
            $avisos[] = self::FALTA_ALTURA;
        }
        if ($entradas['lengthInches'] === null) {
            $avisos[] = self::FALTA_LARGO;
        }
        if ($entradas['grossWeightPounds'] === null) {
            $avisos[] = self::FALTA_PESO;
        }
        if ($axleWeightPounds === null) {
            $avisos[] = self::FALTA_EJE;
        }
        if ($estados === []) {
            // Dos casos distintos que el diccionario portado ya distinguía: no
            // se pudo calcular ruta, o la ruta no cruza ningún estado que se
            // reconozca. Aquí solo puede darse el segundo —siempre se calcula
            // algo— pero se deja el primero para cuando entre un proveedor de
            // verdad que pueda fallar.
            $avisos[] = self::SIN_ESTADOS;
        }

        $porEstado = [];
        $sobredimensionada = false;
        $sobrepeso = false;
        $permiso = false;
        $escolta = false;
        $policia = false;

        foreach ($estados as $estado) {
            $regla = $reglas[$estado] ?? null;

            if ($regla === null) {
                $avisos[] = self::ESTADO_SIN_REGLAS.':'.$estado;

                $porEstado[] = [
                    'state' => $estado,
                    'hasRules' => false,
                    'exceeds' => [],
                    'permitLikely' => false,
                    'escortLikely' => false,
                    'policeEscortLikely' => false,
                    'lastReviewedAt' => null,
                ];

                continue;
            }

            $excede = [];

            foreach ([
                ['width', $entradas['widthInches'], (int) $regla->max_width_inches],
                ['height', $entradas['heightInches'], (int) $regla->max_height_inches],
                ['length', $entradas['lengthInches'], (int) $regla->max_length_inches],
            ] as [$que, $valor, $limite]) {
                if ($valor !== null && $valor > $limite) {
                    $excede[] = ['dimension' => $que, 'value' => $valor, 'limit' => $limite];
                    $sobredimensionada = true;
                }
            }

            if ($pesoParaComparar !== null && $pesoParaComparar > (int) $regla->max_gross_weight_pounds) {
                $excede[] = [
                    'dimension' => 'grossWeight',
                    'value' => $pesoParaComparar,
                    'limit' => (int) $regla->max_gross_weight_pounds,
                ];
                $sobrepeso = true;
            }

            if ($axleWeightPounds !== null && $axleWeightPounds > (int) $regla->max_axle_weight_pounds) {
                $excede[] = [
                    'dimension' => 'axleWeight',
                    'value' => $axleWeightPounds,
                    'limit' => (int) $regla->max_axle_weight_pounds,
                ];
                $sobrepeso = true;
            }

            $permisoAqui = $excede !== [] && (bool) $regla->permit_required_above_legal;

            $escoltaAqui = self::supera($entradas['widthInches'], $regla->escort_width_threshold_inches)
                || self::supera($entradas['heightInches'], $regla->escort_height_threshold_inches)
                || self::supera($entradas['lengthInches'], $regla->escort_length_threshold_inches);

            $policiaAqui = self::supera($entradas['widthInches'], $regla->police_escort_width_threshold_inches);

            $permiso = $permiso || $permisoAqui;
            $escolta = $escolta || $escoltaAqui;
            $policia = $policia || $policiaAqui;

            $porEstado[] = [
                'state' => $estado,
                'hasRules' => true,
                'exceeds' => $excede,
                'permitLikely' => $permisoAqui,
                'escortLikely' => $escoltaAqui,
                'policeEscortLikely' => $policiaAqui,
                'lastReviewedAt' => $regla->last_reviewed_at === null
                    ? null
                    : substr((string) $regla->last_reviewed_at, 0, 10),
            ];
        }

        $resultado = self::outcome($sobredimensionada, $sobrepeso, $entradas, $estados);

        $id = (string) Str::uuid();
        $ahora = CarbonImmutable::now();

        DB::table('oversize_evaluations')->insert([
            'id' => $id,
            'tenant_id' => (string) $carga->tenant_id,
            'load_id' => (string) $carga->id,
            'route_id' => $routeId,
            'outcome' => $resultado,
            'permit_likely_required' => $permiso ? 1 : 0,
            'escort_likely_required' => $escolta ? 1 : 0,
            'police_escort_likely_required' => $policia ? 1 : 0,
            'inputs' => json_encode($entradas, JSON_UNESCAPED_UNICODE),
            'state_results' => json_encode($porEstado, JSON_UNESCAPED_UNICODE),
            'missing_data_warnings' => json_encode(array_values(array_unique($avisos))),
            // Siempre pendiente. El esquema dice «required before dispatch» y
            // esta clase no firma por nadie.
            'human_validation_status' => self::PENDIENTE,
            'evaluated_at' => $ahora,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        // `loads.is_oversize` e `is_overweight` son las banderas que ya usaban
        // otras pantallas. Se ponen al día con lo que dice la evaluación, que es
        // quien tiene la información.
        DB::table('loads')->where('id', $carga->id)->update([
            'is_oversize' => $sobredimensionada ? 1 : 0,
            'is_overweight' => $sobrepeso ? 1 : 0,
            'updated_at' => $ahora,
        ]);

        return $id;
    }

    /** La evaluación más reciente de una carga. */
    public static function latest(string $tenantId, string $loadId): ?object
    {
        return DB::table('oversize_evaluations')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->orderByDesc('evaluated_at')
            ->first();
    }

    /** Una persona firma —o rechaza— la evaluación. */
    public static function validate(
        string $tenantId,
        string $evaluationId,
        string $status,
        ?string $notes,
        string $userId,
    ): int {
        return DB::table('oversize_evaluations')
            ->where('tenant_id', $tenantId)
            ->where('id', $evaluationId)
            ->update([
                'human_validation_status' => $status,
                'validated_by_user_id' => $userId,
                'validated_at' => CarbonImmutable::now(),
                'validation_notes' => $notes,
                'updated_at' => CarbonImmutable::now(),
            ]);
    }

    /**
     * @param  array<string, mixed>  $entradas
     * @param  list<string>  $estados
     */
    private static function outcome(bool $sobre, bool $peso, array $entradas, array $estados): string
    {
        // Sin recorrido o sin ninguna medida no hay nada que comparar, y decir
        // «limpio» sería la respuesta más cara que puede dar este programa.
        $sinMedidas = $entradas['widthInches'] === null
            && $entradas['heightInches'] === null
            && $entradas['lengthInches'] === null
            && $entradas['grossWeightPounds'] === null
            && $entradas['weightPounds'] === null;

        if ($estados === [] || $sinMedidas) {
            return self::DATOS_INSUFICIENTES;
        }

        return match (true) {
            $sobre && $peso => self::AMBAS,
            $sobre => self::SOBREDIMENSIONADA,
            $peso => self::SOBREPESO,
            default => self::LIMPIO,
        };
    }

    private static function supera(?int $valor, mixed $umbral): bool
    {
        return $valor !== null && $umbral !== null && $valor > (int) $umbral;
    }

    private static function entero(mixed $valor): ?int
    {
        return $valor === null || $valor === '' ? null : (int) $valor;
    }
}
