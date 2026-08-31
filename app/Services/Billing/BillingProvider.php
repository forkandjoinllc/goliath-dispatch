<?php

declare(strict_types=1);

namespace App\Services\Billing;

/**
 * Cobrarle a una empresa su suscripción.
 *
 * Interfaz y no una llamada suelta a Stripe, por lo mismo que FMCSA: la
 * aplicación tiene que arrancar y demostrarse SIN credenciales de nadie. Sin
 * ellas se ata el adaptador simulado y el arco entero funciona de principio a
 * fin; cuando las haya, se ata el real y no cambia una línea de los
 * controladores.
 *
 * ## Lo que esta interfaz NO permite hacer, a propósito
 *
 * **Cobrar una tarjeta.** No hay método que reciba un número de tarjeta, y no
 * lo habrá. El pago ocurre en una página ALOJADA POR EL PROVEEDOR: la
 * aplicación pide una URL, manda allí a la persona, y el proveedor le cobra. El
 * dato de la tarjeta no pasa nunca por este servidor, no entra en sus registros
 * y no aparece en un volcado de la base de datos.
 *
 * Esto es lo que hace que la conversación sobre seguridad de tarjetas sea corta.
 * Meter un formulario de tarjeta en la aplicación —aunque «solo» reenviara los
 * datos— convertiría todo este código, sus registros y sus copias de seguridad
 * en asunto del cumplimiento de tarjetas. No lo son porque no lo tocan.
 *
 * ESTO NO CERTIFICA NADA. Que los datos de tarjeta no pasen por aquí es una
 * condición necesaria y no suficiente: qué obligaciones tiene una empresa que
 * cobra suscripciones lo determinan su proveedor y su asesor, no este comentario.
 * Ver docs/billing.md.
 */
interface BillingProvider
{
    /**
     * Una URL donde la persona puede pagar.
     *
     * La devuelve el proveedor, la aplicación solo redirige. `$returnUrl` es
     * adonde vuelve al terminar y `$cancelUrl` si se arrepiente.
     */
    public function checkoutUrl(
        string $tenantId,
        string $planCode,
        string $customerEmail,
        string $returnUrl,
        string $cancelUrl,
    ): CheckoutSession;

    /**
     * Comprueba que un suceso viene de verdad del proveedor.
     *
     * Devuelve el suceso ya interpretado, o nulo si la firma no cuadra. Es la
     * única defensa de un punto de entrada PÚBLICO y sin sesión: sin ella,
     * cualquiera que conozca la URL podría mandar «pago recibido» y activarse la
     * suscripción gratis.
     */
    public function parseWebhook(string $payload, string $signature): ?BillingEvent;

    /**
     * Una URL donde la empresa gestiona su propia suscripción —cambiar de
     * tarjeta, ver recibos, darse de baja—.
     *
     * También alojada por el proveedor, por lo mismo de antes. Devuelve nulo
     * cuando la empresa todavía no es cliente del proveedor.
     */
    public function portalUrl(string $customerId, string $returnUrl): ?string;

    /** Si hay credenciales de verdad detrás. */
    public function isLive(): bool;

    /** Lo que se guarda para que nadie confunda simulacro con realidad. */
    public function name(): string;
}
