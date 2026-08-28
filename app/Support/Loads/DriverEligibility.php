<?php

declare(strict_types=1);

namespace App\Support\Loads;

use App\Enums\EligibilityOutcome;
use App\Enums\LoadRequirementType;
use Carbon\CarbonImmutable;

/**
 * Compara lo que una carga EXIGE con lo que del conductor SE SABE.
 *
 * Lo que esta clase hace y lo que NO hace, porque la diferencia es todo:
 *
 *  • Contesta cumple / no cumple / NO CONSTA, requisito a requisito.
 *  • No descarta a nadie. No bloquea una asignación. No esconde a un conductor
 *    de una lista. Devuelve un veredicto y lo enseña; asigna una persona, que
 *    es quien puede llamar por teléfono y enterarse de lo que falta.
 *  • Es una función pura: mismos hechos, mismo resultado, sin base de datos
 *    delante. Por eso se puede probar de verdad y no se convierte en un N+1
 *    dentro de una lista de veinte conductores.
 *
 * «No consta» existe a propósito y no se colapsa en «no cumple». Un dato que
 * nadie ha mirado se arregla mirándolo, no buscando otro conductor. Juntarlos
 * enseñaría a la gente a ignorar los avisos.
 */
final class DriverEligibility
{
    /** A partir de aquí, una revisión de récord empieza a ser vieja. */
    private const RECORD_STALE_MESES = 12;

    /**
     * @param  list<array{type: string, value: string|null, source: string|null}>  $requirements
     * @return list<array{type: string, value: string|null, outcome: string, reason: string, stale: bool, sourceMissing: bool}>
     */
    public static function evaluate(
        array $requirements,
        DriverFacts $facts,
        ?CarbonImmutable $at = null,
    ): array {
        $ahora = $at ?? CarbonImmutable::now();
        $salida = [];

        foreach ($requirements as $r) {
            $tipo = LoadRequirementType::tryFrom((string) ($r['type'] ?? ''));

            if ($tipo === null) {
                continue;
            }

            $valor = isset($r['value']) && $r['value'] !== '' ? (string) $r['value'] : null;

            [$resultado, $motivo, $stale] = match ($tipo) {
                LoadRequirementType::Twic => self::twic($facts, $ahora),
                LoadRequirementType::Endorsement => self::endorsement($facts, $valor),
                LoadRequirementType::WorkAuthorization => self::workAuthorization($facts, $valor),
                LoadRequirementType::CleanRecord => self::cleanRecord($facts, $valor, $ahora),
            };

            $salida[] = [
                'type' => $tipo->value,
                'value' => $valor,
                'outcome' => $resultado->value,
                // Clave i18n, no mensaje: la pantalla la traduce al idioma de
                // quien mira.
                'reason' => $motivo,
                'stale' => $stale,
                // Un requisito de estatus sin decir de dónde sale es un problema
                // en sí mismo, aunque el conductor lo cumpla. Ver la migración.
                'sourceMissing' => $tipo === LoadRequirementType::WorkAuthorization
                    && trim((string) ($r['source'] ?? '')) === '',
            ];
        }

        return $salida;
    }

    /**
     * Un resumen para pintar de un vistazo.
     *
     * @param  list<array{outcome: string}>  $resultados
     * @return array{meets: int, fails: int, unknown: int, verdict: string}
     */
    public static function summarize(array $resultados): array
    {
        $cuenta = ['meets' => 0, 'fails' => 0, 'unknown' => 0];

        foreach ($resultados as $r) {
            $cuenta[$r['outcome']] = ($cuenta[$r['outcome']] ?? 0) + 1;
        }

        // Un solo «no cumple» manda sobre todo lo demás; si no hay ninguno pero
        // queda algo por mirar, el veredicto es «falta mirar», no «adelante».
        $verdict = match (true) {
            $cuenta['fails'] > 0 => EligibilityOutcome::Fails->value,
            $cuenta['unknown'] > 0 => EligibilityOutcome::Unknown->value,
            default => EligibilityOutcome::Meets->value,
        };

        return [...$cuenta, 'verdict' => $verdict];
    }

    /** @return array{0: EligibilityOutcome, 1: string, 2: bool} */
    private static function twic(DriverFacts $f, CarbonImmutable $ahora): array
    {
        if (! $f->twicCard) {
            return [EligibilityOutcome::Fails, 'loads.eligibility.twicMissing', false];
        }

        if ($f->twicExpiresAt === null) {
            // Tiene tarjeta pero nadie apuntó hasta cuándo. Eso no es «cumple»:
            // una TWIC caducada no abre ninguna puerta.
            return [EligibilityOutcome::Unknown, 'loads.eligibility.twicNoExpiry', false];
        }

        if ($f->twicExpiresAt->lessThan($ahora)) {
            return [EligibilityOutcome::Fails, 'loads.eligibility.twicExpired', false];
        }

        return [EligibilityOutcome::Meets, 'loads.eligibility.twicOk', false];
    }

    /** @return array{0: EligibilityOutcome, 1: string, 2: bool} */
    private static function endorsement(DriverFacts $f, ?string $codigo): array
    {
        if ($codigo === null) {
            return [EligibilityOutcome::Unknown, 'loads.eligibility.endorsementNoValue', false];
        }

        if (in_array(strtoupper($codigo), $f->endorsements, true)) {
            return [EligibilityOutcome::Meets, 'loads.eligibility.endorsementOk', false];
        }

        // Una lista vacía en un conductor del que no consta la licencia no dice
        // «no tiene endosos»: dice que nadie ha metido la licencia todavía.
        if (! $f->licenceOnFile) {
            return [EligibilityOutcome::Unknown, 'loads.eligibility.licenceMissing', false];
        }

        return [EligibilityOutcome::Fails, 'loads.eligibility.endorsementMissing', false];
    }

    /** @return array{0: EligibilityOutcome, 1: string, 2: bool} */
    private static function workAuthorization(DriverFacts $f, ?string $exigido): array
    {
        if ($f->workAuthorization === null) {
            return [EligibilityOutcome::Unknown, 'loads.eligibility.workAuthUnknown', false];
        }

        // Sin valor concreto, el requisito es «que conste alguno».
        if ($exigido === null) {
            return [EligibilityOutcome::Meets, 'loads.eligibility.workAuthRecorded', false];
        }

        return $f->workAuthorization === $exigido
            ? [EligibilityOutcome::Meets, 'loads.eligibility.workAuthOk', false]
            : [EligibilityOutcome::Fails, 'loads.eligibility.workAuthMismatch', false];
    }

    /** @return array{0: EligibilityOutcome, 1: string, 2: bool} */
    private static function cleanRecord(DriverFacts $f, ?string $años, CarbonImmutable $ahora): array
    {
        if ($f->recordCleanYears === null) {
            return [EligibilityOutcome::Unknown, 'loads.eligibility.recordUnknown', false];
        }

        $exigidos = $años === null ? 0 : (int) $años;

        // Una revisión de hace tres años dice poco del récord de hoy. No cambia
        // el veredicto —sería inventarse un incidente que nadie ha visto— pero
        // sí se marca, para que quien mira decida si la refresca.
        $stale = $f->recordCheckedAt !== null
            && $f->recordCheckedAt->addMonths(self::RECORD_STALE_MESES)->lessThan($ahora);

        if ($f->recordCleanYears >= $exigidos) {
            return [EligibilityOutcome::Meets, 'loads.eligibility.recordOk', $stale];
        }

        return [EligibilityOutcome::Fails, 'loads.eligibility.recordShort', $stale];
    }
}
