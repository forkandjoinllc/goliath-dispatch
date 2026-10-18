<?php

declare(strict_types=1);

namespace App\Http\Controllers\Marketing;

use App\Services\Fmcsa\FmcsaDirectory;
use App\Support\Forms\FormToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Buscar un transportista en el registro federal, desde el alta PÚBLICA.
 *
 * ## Lo que ya existía y nadie usaba
 *
 * `FmcsaDirectory` —con `byDot()`, `byDocket()`, su adaptador real y su
 * simulado— lleva construido desde hace lotes, y la ficha interna de
 * transportista lo usa. El alta pública no: pedía el USDOT como un campo más
 * entre veinte y no preguntaba nada a nadie. Quien se da de alta tenía que
 * teclear a mano un domicilio que el registro federal ya publica.
 *
 * ## Por qué esto NO es el mismo método que el de dentro
 *
 * `CarrierController::lookup()` contesta además la pregunta más útil para
 * quien despacha: «¿este transportista ya lo tengo dado de alta?». Aquí eso no
 * puede salir. Al otro lado hay un desconocido sin sesión, y devolverle si un
 * USDOT está o no en la cartera de esta empresa le deja enumerar la cartera
 * entera a base de probar números. **No se devuelve nada de la base de datos:
 * solo lo que contestó el registro federal, que es público.**
 *
 * ## Las tres defensas
 *
 * 1. **El tope por IP**, en la ruta. Es la que cuenta peticiones de verdad.
 * 2. **El sello firmado** del formulario, que ata la consulta a una página que
 *    servimos nosotros — sin exigir la pausa de tres segundos, que para una
 *    búsqueda diría lo contrario de lo que quiere decir. Ver `FormToken`.
 * 3. **El campo trampa**, igual que en el envío.
 *
 * Y una razón de fondo para las tres: FMCSA es un servicio público y gratuito.
 * Un formulario abierto que le pega sin freno es la forma más rápida de que
 * dejen de contestarnos — y entonces se rompe también la ficha de dentro, que
 * sí hace falta.
 */
final class CarrierLookupController
{
    public function __invoke(Request $request, FmcsaDirectory $directorio): JsonResponse
    {
        $datos = $request->validate([
            'kind' => ['required', 'in:dot,mc'],
            'number' => ['required', 'string', 'max:20'],
            'form_token' => ['required', 'string', 'max:400'],
            // Presente pero vacío, como en el envío: si falta, el POST no viene
            // de nuestra página; si trae algo, lo rellenó un script.
            'hp_field' => ['present', 'max:0'],
        ]);

        $sello = FormToken::verify((string) $datos['form_token'], 'carrier_signup', exigirPausa: false);

        if (! $sello['valid']) {
            // Sin decir cuál de las defensas lo paró, igual que en el envío:
            // explicárselo a un bot es enseñarle a rodearla.
            return response()->json(['status' => 'rejected'], 422);
        }

        $resultado = $datos['kind'] === 'dot'
            ? $directorio->byDot((string) $datos['number'])
            : $directorio->byDocket((string) $datos['number']);

        return response()->json([
            'status' => $resultado->status->value,
            /*
             * Si detrás hubo una consulta de verdad.
             *
             * Sin credenciales se ata el adaptador simulado, que se inventa una
             * ficha coherente para poder construir y demostrar. La pantalla
             * tiene que DECIRLO: rellenar veinte casillas con datos fabricados
             * y presentarlos como si vinieran del registro federal es la
             * mentira más cara que puede contar este formulario.
             */
            'live' => $resultado->live,
            'provider' => $resultado->provider,
            'carrier' => $resultado->carrier?->toForm(),
            // Cuándo se preguntó. El registro publica fichas que llevan años
            // sin tocarse, así que la fecha del dato es parte del dato.
            'checkedAt' => Carbon::now()->toIso8601String(),
        ]);
    }
}
