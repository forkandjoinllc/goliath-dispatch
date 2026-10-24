<?php

declare(strict_types=1);

namespace Tests\Support;

/**
 * Leer el código fuente como lo leen los guardianes de `tests/Unit/Suite`.
 *
 * ## Por qué existe
 *
 * Porque estaba copiado quince veces, y en la copia número quince se descubrió
 * que la mitad de las agujas no podían encontrar nada.
 *
 * Los guardianes de esa carpeta no arrancan la aplicación: leen el fichero y
 * comprueban que una línea sigue —o ya no— estando. Para que un comentario que
 * MENCIONA lo que se vigila no haga pasar la prueba, primero se quitan los
 * comentarios con `token_get_all()`.
 *
 * ## El fallo que esto cierra
 *
 * Quitar los comentarios NO quita los espacios: `token_get_all()` devuelve el
 * espacio en blanco como un token más. Varias agujas estaban escritas sin
 * espacios —`'malware_scan_status'=>'clean'`, `'invoiced'=>[[LoadStatus...`—
 * porque quien las escribió (yo) dio por hecho que el código venía compactado.
 * No venía. Esas agujas NO PODÍAN casar nunca, así que las comprobaciones
 * pasaban siempre, con el defecto puesto y sin él.
 *
 * Lo destapó un sabotaje: se volvió a poner en el sembrador el `clean` que el
 * guardián existía para prohibir, y el guardián siguió en verde.
 *
 * Por eso hay DOS funciones y no una, y por eso se llaman así:
 *
 *  - `sinComentarios()` conserva los espacios. Para agujas escritas tal cual se
 *    ven en el fichero: `'locale' => self::idiomaValido(...)`.
 *  - `compacta()` quita también los espacios. Para agujas escritas sin ellos,
 *    que es lo cómodo cuando lo que se busca cruza saltos de línea.
 *
 * Elegir mal ya no falla en silencio: falla al escribirla, porque la aguja no
 * casa con nada y el sabotaje lo enseña.
 */
final class Source
{
    /** La raíz del repositorio. */
    public static function root(): string
    {
        return dirname(__DIR__, 2);
    }

    /** El fichero sin sus comentarios, con los espacios tal cual. */
    public static function sinComentarios(string $ruta): string
    {
        $codigo = '';

        foreach (token_get_all((string) file_get_contents($ruta)) as $token) {
            if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }

            $codigo .= is_array($token) ? $token[1] : $token;
        }

        return $codigo;
    }

    /**
     * El fichero sin comentarios, sea del idioma que sea.
     *
     * `sinComentarios` usa el analizador de PHP y no sirve para un `.tsx`.
     * Hace falta porque un guardián que busca una cadena PROHIBIDA la
     * encuentra en el comentario que explica por qué está prohibida, y se
     * queda verde midiendo su propia explicación. Pasó dos veces: con `bg-${`
     * en la cronología y con `` `/home?tab=`` en el tablero.
     *
     * Para lo que no es PHP se quitan a la brava —`/* … *``/` y `// …`—. No es
     * un analizador: una barra doble dentro de una cadena de texto se llevaría
     * por delante el resto de la línea. Vale para lo que hace falta, que es
     * mirar código y no cadenas.
     */
    public static function codigo(string $ruta): string
    {
        if (str_ends_with($ruta, '.php')) {
            return self::sinComentarios($ruta);
        }

        $fuente = (string) file_get_contents($ruta);
        $fuente = (string) preg_replace('#/\*.*?\*/#s', '', $fuente);

        return (string) preg_replace('#^\s*//.*$#m', '', $fuente);
    }

    /** El fichero sin comentarios NI espacios. */
    public static function compacta(string $ruta): string
    {
        return (string) preg_replace('/\s+/', '', self::sinComentarios($ruta));
    }

    /**
     * El CUERPO de una función, método o bloque, para no buscar en todo el fichero.
     *
     * ## El fallo que esto cierra, por séptima vez
     *
     * Una guarda dice «cada intento queda anotado» y busca la columna en todo el
     * fichero. Dentro hay DOS caminos que la escriben. El sabotaje la quita de
     * uno, la cadena sigue apareciendo por el otro, y la guarda se queda verde
     * midiendo algo de al lado de lo que dice medir.
     *
     * Ha aparecido en los lotes 42, 43, 44, 45, 46, 47 y 48. Escribir la lección
     * no bastó: se repitió el lote siguiente a escribirla, dos veces. Lo que
     * faltaba no era recordarla sino tener a mano la herramienta que la cumple.
     *
     * **La regla:** buscar en el fichero entero solo vale cuando el fichero
     * tiene UN sitio capaz de romper la regla. Con dos, se parte.
     *
     * ## Cómo encuentra el final
     *
     * Contando llaves desde la primera `{` que sigue a la firma. No es un
     * analizador: una llave dentro de una cadena de texto —o un `${…}` de una
     * plantilla de JavaScript— lo descuadra. Para eso está la comprobación del
     * final: si no cierra, LANZA en vez de devolver medio fichero, porque medio
     * fichero es otra vez una aguja que casa por donde no debe.
     *
     * @param  string  $fuente  ya pasado por `codigo()`
     * @param  string  $firma  un trozo literal de la primera línea, p. ej. `public static function record(`
     */
    public static function cuerpo(string $fuente, string $firma): string
    {
        $inicio = strpos($fuente, $firma);

        if ($inicio === false) {
            throw new \RuntimeException("No se encuentra «{$firma}»: la guarda estaría mirando a la nada.");
        }

        /*
         * El bloque empieza DESPUÉS de la lista de parámetros.
         *
         * La primera `{` que sigue a la firma no es el cuerpo cuando los
         * parámetros vienen desestructurados —`function TextInput({ label,
         * error, ...props })`, que es lo normal en un componente de React—: es
         * la llave de la desestructuración, y contando desde ahí el bloque
         * «cierra» en el paréntesis de los parámetros. La guarda se quedaba
         * mirando seis líneas de nombres de propiedades.
         *
         * Así que primero se casan los PARÉNTESIS de la firma, y la llave se
         * busca a partir de donde cierran.
         */
        $abreParen = strpos($fuente, '(', $inicio);

        if ($abreParen === false) {
            throw new \RuntimeException("«{$firma}» no tiene lista de parámetros.");
        }

        $desde = self::cierra($fuente, $abreParen, '(', ')');
        $abre = strpos($fuente, '{', $desde);

        if ($abre === false) {
            throw new \RuntimeException("«{$firma}» no abre ningún bloque.");
        }

        $nivel = 0;
        $largo = strlen($fuente);

        for ($i = $abre; $i < $largo; $i++) {
            if ($fuente[$i] === '{') {
                $nivel++;
            } elseif ($fuente[$i] === '}') {
                $nivel--;

                if ($nivel === 0) {
                    return substr($fuente, $inicio, $i - $inicio + 1);
                }
            }
        }

        throw new \RuntimeException("El bloque de «{$firma}» no cierra: las llaves no cuadran.");
    }

    /** Dónde cierra el delimitador que abre en `$desde`. */
    private static function cierra(string $fuente, int $desde, string $abre, string $cierra): int
    {
        $nivel = 0;
        $largo = strlen($fuente);

        for ($i = $desde; $i < $largo; $i++) {
            if ($fuente[$i] === $abre) {
                $nivel++;
            } elseif ($fuente[$i] === $cierra) {
                $nivel--;

                if ($nivel === 0) {
                    return $i;
                }
            }
        }

        throw new \RuntimeException("No cierra el «{$abre}» de la posición {$desde}.");
    }
}
