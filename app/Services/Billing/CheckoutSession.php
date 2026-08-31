<?php

declare(strict_types=1);

namespace App\Services\Billing;

/**
 * Lo que devuelve el proveedor al pedirle una página de pago.
 *
 * `reference` es SU identificador de la sesión, que vuelve en el suceso del
 * webhook. Sirve para casar «esta persona fue a pagar» con «este pago llegó»
 * sin fiarse de la vuelta del navegador.
 */
final readonly class CheckoutSession
{
    public function __construct(
        public string $url,
        public string $reference,
    ) {}
}
