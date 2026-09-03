<?php

declare(strict_types=1);

namespace App\Support\Onboarding;

use App\Enums\OnboardingStatus;

/**
 * Qué transiciones de alta son legales, y qué permiso exige cada una.
 *
 * Vive aparte del controlador porque es una regla de negocio, no de HTTP: la
 * misma tabla la necesita el trabajo que suspende automáticamente a un
 * transportista cuyo seguro venció.
 *
 * El grafo es deliberadamente estrecho. No se puede pasar de `draft` a
 * `approved` de un salto aunque el usuario tenga el permiso de aprobar: el paso
 * por `submitted` y `under_review` es lo que deja constancia de que alguien miró
 * los documentos. Un atajo aquí convertiría el alta en un campo de estado.
 */
final class Transitions
{
    /**
     * acción => [orígenes permitidos, permiso exigido]
     *
     * @var array<string, array{0: list<OnboardingStatus>, 1: string}>
     */
    private const GRAPH = [
        'submitted' => [
            [OnboardingStatus::Draft, OnboardingStatus::CorrectionsRequired],
            'carrier:onboarding:submit',
        ],
        'under_review' => [
            [OnboardingStatus::Submitted],
            'carrier:onboarding:review',
        ],
        'corrections_required' => [
            [OnboardingStatus::Submitted, OnboardingStatus::UnderReview],
            'carrier:onboarding:review',
        ],
        'approved' => [
            [OnboardingStatus::UnderReview],
            'carrier:onboarding:approve',
        ],
        'rejected' => [
            [OnboardingStatus::UnderReview],
            'carrier:onboarding:approve',
        ],
        'suspended' => [
            [OnboardingStatus::Approved],
            'carrier:onboarding:approve',
        ],
        // Reactivar tras una suspensión vuelve a REVISIÓN, no a aprobado. Lo que
        // provocó la suspensión (un seguro vencido, casi siempre) hay que volver
        // a mirarlo; devolverlo directo a aprobado saltaría esa mirada.
        'reinstate' => [
            [OnboardingStatus::Suspended],
            'carrier:onboarding:approve',
        ],
    ];

    /**
     * El grafo entero, para quien tenga que PINTARLO y no solo consultarlo.
     *
     * Lo pide el tablero de incorporación: una columna por estado y una tarjeta
     * que solo se puede soltar donde el grafo admite. Sin esto, el tablero
     * llevaría su propia copia de estas siete reglas en TypeScript —sería la
     * tercera— y el día que alguien añadiera una arista aquí, el tablero
     * seguiría ofreciendo las de antes: una pantalla que invita a un movimiento
     * que el servidor va a negar.
     *
     * @return array<string, array{from: list<string>, to: string, permission: string, reason: bool}>
     */
    public static function graph(): array
    {
        $salida = [];

        foreach (self::GRAPH as $accion => [$desde, $permiso]) {
            $salida[$accion] = [
                'from' => array_map(static fn (OnboardingStatus $s): string => $s->value, $desde),
                'to' => (string) self::target($accion)?->value,
                'permission' => $permiso,
                'reason' => self::requiresReason($accion),
            ];
        }

        return $salida;
    }

    /** El estado real al que lleva una acción (`reinstate` no es un estado). */
    public static function target(string $action): ?OnboardingStatus
    {
        if (! isset(self::GRAPH[$action])) {
            return null;
        }

        return $action === 'reinstate'
            ? OnboardingStatus::UnderReview
            : OnboardingStatus::from($action);
    }

    public static function permission(string $action): ?string
    {
        return self::GRAPH[$action][1] ?? null;
    }

    public static function allowedFrom(string $action, OnboardingStatus $current): bool
    {
        return isset(self::GRAPH[$action])
            && in_array($current, self::GRAPH[$action][0], true);
    }

    /**
     * Las acciones legales desde un estado. Sirve para pintar solo los botones
     * que hacen algo.
     *
     * @return list<string>
     */
    public static function availableFrom(OnboardingStatus $current): array
    {
        $out = [];

        foreach (self::GRAPH as $action => [$from, $_]) {
            if (in_array($current, $from, true)) {
                $out[] = $action;
            }
        }

        return $out;
    }

    /** Las acciones que exigen un motivo escrito. */
    public static function requiresReason(string $action): bool
    {
        // Todo lo que perjudica al transportista lleva motivo obligatorio: si
        // alguien va a tener que rehacer papeles o quedarse sin cargas, tiene
        // derecho a saber por qué, y quien lo decide tiene que escribirlo.
        return in_array($action, ['corrections_required', 'rejected', 'suspended'], true);
    }
}
