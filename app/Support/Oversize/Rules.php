<?php

declare(strict_types=1);

namespace App\Support\Oversize;

use App\Support\Geo\Regions;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Los límites por estado de una empresa: sembrarlos, leerlos y editarlos.
 *
 * Son DATOS DE LA EMPRESA, no del programa. La tabla lleva `tenant_id` y el
 * comentario del esquema es explícito: «fully tenant-editable». Quien lleva una
 * operación de cargas sobredimensionadas sabe los números de sus corredores
 * mejor que ningún valor por defecto, y el trabajo de este módulo es darle
 * dónde escribirlos y avisarle cuando no los ha revisado.
 *
 * De ahí que `last_reviewed_at` importe tanto como los propios números: una
 * regla sembrada y nunca mirada y una regla verificada la semana pasada valen
 * lo mismo para el evaluador y NO valen lo mismo para quien decide. La pantalla
 * las distingue.
 */
final class Rules
{
    /**
     * Siembra la línea de base federal para todos los estados que falten.
     *
     * Idempotente: no toca un estado que ya exista, ni siquiera para
     * actualizarlo. Si alguien revisó Texas, no se le pisa.
     *
     * @return int Cuántos estados se crearon.
     */
    public static function install(string $tenantId, string $locale = 'es'): int
    {
        $existentes = DB::table('oversize_rules')
            ->where('tenant_id', $tenantId)
            ->pluck('state_code')
            ->all();

        $ahora = CarbonImmutable::now();
        $creados = 0;
        $filas = [];

        foreach (Regions::subdivisionCodes('US') as $estado) {
            if (in_array($estado, $existentes, true)) {
                continue;
            }

            $filas[] = [
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'state_code' => $estado,
                'max_width_inches' => DefaultRules::ANCHO,
                'max_height_inches' => DefaultRules::ALTURA,
                'max_length_inches' => DefaultRules::LARGO,
                'max_gross_weight_pounds' => DefaultRules::PESO_BRUTO,
                'max_axle_weight_pounds' => DefaultRules::PESO_EJE,
                'escort_width_threshold_inches' => DefaultRules::ESCOLTA_ANCHO,
                'escort_height_threshold_inches' => DefaultRules::ESCOLTA_ALTURA,
                'escort_length_threshold_inches' => DefaultRules::ESCOLTA_LARGO,
                'police_escort_width_threshold_inches' => DefaultRules::ESCOLTA_POLICIA_ANCHO,
                'travel_restrictions' => json_encode([]),
                'permit_required_above_legal' => 1,
                'source_note' => $locale === 'es' ? DefaultRules::NOTA_ES : DefaultRules::NOTA_EN,
                // NULL a propósito: nadie lo ha revisado. Ponerle la fecha de
                // hoy diría que alguien miró estos números, y no ha mirado
                // nadie. Es la columna que separa un valor sembrado de un valor
                // verificado, y mentir en ella vacía de sentido la pantalla.
                'last_reviewed_at' => null,
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ];

            $creados++;
        }

        foreach (array_chunk($filas, 50) as $lote) {
            DB::table('oversize_rules')->insert($lote);
        }

        return $creados;
    }

    /**
     * Las reglas de una empresa, por código de estado.
     *
     * @return array<string, object>
     */
    public static function forTenant(string $tenantId): array
    {
        return DB::table('oversize_rules')
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at')
            ->get()
            ->keyBy(static fn (object $r): string => (string) $r->state_code)
            ->all();
    }

    /** Actualiza los límites de un estado y marca que alguien los revisó. */
    public static function update(string $tenantId, string $stateCode, array $valores, ?string $nota): int
    {
        return DB::table('oversize_rules')
            ->where('tenant_id', $tenantId)
            ->where('state_code', $stateCode)
            ->whereNull('deleted_at')
            ->update(array_merge($valores, [
                'source_note' => $nota,
                // Editar ES revisar: quien cambia un número lo ha mirado.
                'last_reviewed_at' => CarbonImmutable::now(),
                'updated_at' => CarbonImmutable::now(),
            ]));
    }
}
