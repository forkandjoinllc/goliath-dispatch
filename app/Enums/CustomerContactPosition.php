<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * A quién se llama en la empresa de un cliente, y para qué.
 *
 * La lista importa porque el correo que se manda decide a quién va según esto.
 * El enlace de rastreo de una carga le sirve a quien la espera —tráfico, el
 * muelle, quien la compró— y no a contabilidad; una factura es exactamente al
 * revés. Mandar las dos cosas al mismo sitio es cómo se consigue que no lean
 * ninguna.
 *
 * Lista cerrada y no texto libre a propósito, igual que en transportistas y
 * factoring: en cuanto se deja escribir, en la misma base conviven «tráfico»,
 * «Trafico» y «OPS», y entonces el campo ya no orienta a nadie ni sirve para
 * elegir destinatario.
 *
 * Es más corta que la de los transportistas porque un cliente se organiza con
 * menos papeles: aquí no hay seguridad, ni cumplimiento, ni jefe de conductores.
 */
enum CustomerContactPosition: string
{
    /** Quien mueve la carga día a día. El destinatario natural del rastreo. */
    case Traffic = 'traffic';

    /** El muelle: quien carga o descarga y quiere saber a qué hora llega. */
    case Dock = 'dock';

    /** Compras: quien contrató el flete. */
    case Purchasing = 'purchasing';

    /** Cuentas por pagar. El destinatario de una factura, no del rastreo. */
    case Billing = 'billing';

    /** Quien manda. Se le escribe poco y cuando algo va mal. */
    case Executive = 'executive';

    case Other = 'other';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
