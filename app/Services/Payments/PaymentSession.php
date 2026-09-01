<?php

declare(strict_types=1);

namespace App\Services\Payments;

/**
 * La página de pago del proveedor, y la referencia con la que se le reconocerá.
 *
 * No lleva ningún dato de tarjeta, ni puede: los datos de tarjeta se introducen
 * en la página del proveedor y no pasan por este servidor. Ver docs/billing.md.
 */
final readonly class PaymentSession
{
    public function __construct(
        public string $url,
        public string $reference,
    ) {}
}
