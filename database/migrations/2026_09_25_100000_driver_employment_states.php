<?php

declare(strict_types=1);

use App\Enums\AuditAction;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Un conductor se puede parar, y se puede dar de baja.
 *
 * ## Dos estados que faltaban
 *
 * `drivers.status` tenía cuatro valores —disponible, en una carga, fuera de
 * servicio, inactivo— y ninguno dice lo que pasa de verdad en una flota:
 *
 * **En espera.** Se le para temporalmente: una investigación abierta, un
 * resultado pendiente, un papel que no llega. Vuelve.
 *
 * **Dado de baja.** Se acabó. Y con una decisión más que hay que tomar EN EL
 * MOMENTO, no dos años después cuando vuelva a presentarse: **¿se le volvería a
 * contratar?** Quien firma la baja es quien lo sabe, y si no se pregunta
 * entonces no lo sabe nadie.
 *
 * ## Por qué van en `status` y no en una columna aparte
 *
 * Porque «¿puede este conductor llevar una carga hoy?» es UNA pregunta. Dos
 * columnas de estado son dos respuestas, y el día que se contradigan —un
 * conductor «dado de baja» y «disponible»— ninguna pantalla sabrá cuál vale.
 * Quién puede trabajar lo decide `Support\Drivers\Employment`, en un solo
 * sitio, y de ahí lo leen las cuatro puertas que antes lo decidían cada una por
 * su cuenta.
 *
 * ## La nota no es opcional
 *
 * Ni al parar, ni al dar de baja, ni al volver a activar. Un cambio de estado
 * sin motivo escrito es una fila que dentro de un año nadie sabe explicar, y
 * estas tres son justo las que alguien va a tener que explicar.
 */
return new class extends Migration
{
    private const ESTADOS = "'available', 'on_load', 'off_duty', 'inactive', 'on_hold', 'terminated'";

    public function up(): void
    {
        DB::statement('alter table drivers drop constraint chk_drivers_status');
        DB::statement('alter table drivers add constraint chk_drivers_status check (status in ('.self::ESTADOS.'))');

        Schema::table('drivers', function (Blueprint $table): void {
            // Por qué está en ese estado, quién lo dijo y cuándo. La nota es
            // obligatoria al cambiarlo; la columna es nulable porque las fichas
            // que ya existen nunca pasaron por esa puerta.
            $table->text('status_note')->nullable()->after('status');
            $table->dateTime('status_changed_at', 3)->nullable()->after('status_note');
            $table->uuid('status_changed_by_user_id')->nullable()->after('status_changed_at');

            // Solo significa algo con la baja puesta: nulo es «no se ha dado de
            // baja», no «no se sabe». La diferencia importa el día que alguien
            // vuelva a presentarse.
            $table->boolean('rehire_eligible')->nullable()->after('status_changed_by_user_id');
        });

        DB::statement(
            'alter table drivers add constraint chk_drivers_rehire
             check (rehire_eligible is null or status = \'terminated\')'
        );

        // El suceso que deja constancia de quién lo cambió y por qué. La
        // restricción de `audit_events` enumera las acciones: una que no esté
        // en la lista la rechaza la base, que es donde se quiere que se
        // rechace — pero también quiere decir que añadir una acción es un
        // cambio de esquema y no una constante suelta.
        self::accionesDeAuditoria(true);
    }

    private const NUEVA_ACCION = 'driver.employment_changed';

    /**
     * Reescribe la lista de acciones permitidas DESDE EL ENUM.
     *
     * Y no leyendo la restricción que hay puesta: `AuditAction` es la lista de
     * verdad, la restricción es su copia en la base, y reconstruirla desde el
     * enum es lo que las mantiene iguales. Leer la vieja para añadirle una
     * dejaba que las dos se separaran sin que nadie lo notara.
     */
    private static function accionesDeAuditoria(bool $conLaNueva): void
    {
        $acciones = array_map(
            static fn (AuditAction $a): string => $a->value,
            AuditAction::cases(),
        );

        if (! $conLaNueva) {
            $acciones = array_values(array_diff($acciones, [self::NUEVA_ACCION]));
        }

        $lista = implode(', ', array_map(static fn (string $a): string => "'".$a."'", $acciones));

        // Se mira antes de quitarla. `drop constraint if exists` no existe en
        // todas las versiones de MySQL 8, y DDL no es transaccional: una
        // migración que falle a la mitad deja hecho lo de antes, y la de la
        // vuelta se encontraría una restricción que ya no está.
        $puesta = DB::table('information_schema.table_constraints')
            ->whereRaw('constraint_schema = database()')
            ->where('table_name', 'audit_events')
            ->where('constraint_name', 'audit_events_action_chk')
            ->exists();

        if ($puesta) {
            DB::statement('alter table audit_events drop constraint audit_events_action_chk');
        }
        DB::statement('alter table audit_events add constraint audit_events_action_chk check (action in ('.$lista.'))');
    }

    public function down(): void
    {
        DB::table('audit_events')->where('action', self::NUEVA_ACCION)->delete();
        self::accionesDeAuditoria(false);

        DB::statement('alter table drivers drop constraint chk_drivers_rehire');

        // Lo que estuviera parado o dado de baja vuelve a «inactivo», que es lo
        // más cerca que hay sin estas dos: dejarlo con un valor que la
        // restricción rechaza haría imposible volver atrás.
        DB::table('drivers')->whereIn('status', ['on_hold', 'terminated'])->update(['status' => 'inactive']);

        DB::statement('alter table drivers drop constraint chk_drivers_status');
        DB::statement("alter table drivers add constraint chk_drivers_status check (status in ('available', 'on_load', 'off_duty', 'inactive'))");

        Schema::table('drivers', function (Blueprint $table): void {
            $table->dropColumn(['status_note', 'status_changed_at', 'status_changed_by_user_id', 'rehire_eligible']);
        });
    }
};
