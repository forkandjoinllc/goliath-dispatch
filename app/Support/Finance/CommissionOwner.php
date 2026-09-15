<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Enums\Role;
use Illuminate\Support\Facades\DB;

/**
 * Quién gana la comisión de una carga — y si nadie, por qué.
 *
 * ## El defecto
 *
 * `loads.dispatcher_user_id` se escribía en UN sitio y una sola vez, al dar de
 * alta la carga:
 *
 * ```php
 * $load->dispatcher_user_id = $actor->role === Role::Dispatcher ? $actor->userId : null;
 * ```
 *
 * No había ninguna otra escritura en toda la aplicación: ni al asignar, ni al
 * editar, ni una pantalla donde cambiarla. Y la matriz de roles remata la
 * trampa: el ADMINISTRADOR puede crear cargas y no es despachador, así que toda
 * carga que meta él nace sin dueño de comisión; el despachador, que sí lo sería,
 * no puede tocar el dinero; y contabilidad, que puede tocarlo, no puede crear
 * cargas.
 *
 * Lo que pasaba entonces, y en este orden:
 *
 *  1. `Calculator` calcula la comisión igual —sale de `dispatcher_commission_bps`
 *     de la carga, que por omisión es la política de la empresa— y la congela en
 *     la instantánea al facturar.
 *  2. `LoadFinancials::netAfterCommission` la RESTA: el informe dice que la casa
 *     ganó menos.
 *  3. `CommissionLedger::accrue()` miraba la columna, la encontraba nula y
 *     **devolvía sin escribir nada, en silencio**.
 *
 * Resultado: una comisión descontada del margen que no se le debe a nadie,
 * ninguna fila que pagar, la pantalla de Comisiones vacía y ni un mensaje. La
 * pantalla de la carga, mientras tanto, enseña «Comisión del despachador −$X»
 * como si alguien fuera a cobrarlo.
 *
 * ## Por qué vive aquí
 *
 * Porque «quién la gana» estaba escrito en una asignación dentro de un método de
 * alta, y «qué pasa si no hay nadie» en un `return null` sin frase. Las dos
 * preguntas son la misma y ahora se contestan en un sitio, con el motivo escrito
 * al lado — que es lo que hace posible que la pantalla lo diga y que un guardián
 * lo vigile.
 */
final class CommissionOwner
{
    /**
     * Motivos por los que una carga puede acabar sin dueño de comisión.
     *
     * Declarados con su texto porque un hueco sin nombre se lee como un
     * descuido, y porque la pantalla tiene que poder explicarlo. Si mañana
     * aparece otro camino que deje la columna vacía, se declara aquí o el
     * guardián se pone en rojo.
     *
     * @var array<string, string>
     */
    public const SIN_DUENO = [
        'notSetAtCreation' => 'La carga no la creó un despachador —la creó un administrador, o entró por otra vía— y hasta este lote el dueño de la comisión solo se escribía en ese momento. Se asigna desde la carga, con permiso de finanzas.',
    ];

    /** El usuario que gana la comisión de esta carga, si hay alguno. */
    public static function deCarga(object $carga): ?string
    {
        $id = $carga->dispatcher_user_id ?? null;

        return $id === null || (string) $id === '' ? null : (string) $id;
    }

    /**
     * Por qué esta carga no tiene dueño de comisión.
     *
     * Devuelve null cuando sí lo tiene. Hoy solo hay un motivo, y tenerlo como
     * clave —en vez de como texto suelto— es lo que permite que la pantalla lo
     * traduzca y que el guardián compruebe que sigue estando declarado.
     */
    public static function porQueNoHayDueno(object $carga): ?string
    {
        return self::deCarga($carga) === null ? 'notSetAtCreation' : null;
    }

    /**
     * ¿Hay una comisión calculada que no se le va a devengar a nadie?
     *
     * Es la pregunta que nadie hacía. Una carga sin dueño y con comisión CERO no
     * es un problema —no hay nada que repartir—; con comisión distinta de cero
     * es dinero restado del margen que no tiene destinatario.
     */
    public static function comisionHuerfana(object $carga, int $comisionCents): bool
    {
        return $comisionCents > 0 && self::deCarga($carga) === null;
    }

    /**
     * Los despachadores de esta empresa que pueden ser dueños.
     *
     * Con membresía ACTIVA: dejar elegir a quien ya no trabaja aquí crea una
     * comisión que nadie va a reclamar, que es el defecto de arriba con otra
     * ropa.
     *
     * @return list<string>
     */
    public static function candidatos(string $tenantId): array
    {
        return DB::table('user_tenant_memberships')
            ->where('tenant_id', $tenantId)
            ->where('role', Role::Dispatcher->value)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->pluck('user_id')
            ->unique()
            ->values()
            ->map(static fn ($id): string => (string) $id)
            ->all();
    }
}
