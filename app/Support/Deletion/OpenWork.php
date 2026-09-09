<?php

declare(strict_types=1);

namespace App\Support\Deletion;

use App\Support\Plural;
use Illuminate\Support\Facades\DB;

/**
 * Qué trabajo sin terminar cuelga de una ficha que alguien quiere borrar.
 *
 * ## El defecto
 *
 * La regla ya existía y estaba escrita entera —dentro de
 * `CustomerController::destroy`, en línea— con su motivo:
 *
 * > Un cliente con cargas vivas no se borra. No es una regla de conveniencia:
 * > la carga necesita saber a quién facturar, y un cliente borrado en mitad de
 * > un viaje deja una factura sin destinatario.
 *
 * Al transportista no se le aplicó nunca. Y el transportista es el que tiene el
 * camión en la carretera.
 *
 * Comprobado sobre los datos de demostración: se borró un transportista con una
 * carga en estado `in_transit`, sin ninguna negativa, y la ficha de esa carga
 * pasó a enseñar «—» donde va quién la lleva mientras la pantalla de rastreo
 * seguía nombrándolo. La aplicación decía dos cosas distintas sobre la misma
 * carga viva.
 *
 * Peor: el diálogo de confirmación del transportista es casi la misma frase que
 * el del cliente —«Las cargas y facturas históricas siguen nombrándolo»—, así
 * que prometía la garantía que el código del cliente sí da y el suyo no.
 *
 * ## Por qué una clase y no un `if` más
 *
 * Porque la regla estaba escrita una vez y se aplicó a una de las dos fichas
 * que se pueden borrar. Copiarla a la segunda deja dos copias que se separan;
 * lo que hace falta es que exista UN sitio donde se conteste la pregunta, y que
 * el guardián pueda exigir que todo borrado pase por él.
 *
 * ## Qué cuenta como «sin terminar»
 *
 * Para las dos fichas, una carga que no esté ni **pagada** ni **cancelada**:
 * son los dos únicos estados terminales de `loads.status`. Una carga entregada
 * y facturada sigue debiendo dinero a alguien.
 *
 * Del transportista, además, dos cosas que la carga no cubre:
 *
 *  - **Liquidaciones sin pagar** (`draft`, `issued`) — es dinero que se le
 *    debe. Una carga puede estar cobrada al cliente y su liquidación seguir sin
 *    emitir.
 *  - **Facturas con saldo** — es dinero que él debe. Se mira el saldo y no el
 *    estado: una factura `sent` con saldo cero está cobrada, y una `disputed`
 *    con saldo sigue viva.
 *
 * NO cuentan sus conductores ni sus equipos. No son trabajo abierto: son fichas
 * que quedan colgando, y eso es un problema distinto —y menor— que borrar a
 * quien está llevando una carga. Queda dicho en `docs/open-work.md`.
 */
final class OpenWork
{
    /**
     * Los dos únicos estados en los que una carga ya no debe nada a nadie.
     *
     * @var list<string>
     */
    public const CARGAS_CERRADAS = ['paid', 'cancelled'];

    /**
     * Liquidaciones que todavía no se han pagado ni anulado.
     *
     * @var list<string>
     */
    public const LIQUIDACIONES_ABIERTAS = ['draft', 'issued'];

    /**
     * El mensaje que se le enseña a quien intentó borrar.
     *
     * Dice QUÉ está abierto y cuánto, no solo que no se puede. Un «no se puede»
     * a secas manda a buscar; el mensaje de hoy del cliente ya lo hacía bien
     * —dice cuántas cargas y por qué importa— y esto lo generaliza a las tres
     * clases.
     *
     * La concordancia de número pasa por `Plural`, que es la misma regla que
     * aplica el cliente sobre el mismo diccionario JSON: sin eso, el mismo
     * texto saldría en singular en pantalla y en plural aquí.
     *
     * @param  array<string, int>  $abierto
     */
    public static function message(string $espacio, array $abierto): string
    {
        $trozos = array_map(
            static fn (string $clase, int $n): string => __(
                Plural::key("{$espacio}.openWork.{$clase}", $n),
                ['count' => $n],
            ),
            array_keys($abierto),
            $abierto,
        );

        return __("{$espacio}.openWork.cannotDelete", [
            'what' => implode(__('common.labels.listSeparator'), $trozos),
        ]);
    }

    /**
     * El trabajo sin terminar de un transportista.
     *
     * @return array<string, int> clase => cuántos, solo las que no son cero
     */
    public static function forCarrier(string $tenantId, string $carrierId): array
    {
        return array_filter([
            'loads' => DB::table('loads')
                ->where('tenant_id', $tenantId)
                ->where('carrier_id', $carrierId)
                ->whereNull('deleted_at')
                ->whereNotIn('status', self::CARGAS_CERRADAS)
                ->count(),

            'settlements' => DB::table('carrier_settlements')
                ->where('tenant_id', $tenantId)
                ->where('carrier_id', $carrierId)
                ->whereNull('deleted_at')
                ->whereIn('status', self::LIQUIDACIONES_ABIERTAS)
                ->count(),

            // Por saldo y no por estado: una factura `sent` con saldo cero está
            // cobrada, y una `disputed` con saldo sigue viva. `voided` se
            // excluye aparte porque una anulada puede conservar su saldo.
            'invoices' => DB::table('invoices')
                ->where('tenant_id', $tenantId)
                ->where('carrier_id', $carrierId)
                ->whereNull('deleted_at')
                ->where('status', '!=', 'voided')
                ->where('balance_cents', '>', 0)
                ->count(),
        ]);
    }

    /**
     * El trabajo sin terminar de un cliente.
     *
     * Solo cargas: un cliente no tiene liquidaciones, y sus facturas cuelgan de
     * la carga. Es la regla que ya estaba escrita en el controlador; aquí no
     * cambia, solo deja de estar suelta.
     *
     * @return array<string, int>
     */
    public static function forCustomer(string $tenantId, string $customerId): array
    {
        return array_filter([
            'loads' => DB::table('loads')
                ->where('tenant_id', $tenantId)
                ->where('customer_id', $customerId)
                ->whereNull('deleted_at')
                ->whereNotIn('status', self::CARGAS_CERRADAS)
                ->count(),
        ]);
    }
}
