<?php

declare(strict_types=1);

namespace App\Services\Billing;

/**
 * Un suceso del proveedor, ya interpretado.
 *
 * Se traduce a un vocabulario propio —`TYPES`— en vez de pasear por la
 * aplicación los nombres de Stripe. Dos motivos:
 *
 *  - El día que haya otro proveedor, sus nombres serán otros y el ciclo de la
 *    suscripción no tiene por qué enterarse.
 *  - Los nombres de Stripe son suyos y cambian con su versión de API. Atarlos a
 *    un `match` repartido por la aplicación es firmar que cada cambio de versión
 *    sea una cacería.
 */
final readonly class BillingEvent
{
    /** El vocabulario propio, no el del proveedor. */
    public const PAID = 'paid';

    public const PAYMENT_FAILED = 'payment_failed';

    public const CANCELLED = 'cancelled';

    public const IGNORED = 'ignored';

    public const TYPES = [self::PAID, self::PAYMENT_FAILED, self::CANCELLED, self::IGNORED];

    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(
        /** El id del proveedor. Es lo que hace idempotente el libro. */
        public string $id,
        /** Uno de TYPES. */
        public string $type,
        /** El nombre original del proveedor, para poder auditar. */
        public string $providerType,
        public ?string $tenantId,
        public ?string $customerId,
        public ?string $subscriptionId,
        public ?string $planCode,
        public ?int $periodStart,
        public ?int $periodEnd,
        public ?string $failureMessage,
        public array $payload,
    ) {}
}
