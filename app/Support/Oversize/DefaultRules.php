<?php

declare(strict_types=1);

namespace App\Support\Oversize;

/**
 * Los límites con los que arranca una empresa nueva.
 *
 * QUÉ SON ESTOS NÚMEROS, EXACTAMENTE. Son los límites FEDERALES de Estados
 * Unidos para el Sistema Nacional de Autopistas, que son reales y bien
 * establecidos: 102 pulgadas de ancho, 80.000 libras de peso bruto, 20.000
 * libras por eje simple. No me los he inventado y no son «típicos»: son la
 * línea de base sobre la que cada estado construye la suya.
 *
 * QUÉ NO SON. No son los límites de ningún estado en concreto. La altura es el
 * caso más claro: el gobierno federal NO la regula, la fija cada estado, y va
 * de 13'6" en la mayoría del este a 14'0" en buena parte del oeste. Aquí se
 * siembra 13'6" —el valor más restrictivo y por tanto el que no mete a nadie en
 * un puente— y se marca con `source_note` que hay que verificarlo estado por
 * estado. La longitud igual: 53 pies es lo habitual para el remolque, pero la
 * combinación completa y los remolques dobles tienen sus propias reglas.
 *
 * POR QUÉ SE SIEMBRA IGUAL PARA LOS 50 EN VEZ DE INVENTARME 50 TABLAS. Porque
 * cincuenta números plausibles y sin fuente son peores que uno correcto
 * repetido: dan una precisión que no existe y nadie los revisaría. Sembrando la
 * misma línea federal en todos, la pantalla enseña la fecha de última revisión
 * vacía y el aviso de verificar, y quien lleve la operación sabe exactamente
 * qué le falta por mirar.
 *
 * Y sobre todo: esto ORIENTA, no determina. Lo dice el propio esquema en el
 * comentario de la tabla —«these drive guidance, never a legal determination»—
 * y lo repite la pantalla. Un permiso lo emite un estado, no este programa.
 */
final class DefaultRules
{
    /** 8 pies 6 pulgadas. Límite federal de ancho en el Sistema Nacional. */
    public const ANCHO = 102;

    /**
     * 13 pies 6 pulgadas.
     *
     * El federal NO regula la altura: la fija cada estado. Se siembra el valor
     * más restrictivo de los dos habituales, porque equivocarse por abajo hace
     * pedir un permiso que no hacía falta y equivocarse por arriba mete un
     * remolque debajo de un puente.
     */
    public const ALTURA = 162;

    /** 53 pies de remolque, que es lo habitual en un semirremolque. */
    public const LARGO = 636;

    /** Límite federal de peso bruto vehicular. */
    public const PESO_BRUTO = 80000;

    /** Límite federal de eje simple. */
    public const PESO_EJE = 20000;

    /**
     * Umbrales por encima de los cuales suele hacer falta escolta.
     *
     * «Suele» es la palabra. Estos son los valores más repetidos entre estados,
     * y sirven para que la evaluación diga «probablemente» — que es lo único
     * que puede decir sin leer el reglamento del estado concreto. Van nulos
     * donde no hay un valor lo bastante repetido como para escribirlo.
     */
    public const ESCOLTA_ANCHO = 144;      // 12 pies
    public const ESCOLTA_ALTURA = 174;     // 14 pies 6 pulgadas
    public const ESCOLTA_LARGO = 1080;     // 90 pies
    public const ESCOLTA_POLICIA_ANCHO = 192; // 16 pies

    public const NOTA_ES = 'Línea de base FEDERAL de EE. UU., no de este estado. El ancho (102"), el peso bruto (80.000 lb) y el eje simple (20.000 lb) son límites federales reales del Sistema Nacional de Autopistas. La ALTURA no la regula el gobierno federal: la fija cada estado y va de 13\'6" a 14\'0" — aquí se sembró la más restrictiva. Verifique estos valores con la autoridad del estado antes de usarlos para decidir nada.';

    public const NOTA_EN = 'US FEDERAL baseline, not this state\'s. Width (102"), gross weight (80,000 lb) and single-axle weight (20,000 lb) are real federal limits for the National Network. HEIGHT is not federally regulated: each state sets it, ranging from 13\'6" to 14\'0" — the more restrictive value was seeded here. Verify these values with the state authority before relying on them to decide anything.';
}
