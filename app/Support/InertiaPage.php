<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Http\Request;

/**
 * Declara qué espacios de nombres del diccionario necesita esta página.
 *
 * Se guarda en los atributos de la petición porque HandleInertiaRequests::share
 * corre DESPUÉS del controlador, y para entonces el controlador ya no está para
 * preguntarle. Pasarlo como una prop más obligaría a cada página a fusionar el
 * diccionario a mano.
 */
trait InertiaPage
{
    /**
     * @param  list<string>  $namespaces
     */
    protected function usesDictionary(Request $request, array $namespaces): void
    {
        $request->attributes->set('dictionaryNamespaces', $namespaces);
    }
}
