<?php

declare(strict_types=1);

namespace App\Support\Equipment;

/**
 * Lo que un VIN dice por sí mismo, sin preguntarle a nadie.
 *
 * Un VIN de EE. UU. son 17 caracteres y no es una cadena opaca: tres partes
 * suyas están normalizadas y se pueden leer aquí mismo.
 *
 *  - **Posiciones 1-3 (WMI)** — quién lo fabricó. Se traduce con la tabla de
 *    `Wmi`, que es parcial a propósito.
 *  - **Posición 9** — un dígito de control que se calcula con el resto del
 *    número. Sirve para decir «eso que ha escrito no es un VIN» antes de salir
 *    a preguntar por él a ninguna parte.
 *  - **Posición 10** — el año del modelo, con una tabla de treinta valores que
 *    se repite cada treinta años.
 *
 * Lo que NO se puede leer aquí es el MODELO: vive en las posiciones 4-8, que
 * cada fabricante define a su manera y no publica. Para eso hace falta una base
 * externa, y por eso el decodificador vivo existe.
 */
final class Vin
{
    /** Las letras que un VIN nunca lleva, para no confundirlas con 1 y 0. */
    public const PROHIBIDAS = ['I', 'O', 'Q'];

    /**
     * El valor de cada carácter para el dígito de control.
     *
     * @var array<string, int>
     */
    private const VALORES = [
        'A' => 1, 'B' => 2, 'C' => 3, 'D' => 4, 'E' => 5, 'F' => 6, 'G' => 7, 'H' => 8,
        'J' => 1, 'K' => 2, 'L' => 3, 'M' => 4, 'N' => 5, 'P' => 7, 'R' => 9,
        'S' => 2, 'T' => 3, 'U' => 4, 'V' => 5, 'W' => 6, 'X' => 7, 'Y' => 8, 'Z' => 9,
        '0' => 0, '1' => 1, '2' => 2, '3' => 3, '4' => 4, '5' => 5, '6' => 6, '7' => 7, '8' => 8, '9' => 9,
    ];

    /** Cuánto pesa cada posición. La novena es el propio dígito: pesa cero. */
    private const PESOS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

    /**
     * Los treinta códigos de año, en orden. El ciclo se repite cada treinta.
     *
     * @var list<string>
     */
    private const CICLO = [
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'R',
        'S', 'T', 'V', 'W', 'X', 'Y', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ];

    /** El primer año del primer ciclo: `A` = 1980. */
    private const PRIMER_ANO = 1980;

    /** Mayúsculas y sin nada que no sea letra o número. */
    public static function normalizar(string $vin): string
    {
        return mb_strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $vin) ?? '');
    }

    /**
     * ¿Tiene forma de VIN completo?
     *
     * Diecisiete caracteres, sin I, O ni Q. NO comprueba el dígito de control:
     * eso es `sumaBien()`, y se preguntan por separado a propósito — un VIN con
     * la forma buena y el dígito malo es casi siempre una errata de quien lo
     * copió, y merece un mensaje distinto de «esto no es un VIN».
     */
    public static function tieneForma(string $vin): bool
    {
        $v = self::normalizar($vin);

        if (mb_strlen($v) !== 17) {
            return false;
        }

        return preg_match('/^[A-HJ-NPR-Z0-9]{17}$/', $v) === 1;
    }

    /**
     * ¿Cuadra el dígito de control?
     *
     * Se calcula sobre los otros dieciséis caracteres. Un VIN inventado casi
     * nunca cuadra, así que esto evita salir a preguntar por números que no
     * existen — y, más importante, evita rellenar marca y año de un vehículo
     * que no es el que la persona tiene delante.
     */
    public static function sumaBien(string $vin): bool
    {
        $v = self::normalizar($vin);

        if (! self::tieneForma($v)) {
            return false;
        }

        $suma = 0;

        foreach (str_split($v) as $i => $caracter) {
            $suma += (self::VALORES[$caracter] ?? 0) * self::PESOS[$i];
        }

        $resto = $suma % 11;
        $esperado = $resto === 10 ? 'X' : (string) $resto;

        return $v[8] === $esperado;
    }

    /**
     * El año del modelo, o nulo si no se puede saber.
     *
     * La tabla de la posición 10 tiene treinta valores y se repite: `L` es 1990
     * y también 2020. Lo que desempata es la posición 7 —numérica en el ciclo
     * viejo, alfabética en el nuevo—, y aun así se comprueba contra el
     * calendario: un año de modelo puede ir un año por delante del actual (en
     * otoño ya se venden los del año siguiente) pero no diez.
     */
    public static function ano(string $vin, ?int $anoActual = null): ?int
    {
        $v = self::normalizar($vin);

        if (! self::tieneForma($v)) {
            return null;
        }

        $posicion = array_search($v[9], self::CICLO, true);

        if ($posicion === false) {
            return null;
        }

        $anoActual ??= (int) date('Y');
        $tope = $anoActual + 1;

        $viejo = self::PRIMER_ANO + (int) $posicion;
        $nuevo = $viejo + 30;

        // La posición 7 alfabética señala el ciclo nuevo. Es la regla del
        // estándar para vehículos ligeros y la que siguen de hecho los
        // fabricantes de camión.
        $candidato = ctype_alpha($v[6]) ? $nuevo : $viejo;

        if ($candidato <= $tope) {
            return $candidato;
        }

        // Y si aun así sale del futuro, el otro ciclo. Pasa con remolques
        // viejos cuyo séptimo carácter no sigue la regla.
        return $viejo <= $tope ? $viejo : null;
    }

    /** Las tres primeras letras: quién lo fabricó. */
    public static function wmi(string $vin): ?string
    {
        $v = self::normalizar($vin);

        return mb_strlen($v) >= 3 ? mb_substr($v, 0, 3) : null;
    }
}
