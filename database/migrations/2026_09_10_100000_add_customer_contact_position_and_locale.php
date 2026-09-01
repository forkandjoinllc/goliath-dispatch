<?php

declare(strict_types=1);

use App\Enums\CustomerContactPosition;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * El idioma del cliente final y el cargo de sus contactos.
 *
 * ## El idioma
 *
 * `carriers` y `carrier_contacts` lo tienen desde el lote 34, y `drivers` desde
 * el principio. `customers` y `customer_contacts` no, y la asimetría no tenía
 * ninguna razón de ser: al cliente se le escribe igual que a los demás — hoy el
 * enlace de rastreo al despachar, mañana lo que venga.
 *
 * La consecuencia cabe en una frase: una casa de despacho que trabaja en inglés
 * le manda el enlace en inglés a sus tres clientes hispanohablantes, porque lo
 * único que había para decidir era `tenants.default_locale`. Está escrito como
 * pendiente en `docs/tracking-link.md` desde que se construyó el envío.
 *
 * Va POR PERSONA y no por empresa, igual que en los transportistas: el dueño
 * puede llevar el negocio en inglés y quien recibe los avisos de carga leer solo
 * español. `customers.preferred_locale` queda como ESPEJO del contacto
 * principal, que es el papel que juega `carriers.preferred_locale`.
 *
 * ## El cargo
 *
 * La columna existía como `varchar(120)` de texto libre. Pasa a lista cerrada
 * porque ahora DECIDE algo: el enlace de rastreo va a quien espera la carga y la
 * factura a quien la paga, y eso no se puede elegir sobre un campo donde caben
 * «tráfico», «Trafico» y «OPS» a la vez. Ver App\Enums\CustomerContactPosition.
 *
 * Las filas que existan se llevan a `other`, que es exactamente lo que se sabe
 * de ellas — hoy no hay ninguna, porque hasta este lote no había forma de crear
 * un contacto de cliente.
 *
 * ## Por qué `en` por omisión y no nulo
 *
 * Un nulo obligaría a cada sitio de lectura a decidir qué hacer con él, y a la
 * tercera copia de esa decisión una se separa. `en` es el mismo valor que ya
 * usaba el respaldo: ninguna fila existente cambia de comportamiento.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table): void {
            $table->string('preferred_locale', 2)->default('en')->after('email_normalized');
        });

        Schema::table('customer_contacts', function (Blueprint $table): void {
            $table->string('preferred_locale', 2)->default('en')->after('position');
        });

        // Antes de estrechar la columna, poner dentro de la lista lo que haya.
        // Sin esto el CHECK lo rechaza la base entera y la migración muere a la
        // mitad en cualquier instalación con datos.
        $permitidos = CustomerContactPosition::values();

        DB::table('customer_contacts')
            ->where(function ($q) use ($permitidos): void {
                $q->whereNull('position')->orWhereNotIn('position', $permitidos);
            })
            ->update(['position' => CustomerContactPosition::Other->value]);

        DB::statement('alter table customer_contacts modify `position` varchar(30) not null default \'other\'');

        // Los CHECK van en SQL crudo: el esquema usa CHECK y no ENUM (ver
        // docs/mysql-port.md), y un valor fuera de la lista no daría un error
        // sino un desplegable con una opción fantasma.
        $lista = "'".implode("','", $permitidos)."'";

        DB::statement("
            alter table customer_contacts
            add constraint chk_customer_contacts_position
            check (`position` in ({$lista}))
        ");

        foreach (['customers', 'customer_contacts'] as $tabla) {
            DB::statement("
                alter table {$tabla}
                add constraint chk_{$tabla}_preferred_locale
                check (`preferred_locale` in ('en','es'))
            ");
        }
    }

    public function down(): void
    {
        foreach (['customers', 'customer_contacts'] as $tabla) {
            DB::statement("alter table {$tabla} drop check chk_{$tabla}_preferred_locale");
        }

        DB::statement('alter table customer_contacts drop check chk_customer_contacts_position');
        DB::statement('alter table customer_contacts modify `position` varchar(120) null');

        Schema::table('customers', fn (Blueprint $table) => $table->dropColumn('preferred_locale'));
        Schema::table('customer_contacts', fn (Blueprint $table) => $table->dropColumn('preferred_locale'));
    }
};
