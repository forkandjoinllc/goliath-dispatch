<?php

declare(strict_types=1);

namespace App\Translation;

use Illuminate\Translation\FileLoader;

/**
 * Permite que `lang/{idioma}/{espacio}.json` funcione como un grupo de
 * traducción normal, de modo que `__('marketing.seo.home.title')` resuelva.
 *
 * Laravel soporta dos formas: ficheros PHP por grupo
 * (`lang/en/marketing.php`) y un único JSON de cadenas completas
 * (`lang/en.json`). Lo que hay aquí es lo tercero: 22 ficheros JSON anidados,
 * uno por dominio, portados tal cual del original en Next.js.
 *
 * Convertirlos a PHP en un paso de compilación habría duplicado la fuente de
 * verdad y roto la única propiedad que hace fiable este diccionario: que el
 * MISMO fichero lo leen el servidor (para el SEO y los mensajes de validación) y
 * el cliente (para la interfaz). Con dos copias, una se queda atrás.
 *
 * Se prefiere el PHP si existiera ambos, para que un `lang/en/validation.php` de
 * un paquete pueda seguir mandando.
 */
final class JsonNamespaceLoader extends FileLoader
{
    /**
     * @param  list<string>  $paths
     * @return array<string, mixed>
     */
    protected function loadPaths(array $paths, $locale, $group)
    {
        $output = parent::loadPaths($paths, $locale, $group);

        foreach ($paths as $path) {
            $full = "{$path}/{$locale}/{$group}.json";

            if (! $this->files->exists($full)) {
                continue;
            }

            $decoded = json_decode($this->files->get($full), true);

            if (! is_array($decoded)) {
                // Un JSON corrupto debe romper en el arranque, no traducir a
                // medias y dejar media página en claves crudas.
                throw new \RuntimeException(
                    "Diccionario ilegible: {$full} (".json_last_error_msg().')'
                );
            }

            // El PHP gana: array_replace_recursive con el JSON de base y el PHP
            // encima sería al revés, así que el orden importa.
            $output = array_replace_recursive($decoded, $output);
        }

        return $output;
    }
}
