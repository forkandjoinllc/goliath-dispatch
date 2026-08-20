<?php

declare(strict_types=1);

namespace App\Support\Customers;

use Illuminate\Support\Str;

/**
 * La forma normalizada del nombre de una empresa, para detectar duplicados.
 *
 * Existe como clase y no como una línea dentro del controlador porque la usan
 * tres sitios que TIENEN que coincidir: el alta, la edición y el sembrador de
 * datos. Si dos de ellos normalizaran distinto, la detección fallaría
 * exactamente en los casos que existe para atrapar.
 *
 * Lo que quita, y por qué:
 *
 *  - Los acentos («Aceros Delgado» y «Aceros Delgádo» son la misma empresa
 *    escrita por dos personas distintas).
 *  - La puntuación y las mayúsculas.
 *  - Los sufijos societarios: LLC, Inc, S.A. de C.V., S. de R.L. Es lo que más
 *    diferencias produce, porque cada quien los escribe a su manera y a menudo
 *    ni los escribe.
 *
 * Lo que NO hace es decidir. Devuelve una clave para comparar; que dos claves
 * iguales sean de verdad la misma empresa lo decide una persona, y para eso
 * está el permiso `customer:duplicate:override`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AVISO: la columna `customers.company_name_normalized` es una CACHÉ de lo que
 * devuelve este método. Si toca la lista de sufijos o la normalización, las
 * filas ya escritas conservan su clave vieja y la detección de duplicados deja
 * de ver parecidos que sí existen — sin error y sin ruido.
 *
 * Después de tocar esta clase:
 *
 *     php artisan customers:renormalize
 *
 * No es una recomendación: este fallo ya ocurrió una vez, y se manifestó como
 * dos altas del mismo cliente que el sistema aceptó sin rechistar.
 * ────────────────────────────────────────────────────────────────────────────
 */
final class NameKey
{
    /**
     * Sufijos societarios de EE. UU. y México, que son los dos países de los
     * que vienen los clientes de este sistema.
     *
     * @var list<string>
     */
    private const SUFFIXES = [
        'llc', 'l l c', 'inc', 'incorporated', 'corp', 'corporation', 'co',
        'company', 'ltd', 'limited', 'lp', 'llp', 'plc',
        'sa de cv', 'sa', 's de rl de cv', 's de rl', 'srl', 'sapi de cv', 'sc',
    ];

    public static function for(string $name): string
    {
        // Str::ascii translitera: «Ibáñez» -> «Ibanez», «São» -> «Sao».
        $value = strtolower(Str::ascii($name));

        // Los puntos se quitan SIN dejar espacio, para que «S.A.» quede «sa» y
        // no «s a», que no casaría con quien lo escribió sin puntos.
        $value = str_replace('.', '', $value);
        $value = preg_replace('/[^a-z0-9 ]+/', ' ', $value) ?? '';
        $value = trim(preg_replace('/\s+/', ' ', $value) ?? '');

        // El sufijo se quita solo AL FINAL, y en bucle: «Transport Group LLC
        // Inc» existe. Quitarlo en cualquier posición fundiría «Company Cold
        // Storage» con «Cold Storage», que son empresas distintas.
        $changed = true;

        while ($changed) {
            $changed = false;

            foreach (self::SUFFIXES as $suffix) {
                if (str_ends_with($value, ' '.$suffix)) {
                    $value = trim(substr($value, 0, -strlen($suffix) - 1));
                    $changed = true;
                }
            }
        }

        return $value;
    }
}
