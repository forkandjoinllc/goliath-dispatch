<?php

declare(strict_types=1);

namespace App\Support\Drivers;

/**
 * Las letras de una licencia comercial, y qué quiere decir cada una.
 *
 * ## El defecto
 *
 * `drivers.cdl_class`, `drivers.endorsements` y `drivers.restrictions` están en
 * el esquema desde el primer día. El formulario ofrecía los endosos como seis
 * botones cuadrados con una LETRA dentro —H, N, T, P, X, S— y la ficha los
 * pintaba unidos por comas: «H, N, T». Ni una palabra de qué significan.
 *
 * Quien da de alta a un conductor tenía que saberse de memoria la tabla de la
 * FMCSA, y quien mira la ficha para decidir si ese conductor puede llevar algo,
 * también. Un dato de cumplimiento que hay que descifrar no se comprueba: se
 * mira por encima.
 *
 * Y las RESTRICCIONES no se veían en ningún sitio. La columna existía, el
 * formulario la llevaba en sus datos y la devolvía tal cual al guardar, pero no
 * había ni un control para ponerlas ni una línea para enseñarlas. Una
 * restricción dice lo que un conductor NO puede conducir —sin frenos de aire,
 * sin tractocamión— y estaba invisible.
 *
 * ## De dónde salen los nombres
 *
 * Del diccionario PORTADO `driver.json`, que traía las tres tablas completas y
 * traducidas a los dos idiomas desde el principio. Es exactamente para lo que
 * `PortedDictionariesTest` pide que se lean los portados antes de construir un
 * dominio: estaban escritos, nadie los miró, y la pantalla salió en clave.
 *
 * ## Por qué una clase y no una constante suelta
 *
 * Porque hay TRES sitios que tienen que coincidir: lo que el formulario ofrece,
 * lo que el controlador acepta y lo que el diccionario sabe nombrar. Estaban en
 * tres sitios distintos —una constante en el TSX, un `max:4` en la validación y
 * nada en el diccionario— y por eso `endorsements.*` admitía CUALQUIER cadena
 * de cuatro caracteres: se podía guardar `ZZ` y la ficha pintaba una letra que
 * no significa nada.
 */
final class Cdl
{
    /**
     * Las tres clases de licencia comercial.
     *
     * @var list<string>
     */
    public const CLASES = ['A', 'B', 'C'];

    /**
     * Los endosos: lo que el conductor SÍ puede llevar además de lo normal.
     *
     * En orden de la FMCSA y no en el que estaban —H, N, T, P, X, S—, que no es
     * ningún orden.
     *
     * @var list<string>
     */
    public const ENDOSOS = ['H', 'N', 'P', 'S', 'T', 'X'];

    /**
     * Las restricciones: lo que el conductor NO puede conducir.
     *
     * @var list<string>
     */
    public const RESTRICCIONES = ['L', 'Z', 'E', 'O', 'M', 'V'];
}
