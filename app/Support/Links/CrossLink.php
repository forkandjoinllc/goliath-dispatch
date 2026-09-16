<?php

declare(strict_types=1);

namespace App\Support\Links;

use App\Authorization\Actor;
use App\Authorization\PermissionChecker;

/**
 * Un enlace de una ficha a otra, o ninguno.
 *
 * ## El defecto
 *
 * La ficha de una carga pinta el nombre del cliente como enlace a
 * `/customers/{id}`. El TRANSPORTISTA y el CONDUCTOR llegan a esa ficha con
 * normalidad —los dos tienen `load:read`— y ninguno de los dos tiene
 * `customer:read`: pulsan el nombre y aterrizan en «Acceso denegado».
 *
 * Cuatro sitios, todos iguales:
 *
 * | Pantalla | Enlace | Quién cae |
 * |---|---|---|
 * | ficha de carga | → cliente | transportista y conductor |
 * | ficha de carga | → transportista | conductor |
 * | ficha de conductor | → sus transportistas | conductor |
 * | ficha de equipo | → transportista | conductor |
 *
 * ## La regla estaba escrita, dos veces
 *
 * `App\Support\Navigation`, sobre el menú:
 *
 * > un menú armado en el cliente enseñaría enlaces que el servidor va a rechazar
 * > con un 403, y **un enlace que no lleva a ningún sitio es peor que un enlace
 * > ausente** — el usuario no sabe si le falta un permiso o si algo está roto.
 *
 * Y `DocumentController::owner()`, que manda `href => null` a propósito para los
 * dueños sin pantalla:
 *
 * > Sin enlace se lee que no lo hay; con uno roto, que la pantalla está mal.
 *
 * Las dos piezas hacen lo correcto para lo suyo. Entre ellas quedaron los
 * enlaces de ficha a ficha, que nadie miró.
 *
 * ## Por qué el permiso sale del mismo sitio que el del menú
 *
 * Porque son la misma pregunta —«¿puede este actor abrir esta pantalla?»— y dos
 * listas que la contestan por separado acaban contestando distinto. Aquí se
 * declara el permiso de cada destino y un guardián comprueba que coincide con el
 * que `Navigation` exige para esa misma ruta.
 *
 * ## Sin ámbito, a propósito
 *
 * Se comprueba el PERMISO, no el alcance sobre esa fila concreta. Un despachador
 * con `carrier:read` de alcance asignado puede tener delante la ficha de una
 * carga cuyo transportista no lleva él, y ese enlace le dará 403.
 *
 * Resolver eso exigiría consultar la pertenencia de cada destino al pintar cada
 * ficha —una consulta por enlace— y el caso es raro. Lo que este lote compra es
 * lo otro: que un rol que NUNCA puede abrir una pantalla no vea nunca su enlace.
 * Queda declarado en `SIN_AMBITO` y hay un guardián que lo mantiene dicho.
 */
final class CrossLink
{
    /**
     * destino => [permiso que hace falta, plantilla de la ruta]
     *
     * La plantilla lleva un `%s` y nada más: construir la ruta aquí evita que
     * cada pantalla se invente la suya, que es como `/equipment/trucks/{id}` y
     * `/equipment/{type}/{id}` acabaron conviviendo.
     *
     * @var array<string, array{0: string, 1: string}>
     */
    public const DESTINOS = [
        'customer' => ['customer:read', '/customers/%s'],
        'carrier' => ['carrier:read', '/carriers/%s'],
        'driver' => ['driver:read', '/drivers/%s'],
        'load' => ['load:read', '/loads/%s'],
        'truck' => ['equipment:read', '/equipment/trucks/%s'],
        'trailer' => ['equipment:read', '/equipment/trailers/%s'],
    ];

    /**
     * Lo que este lote NO resuelve, y por qué.
     *
     * @var array<string, string>
     */
    public const SIN_AMBITO = [
        'assigned' => 'Se comprueba el permiso, no el alcance sobre esa fila. Un despachador con carrier:read de alcance asignado puede ver el enlace de un transportista que no lleva él, y ese enlace dará 403. Resolverlo exige una consulta de pertenencia por cada enlace de cada ficha; lo que se compra aquí es que un rol que NUNCA puede abrir una pantalla no vea nunca su enlace.',
    ];

    /**
     * La ruta a esa ficha, o `null` si quien mira no puede abrirla.
     *
     * Devolver `null` y no una cadena vacía es deliberado: la pantalla pregunta
     * `href ? <Link> : <span>` y un vacío se colaría como enlace a la raíz.
     */
    public static function para(
        PermissionChecker $checker,
        Actor $actor,
        string $destino,
        mixed $id,
        ?array $policy = null,
    ): ?string {
        if (! isset(self::DESTINOS[$destino]) || $id === null || (string) $id === '') {
            return null;
        }

        [$permiso, $plantilla] = self::DESTINOS[$destino];

        if (! $checker->can($actor, $permiso, null, $policy)->allowed) {
            return null;
        }

        return sprintf($plantilla, (string) $id);
    }
}
