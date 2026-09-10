<?php

declare(strict_types=1);

namespace App\Support\Privacy;

use App\Authorization\Actor;
use App\Enums\Role;

/**
 * Lo que el diccionario declara interno no sale del equipo.
 *
 * ## Por qué existe esto
 *
 * Dos campos del producto llevan escrita una promesa de confidencialidad en su
 * propia etiqueta:
 *
 * | Campo | Lo que dice la pantalla |
 * |---|---|
 * | `carriers.notes` | «Visibles para su equipo. No se le muestran al transportista.» |
 * | `loads.internal_notes` | «Solo para su equipo. Nunca se le muestran al transportista ni al cliente.» |
 *
 * Los dos salían en la respuesta que lee el transportista al abrir SU PROPIA
 * ficha y SU PROPIA carga. Medido: 200, y el texto dentro. En la carga era
 * peor, porque la pantalla pintaba `specialInstructions ?? internalNotes`: una
 * carga sin instrucciones para el conductor enseñaba las notas internas en el
 * hueco de las instrucciones, bajo un rótulo que dice «Notas» a secas.
 *
 * El resto de la familia sí cumplía: ni el enlace público de rastreo, ni la
 * factura pública, ni el papel de la tarifa emiten una sola nota. Las que
 * fallaban eran exactamente las dos que lo prometen por escrito.
 *
 * ## La regla
 *
 * No es un permiso: es de qué lado de la mesa está quien mira. El equipo de la
 * casa de despacho escribe estas notas; el transportista y el conductor son la
 * otra parte. Un permiso se puede conceder; el lado de la mesa no.
 *
 * Se decide por ROL y no por si el actor trae `carrierId`, porque un rol nuevo
 * tiene que obligar a decidir. `match` sin `default` revienta con
 * `\UnhandledMatchError` en cuanto alguien añada `Role::Customer`, y el
 * guardián lo dice antes con el nombre del rol que falta.
 *
 * ## Y no se manda escondido
 *
 * `soloEquipo()` devuelve `null`, no una cadena que React esconde. Es la misma
 * razón que ya está escrita en el bloque de dinero de la carga: mandarlo y
 * taparlo en la pantalla lo deja al alcance de cualquiera que abra las
 * herramientas del navegador.
 */
final class Internal
{
    /**
     * Campo => la clave del diccionario donde está escrita su promesa.
     *
     * Sirve de registro: el guardián comprueba que cada promesa sigue en los
     * dos idiomas y que el campo que la lleva sigue pasando por la puerta. Una
     * promesa que se borra sin quitar la nota, o una nota que se manda sin la
     * promesa, son las dos formas de que esto se descuadre.
     *
     * @var array<string, string>
     */
    public const DECLARADAS = [
        'carriers.notes' => 'carriers.form.notesHint',
        'loads.internal_notes' => 'loads.form.internalNotesHint',
    ];

    /**
     * La otra parte de la mesa. No es «menos permisos»: es otra empresa.
     *
     * @var list<Role>
     */
    public const CONTRAPARTES = [Role::Carrier, Role::Driver];

    /**
     * ¿Quien mira es del equipo de la casa de despacho?
     */
    public static function esEquipo(Actor $actor): bool
    {
        return match ($actor->role) {
            Role::PlatformSuperAdmin, Role::Admin, Role::Accounting, Role::Dispatcher => true,
            Role::Carrier, Role::Driver => false,
            null => false,
        };
    }

    /**
     * El valor si quien mira es del equipo; `null` si no.
     */
    public static function soloEquipo(Actor $actor, ?string $valor): ?string
    {
        return self::esEquipo($actor) ? $valor : null;
    }
}
