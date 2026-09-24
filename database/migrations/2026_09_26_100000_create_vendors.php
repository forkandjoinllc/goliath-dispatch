<?php

declare(strict_types=1);

use App\Enums\VendorType;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Los proveedores: quién le da servicio a un transportista.
 *
 * ## Qué pregunta contesta, y por qué no la contestaba nada
 *
 * `trucks.lessor_name` y `trailers.lessor_name` existen desde el principio y
 * son TEXTO LIBRE. Quien da de alta una unidad arrendada escribe el nombre de
 * la arrendadora a mano, y la siguiente unidad la escribe otra vez —con una
 * coma de más, con «LLC» o sin él—. El resultado es que «¿qué unidades me
 * arrienda esta empresa?» no tiene respuesta, «¿a quién hay que llamar cuando
 * vence el contrato?» tampoco, y el mismo proveedor está escrito de tres
 * formas en la misma flota.
 *
 * Esta tabla es esa ficha: la arrendadora, el taller, la aseguradora, el
 * proveedor de combustible. Con sus contactos, sus condiciones de pago y lo
 * que le arrienda a quién.
 *
 * ## De la empresa, no del transportista
 *
 * Una arrendadora que trabaja con tres de tus transportistas es UNA ficha, no
 * tres. Por eso el proveedor cuelga del `tenant` y a quién sirve se anota
 * aparte, en `vendor_carriers`. Con una ficha por transportista, sus contactos
 * y sus datos fiscales se duplicarían con él, y al cambiar un teléfono habría
 * que acordarse de cambiarlo en tres sitios.
 *
 * Es lo mismo que ya hace `driver_carrier_relationships` con los conductores,
 * y por el mismo motivo.
 *
 * ## Lo que NO se borra
 *
 * `lessor_name` se queda donde está. La unidad gana una columna que APUNTA al
 * proveedor, y mientras no apunte a ninguno la pantalla enseña lo que hay
 * escrito diciendo que no tiene ficha. Vaciar esa columna al añadir la nueva
 * habría borrado en silencio el único dato que hoy existe sobre el arrendador
 * de cada unidad, a cambio de nada.
 *
 * ## El identificador fiscal
 *
 * Cifrado, con los cuatro últimos aparte, exactamente como en `customers`. No
 * se ensancha ninguna de las dos columnas a texto claro.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vendors', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');

            $table->string('company_name', 200);
            // Igual que en clientes: en minúsculas y sin puntuación, para que
            // «Ryder System, LLC» y «Ryder System LLC» choquen al dar de alta.
            $table->string('company_name_normalized', 200);
            $table->string('vendor_type', 24);

            $table->string('website', 255)->nullable();
            $table->string('phone', 32)->nullable();
            $table->string('phone_normalized', 20)->nullable();
            $table->string('email', 255)->nullable();
            $table->string('email_normalized', 255)->nullable();
            $table->string('preferred_locale', 5)->nullable();

            $table->string('line1', 200)->nullable();
            $table->string('line2', 200)->nullable();
            $table->string('city', 120)->nullable();
            $table->string('state', 3)->nullable();
            $table->string('country', 2)->nullable()->default('US');
            $table->string('postal_code', 12)->nullable();

            // Cifrado en reposo; solo se enseñan los cuatro últimos. No se
            // ensancha ninguna de las dos a texto claro.
            $table->text('tax_id_encrypted')->nullable();
            $table->string('tax_id_last4', 4)->nullable();
            $table->boolean('w9_on_file')->default(false);
            $table->date('w9_received_on')->nullable();

            $table->integer('payment_terms_days')->default(30);
            $table->string('payment_method', 24)->nullable();
            // Los CUATRO ÚLTIMOS y nada más. La cuenta entera no hace falta
            // para reconocer un pago en el extracto, y guardarla convertiría
            // esta tabla en algo que hay que proteger de otra manera.
            $table->string('account_last4', 4)->nullable();

            $table->string('status', 20)->default('active');
            $table->text('notes')->nullable();

            $table->timestamps();
            $table->softDeletes();
            $table->uuid('deleted_by')->nullable();
            $table->text('deletion_reason')->nullable();

            $table->unique(['tenant_id', 'id'], 'vendors_tenant_id_uq');
            $table->index(['tenant_id'], 'vendors_tenant_idx');
            $table->index(['tenant_id', 'company_name_normalized'], 'vendors_tenant_name_idx');
            $table->index(['tenant_id', 'status'], 'vendors_tenant_status_idx');
            $table->index(['tenant_id', 'vendor_type'], 'vendors_tenant_type_idx');
        });

        /*
         * Los dos vocabularios, en la base.
         *
         * El tipo y el estado se pintan traducidos, así que un valor que el
         * diccionario no conoce sale como una clave en crudo en pantalla. La
         * lista sale del enum para que la restricción y el desplegable no
         * puedan separarse — es lo mismo que hizo el lote 38 con las acciones
         * de auditoría, después de descubrir que leerla de la base no
         * funcionaba.
         */
        DB::statement(
            'alter table vendors add constraint chk_vendors_type check (vendor_type in ('
            .implode(', ', array_map(
                static fn (string $v): string => "'".$v."'",
                VendorType::values(),
            )).'))'
        );

        DB::statement(
            "alter table vendors add constraint chk_vendors_status
             check (status in ('active', 'inactive', 'archived'))"
        );

        DB::statement(
            'alter table vendors add constraint chk_vendors_terms
             check (payment_terms_days >= 0 and payment_terms_days <= 365)'
        );

        /*
         * La fecha del W-9 solo existe si hay W-9.
         *
         * Sin esto se puede guardar «no tenemos su W-9, recibido el 3 de
         * marzo», que es una fila que se lee de dos formas y ninguna es
         * verdad.
         */
        DB::statement(
            'alter table vendors add constraint chk_vendors_w9
             check (w9_on_file = 1 or w9_received_on is null)'
        );

        Schema::create('vendor_contacts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('vendor_id');

            $table->string('first_name', 100);
            $table->string('last_name', 100);
            $table->string('email', 255)->nullable();
            $table->string('phone', 32)->nullable();
            $table->string('phone_extension', 10)->nullable();
            $table->string('position', 120)->nullable();
            $table->string('preferred_locale', 5)->nullable();
            $table->boolean('is_primary')->default(false);
            $table->text('notes')->nullable();

            $table->timestamps();
            $table->softDeletes();
            $table->uuid('deleted_by')->nullable();
            $table->text('deletion_reason')->nullable();

            $table->unique(['tenant_id', 'id'], 'vendor_contacts_tenant_id_uq');
            $table->index(['tenant_id'], 'vendor_contacts_tenant_idx');
            $table->index(['vendor_id'], 'vendor_contacts_vendor_idx');
        });

        /*
         * Un solo contacto principal por proveedor, en la BASE.
         *
         * La misma columna generada que usa `customer_contacts`: vale el id
         * del proveedor cuando la fila es principal y está viva, y nulo en
         * cualquier otro caso. MySQL no considera duplicados los nulos, así
         * que el único choca exactamente donde tiene que chocar. STORED y no
         * VIRTUAL porque alimenta un índice único que se comprueba en cada
         * escritura.
         */
        DB::statement(
            'alter table vendor_contacts add column primary_contact_key char(36)
             as (case when is_primary = 1 and deleted_at is null then vendor_id end) stored'
        );

        DB::statement(
            'alter table vendor_contacts
             add constraint vendor_contacts_primary_uq unique (primary_contact_key)'
        );

        Schema::create('vendor_carriers', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('vendor_id');
            $table->uuid('carrier_id');
            $table->string('account_reference', 80)->nullable();
            $table->text('notes')->nullable();

            $table->timestamps();
            $table->softDeletes();
            $table->uuid('deleted_by')->nullable();
            $table->text('deletion_reason')->nullable();

            $table->unique(['tenant_id', 'id'], 'vendor_carriers_tenant_id_uq');
            $table->index(['tenant_id'], 'vendor_carriers_tenant_idx');
            $table->index(['vendor_id'], 'vendor_carriers_vendor_idx');
            $table->index(['carrier_id'], 'vendor_carriers_carrier_idx');
        });

        /*
         * Un proveedor no se ata dos veces al mismo transportista.
         *
         * Con la misma columna generada que el contacto principal, por la
         * misma razón: el par vive mientras la fila no esté borrada, y una
         * relación cerrada y vuelta a abrir tiene que poder existir junto a la
         * vieja.
         */
        DB::statement(
            'alter table vendor_carriers add column live_pair_key char(73)
             as (case when deleted_at is null then concat(vendor_id, \':\', carrier_id) end) stored'
        );

        DB::statement(
            'alter table vendor_carriers
             add constraint vendor_carriers_live_uq unique (live_pair_key)'
        );

        // La unidad APUNTA al proveedor. `lessor_name` se queda: ver arriba.
        foreach (['trucks', 'trailers'] as $tabla) {
            Schema::table($tabla, function (Blueprint $table) use ($tabla): void {
                $table->uuid('lessor_vendor_id')->nullable()->after('lessor_name');
                $table->index(['tenant_id', 'lessor_vendor_id'], 'idx_'.$tabla.'_lessor_vendor');
            });
        }

        // Y el gasto también, para poder preguntar qué se le ha pagado a quién.
        Schema::table('expenses', function (Blueprint $table): void {
            $table->uuid('vendor_id')->nullable()->after('carrier_id');
            $table->index(['tenant_id', 'vendor_id'], 'idx_expenses_vendor');
        });
    }

    public function down(): void
    {
        Schema::table('expenses', function (Blueprint $table): void {
            $table->dropIndex('idx_expenses_vendor');
            $table->dropColumn('vendor_id');
        });

        foreach (['trucks', 'trailers'] as $tabla) {
            Schema::table($tabla, function (Blueprint $table) use ($tabla): void {
                $table->dropIndex('idx_'.$tabla.'_lessor_vendor');
                $table->dropColumn('lessor_vendor_id');
            });
        }

        Schema::dropIfExists('vendor_carriers');
        Schema::dropIfExists('vendor_contacts');
        Schema::dropIfExists('vendors');
    }
};
