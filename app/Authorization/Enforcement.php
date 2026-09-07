<?php

declare(strict_types=1);

namespace App\Authorization;

/**
 * Qué permisos NO gobiernan nada, y por qué.
 *
 * ## El defecto
 *
 * Doce claves de `Permissions::ALL` estaban repartidas en `RoleMatrix` y
 * **ningún código las consultaba jamás**. Un permiso que nadie comprueba no es
 * una línea de más: es una frontera dibujada en un mapa que el terreno no
 * tiene, y `RoleMatrix` es exactamente el mapa que lee un administrador para
 * decidir a quién le da qué rol.
 *
 * El peor caso era `document:delete`. La matriz se lo da SOLO al admin. La
 * acción que quita un documento del expediente de una carga autorizaba contra
 * `load:document:upload`, que tienen el admin, el despachador, el transportista
 * **y el conductor**. La frontera real era cuatro roles más ancha que la
 * dibujada, y encima el botón «Quitar» no llevaba ninguna comprobación en el
 * cliente: no era «escondido en el navegador y abierto en el servidor», estaba
 * abierto en los dos.
 *
 * ## Las dos clases, y por qué se tratan distinto
 *
 * **Los que gobiernan algo real** se han conectado: hay una acción, tiene que
 * comprobar el permiso que dice su nombre. Eso cambia comportamiento y está
 * dicho en `docs/permission-enforcement.md`.
 *
 * **Los que no nombran nada que exista** se quedan, y se anotan aquí. NO se
 * borran. Ya me equivoqué una vez recomendando quitar nueve diccionarios
 * «muertos» que estaban ahí a propósito: comprobé el hecho y no comprobé si
 * alguien lo había decidido antes. Una clave sin uso puede ser vocabulario
 * reservado para algo que aún no se ha construido, y borrarla obliga a
 * reinventarla —con otro nombre— cuando se construya.
 *
 * Lo que sí se cierra es el agujero de que aparezcan NUEVOS sin que nadie se
 * entere: `tests/Unit/Suite/PermissionEnforcementTest` exige que toda clave de
 * `Permissions::ALL` o se consulte en el código, o esté en esta lista con su
 * motivo escrito.
 */
final class Enforcement
{
    /**
     * Permisos que hoy no comprueba nadie, con el motivo.
     *
     * Añadir una clave aquí es una decisión, no un trámite: se está diciendo
     * que ese permiso aparece en la matriz sin gobernar nada, y que se sabe.
     *
     * @var array<string, string>
     */
    public const SIN_APLICAR = [
        /* ── No existe la acción que nombran ─────────────────────────────── */

        'platform:impersonate' => 'No hay ruta de suplantación. Cuando la haya, este permiso es el que la tiene que guardar — y es de los que conviene que exista ANTES que la función.',
        'platform:tenant:create' => 'Las empresas se crean por el alta pública y por el sembrador; no hay ruta de plataforma que las cree.',
        'platform:tenant:support_access' => 'No hay sesión de acceso de soporte. Igual que la suplantación: el permiso está reservado a propósito.',

        'equipment:type:manage' => 'Los tipos de equipo son un enum del código, no filas que se editen. `equipment/{type}` usa el tipo como filtro, no como algo que se gestione.',
        'expense:category:manage' => 'Las categorías de gasto las siembra DefaultExpenseCategories y no hay pantalla para editarlas.',
        'message:template:manage' => 'Las únicas plantillas que existen son las de FIRMA, y esas tienen sus propias claves `signature:template:*`, que sí se comprueban.',
        'route:calculate' => 'No hay cálculo de rutas ni proveedor de millaje conectado.',

        'tenant:impersonate' => 'No hay ruta de suplantación dentro de la empresa, igual que en la plataforma. Reservado a propósito: el permiso conviene que exista antes que la función.',

        'tenant:integration:read' => 'La pantalla de conexiones con proveedores externos no existe: hay tabla `integration_connections`, modelo y 28 claves de diccionario en tracking.json, y ni controlador ni ruta. Estos dos permisos son la mitad que YA está hecha de esa función.',
        'tenant:integration:update' => 'Lo mismo. Cuando se construya la pantalla, estos dos son los que la tienen que guardar — y por eso no se borran.',

        /* ── Genéricos a los que un específico les quitó el trabajo ──────── */

        'finance:read' => 'Lo hacen los específicos, que sí se comprueban: invoice:read, settlement:read, payment:read, load:financials:read.',
        'finance:update' => 'Igual: load:financials:update y los suyos. Un permiso ancho que nadie mira junto a otros estrechos que sí se miran es peor que no tenerlo.',

        /* ── Nombra una acción que hace otro ─────────────────────────────── */

        'signature:sign' => 'La ceremonia de firma es un enlace público SIN sesión: el token es la autorización y no hay actor contra el que comprobar un permiso. Que el firmante pueda no tener cuenta es una decisión deliberada de esa función, no un descuido.',

        'invoice:pay' => 'El transportista no paga desde dentro: el enlace público de factura no lleva sesión, así que ahí no hay actor contra el que comprobar nada. Y el registro de un cobro por parte de la casa lo guarda `payment:record`, que sí se comprueba.',
    ];

    /** @return list<string> */
    public static function sinAplicar(): array
    {
        return array_keys(self::SIN_APLICAR);
    }
}
