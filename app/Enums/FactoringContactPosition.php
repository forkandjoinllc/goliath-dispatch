<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * A quién se llama en una empresa de factoring, y para qué.
 *
 * No es un adorno del formulario. A una factoring se le llama por cosas muy
 * distintas —aprobar una carta de cesión, perseguir un cobro, arreglar una
 * factura mal emitida— y quien lleva una cosa no lleva la otra. Un despachador
 * que llama al de cobros para preguntar por una NOA pierde media mañana.
 *
 * Lista cerrada y no texto libre a propósito: en cuanto se deja escribir, en la
 * misma base conviven «cobros», «Cobranzas» y «AR», y entonces el campo ya no
 * orienta a nadie ni sirve para filtrar.
 */
enum FactoringContactPosition: string
{
    /** El gestor de la cuenta. La primera puerta cuando no se sabe a quién llamar. */
    case AccountManager = 'account_manager';

    /** Quien financia: adelantos, reservas, tarifas. */
    case Funding = 'funding';

    /** Cartas de cesión y cambios de beneficiario. */
    case Noa = 'noa';

    /** Cobros al cliente final. */
    case Collections = 'collections';

    /** Facturación: correcciones, reenvíos, formatos. */
    case Billing = 'billing';

    /** Análisis de riesgo: aprueba o rechaza a un deudor. */
    case Underwriting = 'underwriting';

    case Operations = 'operations';

    case Owner = 'owner';

    case Other = 'other';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
