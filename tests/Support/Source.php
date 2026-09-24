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
}
