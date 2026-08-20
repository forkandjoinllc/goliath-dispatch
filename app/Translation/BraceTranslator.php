<?php

declare(strict_types=1);

namespace App\Translation;

use Illuminate\Translation\Translator;

/**
 * Hace que `__()` entienda `{nombre}`, además del `:nombre` de Laravel.
 *
 * Existe porque los diccionarios de este proyecto los leen DOS motores: el
 * cliente (resources/js/lib/i18n.tsx) y el servidor. El cliente usa `{nombre}`,
 * que es la convención de ICU y la que ya estaba en los 22 espacios de nombres.
 *
 * Sin esto, una cadena con marcadores traducida en el servidor llegaba al
 * usuario con las llaves crudas: «Ese paso no está disponible desde
 * «{from}»» — el fallo no rompe nada, no sale en ningún registro, y solo se ve
 * si alguien lee el mensaje. Mantener dos convenciones en los mismos ficheros
 * garantizaba que volviera a pasar.
 */
final class BraceTranslator extends Translator
{
    /**
     * @param  array<string, mixed>  $replace
     */
    protected function makeReplacements($line, array $replace)
    {
        // Primero lo de Laravel, para no perder ninguna cadena que ya use `:x`
        // (los mensajes de validación del propio framework, entre otras).
        $line = parent::makeReplacements($line, $replace);

        foreach ($replace as $key => $value) {
            $line = str_replace('{'.$key.'}', (string) $value, $line);
        }

        return $line;
    }
}
