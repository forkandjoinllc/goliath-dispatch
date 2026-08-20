<?php

declare(strict_types=1);

namespace App\Support\Finance;

/**
 * Sobre qué importe se cobra la tarifa de despacho.
 *
 * El esquema fija los nombres de las columnas pero no esta decisión, y no es un
 * detalle: sobre las ocho cargas de demostración, las dos lecturas se separan
 * en cientos de dólares en cuanto hay un permiso de por medio.
 *
 * Existe como enumeración —y no como una constante escondida— porque la
 * respuesta es del negocio, no del programador, y porque tenerla explícita
 * permitió enseñar las dos con cifras reales antes de elegir.
 */
enum FeeBase: string
{
    /**
     * Tarifa sobre la base comisionable: bruto menos los gastos excluidos.
     *
     * A favor: un permiso de sobredimensión de $3.000 es dinero que solo pasa
     * por las manos del transportista. Cobrarle un 10 % de eso es cobrarle por
     * mover un dinero que no es suyo.
     */
    case Commissionable = 'commissionable_base';

    /**
     * Tarifa sobre el bruto íntegro.
     *
     * A favor: el gasto se llama «excluded_from_commission» —excluido de la
     * COMISIÓN, no de la tarifa— y la enumeración de bases trata
     * «commissionable_base» como algo distinto de «dispatch_fee_amount», lo que
     * sugiere que son dos cantidades que se calculan por separado.
     */
    case CarrierGross = 'carrier_gross_rate';
}
