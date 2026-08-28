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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA MIGRACIÓN SE PUEDE VOLVER A EJECUTAR
 *
 * MySQL no tiene DDL transaccional. Laravel manda un `alter table` POR COLUMNA,
 * así que una migración que muera a mitad deja la mitad de las columnas puestas
 * y no se registra en `migrations` — y al reintentarla, la primera columna que
 * ya existe la mata con un 1060.
 *
 * Eso fue exactamente lo que pasó en el despliegue del 28 de agosto. La salida
 * no es adivinar dónde se quedó: es que cada paso mire antes si ya está hecho.
 * Doce columnas, dos CHECK, tres claves ajenas y un índice, cada uno con su
 * comprobación. Ejecutarla dos veces seguidas da el mismo resultado que
 * ejecutarla una.
 * ────────────────────────────────────────────────────────────────────────────
 */
return new class extends Migration
{
    /**
     * columna => definición SQL, en el orden en que se añaden.
     *
     * @var array<string, string>
     */
    private array $columnas = [
        'twic_card' => "tinyint(1) not null default '0' after `endorsements`",
        'twic_number_last4' => 'varchar(4) null after `twic_card`',
        'twic_expires_at' => 'datetime(3) null after `twic_number_last4`',
        'twic_verified_at' => 'datetime(3) null after `twic_expires_at`',
        'twic_verified_by_user_id' => 'char(36) null after `twic_verified_at`',
        'work_authorization' => 'varchar(30) null after `twic_verified_by_user_id`',
        'work_authorization_verified_at' => 'datetime(3) null after `work_authorization`',
        'work_authorization_verified_by_user_id' => 'char(36) null after `work_authorization_verified_at`',
        'record_clean_years' => 'tinyint unsigned null after `work_authorization_verified_by_user_id`',
        'record_checked_at' => 'datetime(3) null after `record_clean_years`',
        'record_verified_by_user_id' => 'char(36) null after `record_checked_at`',
        'record_notes' => 'text null after `record_verified_by_user_id`',
    ];

    public function up(): void
    {
        foreach ($this->columnas as $columna => $definicion) {
            if (Schema::hasColumn('drivers', $columna)) {
                continue;
            }

            DB::statement("alter table `drivers` add `{$columna}` {$definicion}");
        }

        if (! $this->tieneRestriccion('chk_drivers_work_authorization')) {
            DB::statement("
                alter table drivers
                add constraint chk_drivers_work_authorization
                check (`work_authorization` is null or `work_authorization` in (
                    'us_citizen','permanent_resident','employment_authorization','other'
                ))
            ");
        }

        // Cero es «se miró y hay algo dentro del último año», que NO es lo mismo
        // que NULL, que es «no se ha mirado». Treinta y uno significa «más de
        // treinta»: la lista del formulario acaba ahí.
        if (! $this->tieneRestriccion('chk_drivers_record_clean_years')) {
            DB::statement('
                alter table drivers
                add constraint chk_drivers_record_clean_years
                check (`record_clean_years` is null or `record_clean_years` between 0 and 31)
            ');
        }

        foreach ([
            'twic_verified_by_user_id' => 'fk_drivers_twic_verified_by_user',
            'work_authorization_verified_by_user_id' => 'fk_drivers_work_auth_verified_by_user',
            'record_verified_by_user_id' => 'fk_drivers_record_verified_by_user',
        ] as $columna => $nombre) {
            if ($this->tieneRestriccion($nombre)) {
                continue;
            }

            // `set null` y no `cascade`: que un usuario se dé de baja no puede
            // borrar al conductor cuyo TWIC verificó. Se pierde el nombre, no
            // el hecho — y la pista de auditoría sigue teniéndolo.
            DB::statement("
                alter table drivers
                add constraint {$nombre}
                foreign key ({$columna}) references users (id) on delete set null
            ");
        }

        if (! $this->tieneIndice('drivers_twic_expiry_idx')) {
            DB::statement('create index drivers_twic_expiry_idx on drivers (tenant_id, twic_expires_at)');
        }
    }

    /** CHECK o clave ajena, que en information_schema viven en la misma tabla. */
    private function tieneRestriccion(string $nombre): bool
    {
        return DB::table('information_schema.table_constraints')
            ->where('constraint_schema', DB::getDatabaseName())
            ->where('table_name', 'drivers')
            ->where('constraint_name', $nombre)
            ->exists();
    }

    private function tieneIndice(string $nombre): bool
    {
        return DB::table('information_schema.statistics')
            ->where('table_schema', DB::getDatabaseName())
            ->where('table_name', 'drivers')
            ->where('index_name', $nombre)
            ->exists();
    }

    public function down(): void
    {
        if ($this->tieneIndice('drivers_twic_expiry_idx')) {
            DB::statement('drop index drivers_twic_expiry_idx on drivers');
        }

        foreach ([
            'fk_drivers_twic_verified_by_user',
            'fk_drivers_work_auth_verified_by_user',
            'fk_drivers_record_verified_by_user',
        ] as $nombre) {
            if ($this->tieneRestriccion($nombre)) {
                DB::statement("alter table drivers drop foreign key {$nombre}");
            }
        }

        foreach (['chk_drivers_record_clean_years', 'chk_drivers_work_authorization'] as $nombre) {
            if ($this->tieneRestriccion($nombre)) {
                DB::statement("alter table drivers drop check {$nombre}");
            }
        }

        $presentes = array_values(array_filter(
            array_keys($this->columnas),
            fn (string $c): bool => Schema::hasColumn('drivers', $c),
        ));

        if ($presentes !== []) {
            Schema::table('drivers', function (Blueprint $table) use ($presentes): void {
                $table->dropColumn($presentes);
            });
        }
    }
};
