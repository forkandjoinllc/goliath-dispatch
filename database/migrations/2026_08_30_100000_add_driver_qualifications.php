<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Lo que hace falta saber de un conductor para decidir si puede llevar UNA
 * carga concreta.
 *
 * No son atributos sueltos: son las respuestas a lo que preguntan las cargas.
 * Un almacén de la defensa pide TWIC; una carga de explosivos pide el
 * endorsement H; un contrato con una base militar puede exigir ciudadanía por
 * escrito; y muchos clientes piden un récord limpio de N años. Los endorsements
 * ya vivían en `drivers.endorsements`; lo demás no existía.
 *
 * TRES DECISIONES QUE NO SON DE ESTILO
 *
 *  • **Nada de esto se verifica solo.** La plataforma no consulta al TSA ni a
 *    un MVR: alguien mira el documento y deja constancia de que lo miró, con
 *    fecha y con su nombre. Por eso cada bloque lleva `..._verified_at` y
 *    `..._verified_by_user_id`, y por eso NO existe ninguna columna que diga
 *    «verificado» a secas. Ver docs/ — nunca afirmamos haber comprobado algo
 *    que no comprobamos.
 *
 *  • **`work_authorization` es NULLABLE y su valor por omisión es «no
 *    consta».** Es un dato sensible: solo se guarda cuando alguien lo registra
 *    a propósito, y el sistema no lo infiere ni lo exige para dar de alta a
 *    nadie. Filtrar cargas por este campo solo es defendible cuando la carga
 *    declara POR ESCRITO de dónde sale ese requisito; eso se guarda del lado de
 *    la carga, no aquí. Esto no es asesoramiento legal.
 *
 *  • **El récord limpio se guarda como «limpio en los últimos N años»**, no
 *    como una lista de incidentes. Es lo que preguntan los clientes y es lo
 *    único que el que mira el MVR puede afirmar sin copiarse el historial
 *    entero a una base de datos que se conserva siete años.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table): void {
            // ── TWIC ────────────────────────────────────────────────────────
            $table->boolean('twic_card')->default(false)->after('endorsements');
            $table->string('twic_number_last4', 4)->nullable()->after('twic_card');
            $table->dateTime('twic_expires_at', 3)->nullable()->after('twic_number_last4');
            $table->dateTime('twic_verified_at', 3)->nullable()->after('twic_expires_at');
            $table->char('twic_verified_by_user_id', 36)->nullable()->after('twic_verified_at');

            // ── Autorización de trabajo ─────────────────────────────────────
            $table->string('work_authorization', 30)->nullable()->after('twic_verified_by_user_id');
            $table->dateTime('work_authorization_verified_at', 3)->nullable()->after('work_authorization');
            $table->char('work_authorization_verified_by_user_id', 36)->nullable()->after('work_authorization_verified_at');

            // ── Récord ──────────────────────────────────────────────────────
            $table->unsignedTinyInteger('record_clean_years')->nullable()->after('work_authorization_verified_by_user_id');
            $table->dateTime('record_checked_at', 3)->nullable()->after('record_clean_years');
            $table->char('record_verified_by_user_id', 36)->nullable()->after('record_checked_at');
            $table->text('record_notes')->nullable()->after('record_verified_by_user_id');
        });

        // Solo el número de TWIC completo NO se guarda: se guardan los cuatro
        // últimos, igual que con la licencia y el EIN. Nadie necesita el número
        // entero para saber que la tarjeta existe y cuándo caduca.
        DB::statement("
            alter table drivers
            add constraint chk_drivers_work_authorization
            check (`work_authorization` is null or `work_authorization` in (
                'us_citizen','permanent_resident','employment_authorization','other'
            ))
        ");

        // Cero es «se miró y hay algo dentro del último año», que NO es lo mismo
        // que NULL, que es «no se ha mirado». Treinta y uno significa «más de
        // treinta»: la lista del formulario acaba ahí.
        DB::statement('
            alter table drivers
            add constraint chk_drivers_record_clean_years
            check (`record_clean_years` is null or `record_clean_years` between 0 and 31)
        ');

        foreach ([
            'twic_verified_by_user_id' => 'fk_drivers_twic_verified_by_user',
            'work_authorization_verified_by_user_id' => 'fk_drivers_work_auth_verified_by_user',
            'record_verified_by_user_id' => 'fk_drivers_record_verified_by_user',
        ] as $columna => $nombre) {
            // `set null` y no `cascade`: que un usuario se dé de baja no puede
            // borrar al conductor cuyo TWIC verificó. Se pierde el nombre, no
            // el hecho — y la pista de auditoría sigue teniéndolo.
            DB::statement("
                alter table drivers
                add constraint {$nombre}
                foreign key ({$columna}) references users (id) on delete set null
            ");
        }

        DB::statement('create index drivers_twic_expiry_idx on drivers (tenant_id, twic_expires_at)');
    }

    public function down(): void
    {
        DB::statement('drop index drivers_twic_expiry_idx on drivers');

        foreach ([
            'fk_drivers_twic_verified_by_user',
            'fk_drivers_work_auth_verified_by_user',
            'fk_drivers_record_verified_by_user',
        ] as $nombre) {
            DB::statement("alter table drivers drop foreign key {$nombre}");
        }

        DB::statement('alter table drivers drop check chk_drivers_record_clean_years');
        DB::statement('alter table drivers drop check chk_drivers_work_authorization');

        Schema::table('drivers', function (Blueprint $table): void {
            $table->dropColumn([
                'twic_card', 'twic_number_last4', 'twic_expires_at',
                'twic_verified_at', 'twic_verified_by_user_id',
                'work_authorization', 'work_authorization_verified_at',
                'work_authorization_verified_by_user_id',
                'record_clean_years', 'record_checked_at',
                'record_verified_by_user_id', 'record_notes',
            ]);
        });
    }
};
