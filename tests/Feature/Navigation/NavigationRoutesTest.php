<?php

declare(strict_types=1);

use App\Support\Navigation;
use Illuminate\Http\Request;
use Illuminate\Routing\Exceptions\UrlGenerationException;
use Illuminate\Support\Facades\Route;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Cada entrada del menú marcada como TERMINADA tiene que llevar a algún sitio.
 *
 * Esto no comprueba autorización ni contenido: comprueba que la RUTA existe.
 * Suena a poco hasta que pasa lo que pasó con el lote de seguimiento, que se
 * entregó sin su bloque de `routes/auth.php`: el controlador, la pantalla, el
 * diccionario y veintiuna pruebas en verde, y la entrada del menú devolviendo
 * un 404 en producción. Las pruebas del módulo no lo vieron porque llamaban a
 * las rutas por su URL, y en el entorno donde se escribieron sí estaban.
 *
 * `Navigation::construidas()` es la lista que dice «esta pantalla existe de
 * verdad». Es la afirmación que hay que poder respaldar. Era una constante
 * hasta que todas las entradas quedaron construidas y el análisis estático
 * demostró que `ready` ya no podía salir falso; pasó a método para que no lo dé
 * por decidido, y lo que dice sigue siendo lo mismo.
 */
it('toda entrada del menú marcada como terminada resuelve a una ruta', function () {
    $metodo = (new ReflectionClass(Navigation::class))->getMethod('construidas');
    $metodo->setAccessible(true);

    /** @var list<string> $rutas */
    $rutas = $metodo->invoke(null);

    expect($rutas)->toBeArray()->not->toBeEmpty();

    $rotas = [];

    foreach ($rutas as $ruta) {
        $peticion = Request::create('/'.$ruta, 'GET');

        try {
            Route::getRoutes()->match($peticion);
        } catch (NotFoundHttpException|UrlGenerationException) {
            $rotas[] = '/'.$ruta;
        }
    }

    expect($rotas)->toBe([]);
});
