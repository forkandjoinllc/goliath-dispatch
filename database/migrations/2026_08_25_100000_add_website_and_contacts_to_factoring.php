<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * La web de la empresa de factoring, y sus contactos como filas.
 *
 * `factoring_companies` traía UN contacto en tres columnas sueltas
 * —`contact_name`, `email`, `phone`— y eso no aguanta el uso real. A una
 * empresa de factoring se le llama por cosas distintas y a personas distintas:
 * quien aprueba una carta de cesión no es quien persigue un cobro, y llamar al
 * de cobros para preguntar por una NOA hace perder media mañana. Por eso el
 * cargo va en la fila: es lo que responde «¿a quién llamo para esto?».
 *
 * Las tres columnas viejas NO se borran. Siguen ahí con lo que ya tuvieran, y la
 * pantalla nueva escribe en la tabla de contactos. Borrarlas exigiría migrar el
 * dato a ciegas y dejaría sin sitio a quien todavía las consulte.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('factoring_companies', function (Blueprint $table): void {
            $table->string('website', 255)->nullable()->after('name');
        });

        Schema::create('factoring_company_contacts', function (Blueprint $table): void {
            $table->char('id', 36)->primary();
            $table->char('tenant_id', 36);
            $table->char('factoring_company_id', 36);

            $table->string('first_name', 100);
            $table->string('last_name', 100);
            $table->string('email', 255)->nullable();
            $table->string('phone', 32)->nullable();

            // Guía para saber a quién llamar. Lista cerrada y no texto libre: con
            // texto libre acaban conviviendo «cobros», «Cobranzas» y «AR», y
            // entonces no sirve para filtrar ni para orientar a nadie.
            $table->string('position', 30);

            $table->text('notes')->nullable();

            $table->dateTime('created_at', 3)->useCurrent();
            $table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();
            $table->dateTime('deleted_at', 3)->nullable();
            $table->char('deleted_by', 36)->nullable();
            $table->text('deletion_reason')->nullable();

            $table->unique(['tenant_id', 'id'], 'factoring_company_contacts_tenant_id_uq');
            $table->index(['tenant_id', 'factoring_company_id'], 'factoring_company_contacts_company_idx');
        });

        // Aislamiento entre empresas por clave compuesta, igual que el resto del
        // esquema: un contacto no puede colgar de una empresa de factoring de
        // OTRA empresa cliente aunque alguien fabrique el identificador a mano.
        DB::statement('
            alter table factoring_company_contacts
            add constraint fk_factoring_company_contacts_company_xt
            foreign key (tenant_id, factoring_company_id)
            references factoring_companies (tenant_id, id)
            on delete cascade
        ');

        DB::statement('
            alter table factoring_company_contacts
            add constraint fk_factoring_company_contacts_tenant
            foreign key (tenant_id) references tenants (id) on delete cascade
        ');

        DB::statement("
            alter table factoring_company_contacts
            add constraint chk_factoring_company_contacts_position
            check (`position` in (
                'account_manager','funding','noa','collections','billing',
                'underwriting','operations','owner','other'
            ))
        ");
    }

    public function down(): void
    {
        Schema::dropIfExists('factoring_company_contacts');

        Schema::table('factoring_companies', function (Blueprint $table): void {
            $table->dropColumn('website');
        });
    }
};
