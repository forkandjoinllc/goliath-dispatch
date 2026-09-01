<?php

declare(strict_types=1);

namespace App\Services\Payments;

/**
 * Cobrarle una factura de flete al cliente de una casa de despacho.
 *
 * ## Por qué es OTRA interfaz y no `BillingProvider`
 *
 * Son dos dineros distintos que van a dos sitios distintos:
 *
 *  - `App\Services\Billing\BillingProvider` es NOSOTROS cobrándole la
 *    suscripción a la casa de despacho. El dinero llega a nuestra cuenta.
 *  - Esto es la casa de despacho cobrándole el flete a SU cliente. El dinero
 *    llega a la cuenta de ellos, no a la nuestra, y con Stripe eso es Connect —
 *    otra integración, otras credenciales y otra responsabilidad legal.
 *
 * Meter las dos en una interfaz habría ahorrado un fichero y habría dejado un
 * método `checkoutUrl` que a veces cobra para nosotros y a veces para otro,
 * decidido por un parámetro. Ese es el tipo de ahorro que se paga el día que
 * alguien se equivoca de rama.
 *
 * ## Sin credenciales, el adaptador simulado
 *
 * La regla de siempre: la aplicación arranca y se enseña entera sin una sola
 * clave de tercero. El simulado se identifica como tal en cada intento que
 * escribe, para que nadie confunda un cobro de mentira con uno de verdad.
 */
interface InvoicePaymentProvider
{
    /**
     * Una página de pago para esta factura.
     *
     * `idempotencyKey` viaja al proveedor y vuelve en el suceso: es lo que
     * impide que dos pulsaciones del mismo botón se conviertan en dos cobros.
     */
    public function checkoutUrl(
        string $tenantId,
        string $invoiceId,
        int $amountCents,
        string $idempotencyKey,
        string $returnUrl,
    ): PaymentSession;

    public function isLive(): bool;

    /** Lo que se guarda en la fila para que nadie confunda simulacro con realidad. */
    public function name(): string;
}
