<?php

declare(strict_types=1);

namespace App\Support\Fmcsa;

use App\Enums\VerificationStatus;
use App\Services\Fmcsa\FmcsaDirectory;
use App\Services\Fmcsa\FmcsaResult;
use App\Services\Fmcsa\FmcsaVerifier;
use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Volver a comprobar la autoridad de un transportista ante FMCSA.
 *
 * ## El defecto
 *
 * La página de transportistas del sitio público dice:
 *
 * > «Su autoridad ante la FMCSA se verifica con el DOT/MC que proporcione y **se
 * > revalida automáticamente cada 7 días** mientras esté activo, no solo una vez
 * > al registrarse.»
 *
 * Y la portada remata: «se verifican automáticamente antes de asignar una carga
 * — no se detectan después».
 *
 * No se revalidaba nada. El barrido de avisos AVISABA a una persona de que
 * tocaba revalidar y ahí se acababa: si nadie entraba a pulsar el botón, la foto
 * del registro se quedaba con meses de antigüedad y la carga salía igual. Un
 * aviso mensual que nadie atiende no es una revalidación automática; es una
 * bandeja de entrada más llena.
 *
 * ## Sin credenciales NO se inventa una comprobación
 *
 * Si el proveedor no está en vivo, esto no escribe nada y lo dice. La alternativa
 * —anotar una verificación «simulada» con fecha de hoy— sería peor que no
 * revalidar: dejaría a todos los transportistas con la marca al día y a nadie
 * comprobado, y el aviso que hoy sí funciona dejaría de saltar. Falsear la fecha
 * de una comprobación de autoridad es de las peores mentiras que este sistema
 * podría contarse a sí mismo.
 *
 * Es la misma decisión que ya tomaba `recordFmcsaSnapshot` al dar de alta, y
 * ahora las dos viven aquí en vez de estar copiadas.
 *
 * ## El plazo es UNO
 *
 * `carriers.fmcsa_next_verification_at` se escribía a «dentro de un año» y la
 * pantalla lo enseñaba, mientras el barrido usaba
 * `tenant_settings.fmcsa_reverification_days` —siete por omisión— para decidir
 * quién estaba caducado. Dos números que se contradecían, los dos a la vista.
 * Ahora la fecha siguiente sale del plazo de la empresa, así que la pantalla y
 * el barrido dicen lo mismo.
 */
final class Revalidation
{
    /**
     * Los transportistas de esta empresa sin comprobación dentro del plazo.
     *
     * Incluye a los que no se han comprobado nunca: no tener verificación es
     * peor que tenerla vieja.
     *
     * @return \Illuminate\Support\Collection<int, object>
     */
    public static function due(string $tenantId, int $limite = 500)
    {
        $corte = CarbonImmutable::now()->subDays(TenantPolicy::for($tenantId)->fmcsaReverificationDays);

        return DB::table('carriers as c')
            ->where('c.tenant_id', $tenantId)
            ->whereNull('c.deleted_at')
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('fmcsa_verifications as v')
                ->whereColumn('v.carrier_id', 'c.id')
                ->where('v.tenant_id', $tenantId)
                ->where('v.checked_at', '>=', $corte))
            ->orderBy('c.legal_name')
            ->limit($limite)
            ->get(['c.id', 'c.tenant_id', 'c.legal_name', 'c.dot_number', 'c.mc_number']);
    }

    /**
     * Revalida a todos los que toque.
     *
     * @return array{checked: int, live: bool}
     */
    public static function sweep(string $tenantId, FmcsaVerifier $verifier, FmcsaDirectory $directory): array
    {
        if (! $directory->isLive()) {
            return ['checked' => 0, 'live' => false];
        }

        $hechos = 0;

        foreach (self::due($tenantId) as $transportista) {
            self::runFor($transportista, $verifier);
            $hechos++;
        }

        return ['checked' => $hechos, 'live' => true];
    }

    /**
     * Comprueba UNO y guarda el resultado.
     *
     * El objeto solo necesita `id`, `tenant_id`, `dot_number`, `mc_number` y
     * `legal_name`, así que sirve tanto un modelo como una fila cruda — que es
     * justo lo que hace falta para que el alta y el barrido compartan esto.
     */
    public static function runFor(object $carrier, FmcsaVerifier $verifier): FmcsaResult
    {
        $resultado = $verifier->verify(
            (string) $carrier->dot_number,
            $carrier->mc_number === null ? null : (string) $carrier->mc_number,
            (string) $carrier->legal_name,
        );

        self::record($carrier, $verifier->name(), $resultado);

        return $resultado;
    }

    /** Escribe la comprobación y pone al día al transportista. */
    public static function record(object $carrier, string $provider, FmcsaResult $resultado): void
    {
        $ahora = CarbonImmutable::now();
        $tenantId = (string) $carrier->tenant_id;

        // El número de intento: la columna existe para poder contar cuántas
        // veces se ha mirado a este transportista, y hasta ahora todas las filas
        // decían «1».
        $intento = 1 + (int) DB::table('fmcsa_verifications')
            ->where('carrier_id', $carrier->id)
            ->count();

        DB::table('fmcsa_verifications')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'carrier_id' => $carrier->id,
            'provider' => $provider,
            'dot_number' => $carrier->dot_number,
            'mc_number' => $carrier->mc_number,
            'status' => $resultado->status->value,
            'normalized' => json_encode($resultado->normalized),
            // Solo el digest, nunca el cuerpo entero: la respuesta cruda trae
            // direcciones y nombres, y esta tabla se conserva años.
            'raw_payload_digest' => $resultado->rawDigest,
            'attempt' => $intento,
            'error_message' => $resultado->errorMessage,
            'checked_at' => $ahora,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        DB::table('carriers')->where('id', $carrier->id)->update([
            'fmcsa_status' => $resultado->status->value,
            'fmcsa_last_verified_at' => $ahora,
            'fmcsa_next_verification_at' => $resultado->status === VerificationStatus::Verified
                ? $ahora->addDays(self::plazo($tenantId))
                : null,
            'updated_at' => $ahora,
        ]);
    }

    /** El plazo de revalidación de la empresa, que es el que usa el barrido. */
    public static function plazo(string $tenantId): int
    {
        return app(TenantContext::class)->withoutTenant(
            fn (): int => TenantPolicy::for($tenantId)->fmcsaReverificationDays,
        );
    }
}
