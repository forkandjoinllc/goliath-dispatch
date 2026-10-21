<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Con QUIÉN hace factoring un transportista, según él mismo.
 *
 * ## La pregunta que se hacía y no se guardaba
 *
 * El alta pública tiene desde siempre una casilla «I factor my invoices» que
 * escribe `carriers.uses_factoring`. Y ahí se acaba: nunca se pregunta con
 * quién. La casa de despacho se queda con una fila que dice «sí, hace
 * factoring» y no dice con quién, que es la que luego nadie sabe explicar.
 *
 * En goliathdispatch.com es peor. Allí no hay empresa a la que pertenecer, así
 * que no se crea `carriers` sino `leads` —y `leads` no tiene la columna—. La
 * respuesta no es que se guarde a medias: es que se tira entera. La persona
 * marcó una casilla que no fue a ningún sitio.
 *
 * ## Declarado no es asignado, y por eso son columnas aparte
 *
 * `factoring_assignments` ya existe y ya es la asignación de verdad: tiene
 * fechas de vigencia, la carta de cesión, el cambio de beneficiario, quién lo
 * verificó y cuándo. `CarrierController::syncFactoring()` la mantiene, y hay un
 * comentario en ese fichero que dice que la asignación vive ahí y NO en una
 * columna de `carriers`. Sigue siendo verdad, y esta migración no lo cambia.
 *
 * Lo que estas columnas guardan es otra cosa: lo que un DESCONOCIDO escribió en
 * un formulario público. Un tercero que rellena un alta no puede establecer una
 * relación verificada con una empresa de factoring —no la verifica él, la
 * verifica la casa de despacho, que para eso tiene `verification_status`—. Si
 * el alta creara la asignación directamente, la fila nacería diciendo que
 * existe un vínculo que nadie ha comprobado.
 *
 * Así que el alta anota la DECLARACIÓN, el panel la enseña, y pasar de
 * declaración a asignación es un acto de la casa: abrir la ficha y guardar.
 *
 * ## Las dos columnas, y por qué dos
 *
 * `factoring_declared_company_id` cuando la empresa estaba en la lista de la
 * casa, `factoring_declared_name` cuando no estaba y el transportista escribió
 * el nombre a mano. Nunca las dos: un nombre suelto y una ficha son dos
 * respuestas a la misma pregunta.
 *
 * El texto se CONSERVA aunque después alguien cree la ficha y la enlace, igual
 * que `trucks.lessor_name` se quedó cuando llegó `lessor_vendor_id` en el lote
 * 41. Vaciarlo al enlazar borraría en silencio lo único que el transportista
 * llegó a decir, a cambio de nada.
 *
 * ## Lo que la base impide, y lo que NO
 *
 * Impide el estado imposible estrecho: si no hace factoring no puede haber ni
 * ficha ni nombre, y nunca hay ficha y nombre a la vez.
 *
 * NO impide —ni puede— que `uses_factoring = 1` y no haya ninguna de las dos.
 * Esa comprobación cruzaría con `factoring_assignments`, que es otra tabla, y
 * un CHECK no mira otras tablas. Además hay un caso legítimo: un despachador
 * marca la casilla en el panel porque sabe que el transportista hace factoring
 * y todavía no sabe con quién. Lo que se hace con ese estado es ENSEÑARLO
 * —la ficha dice «hace factoring, sin empresa»— en vez de fingir que la base lo
 * ha prevenido.
 *
 * La aislación entre empresas sí es de la base: la clave foránea es compuesta
 * contra `(tenant_id, id)`, igual que `fk_carrier_settlements_factoring_company_xt`.
 * Un identificador de la lista de OTRA empresa no entra aunque alguien lo pegue
 * en la petición.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── Transportistas: lo que declaró quien se dio de alta ──────────────
        Schema::table('carriers', function (Blueprint $table): void {
            $table->uuid('factoring_declared_company_id')->nullable()->after('uses_factoring');
            $table->string('factoring_declared_name', 200)->nullable()->after('factoring_declared_company_id');
            $table->index(['tenant_id', 'factoring_declared_company_id'], 'idx_carriers_factoring_declared');
        });

        DB::statement(
            'alter table `carriers`
             add constraint `fk_carriers_factoring_declared_xt`
             foreign key (`tenant_id`, `factoring_declared_company_id`)
             references `factoring_companies` (`tenant_id`, `id`) on delete restrict'
        );

        DB::statement(
            'alter table `carriers` add constraint `chk_carriers_factoring_declared`
             check (
               (`uses_factoring` = 1 or (`factoring_declared_company_id` is null and `factoring_declared_name` is null))
               and (`factoring_declared_company_id` is null or `factoring_declared_name` is null)
             )'
        );

        // ── Prospectos: la misma respuesta, para cuando no hay transportista ─
        //
        // `leads.tenant_id` es NULLABLE a propósito (un alta en el sitio de la
        // plataforma no pertenece a ninguna empresa). En una clave foránea
        // compuesta, MySQL da por buena la fila en cuanto una de las columnas es
        // NULL, así que esos prospectos pasan sin FK y los de una empresa sí se
        // comprueban. Es exactamente el comportamiento que hace falta.
        Schema::table('leads', function (Blueprint $table): void {
            $table->boolean('uses_factoring')->default(false)->after('mc_number');
            $table->uuid('factoring_company_id')->nullable()->after('uses_factoring');
            $table->string('factoring_company_name', 200)->nullable()->after('factoring_company_id');
            $table->index(['tenant_id', 'factoring_company_id'], 'idx_leads_factoring');
        });

        DB::statement(
            'alter table `leads`
             add constraint `fk_leads_factoring_company_xt`
             foreign key (`tenant_id`, `factoring_company_id`)
             references `factoring_companies` (`tenant_id`, `id`) on delete restrict'
        );

        DB::statement(
            'alter table `leads` add constraint `chk_leads_factoring`
             check (
               (`uses_factoring` = 1 or (`factoring_company_id` is null and `factoring_company_name` is null))
               and (`factoring_company_id` is null or `factoring_company_name` is null)
             )'
        );
    }

    public function down(): void
    {
        DB::statement('alter table `leads` drop constraint `chk_leads_factoring`');
        DB::statement('alter table `leads` drop foreign key `fk_leads_factoring_company_xt`');

        Schema::table('leads', function (Blueprint $table): void {
            $table->dropIndex('idx_leads_factoring');
            $table->dropColumn(['uses_factoring', 'factoring_company_id', 'factoring_company_name']);
        });

        DB::statement('alter table `carriers` drop constraint `chk_carriers_factoring_declared`');
        DB::statement('alter table `carriers` drop foreign key `fk_carriers_factoring_declared_xt`');

        Schema::table('carriers', function (Blueprint $table): void {
            $table->dropIndex('idx_carriers_factoring_declared');
            $table->dropColumn(['factoring_declared_company_id', 'factoring_declared_name']);
        });
    }
};
