<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * El webhook del alta de transportista: a dónde se manda, y qué pasó.
 *
 * ## Las dos piezas, y por qué son dos
 *
 * `tenant_settings` gana la CONFIGURACIÓN —a dónde, con qué secreto, y si está
 * encendido—. `webhook_deliveries` guarda cada INTENTO.
 *
 * Un webhook sin registro de entregas es una promesa que nadie puede auditar:
 * falla en silencio durante meses y se descubre cuando falta medio CRM, y para
 * entonces ya no se puede reconstruir qué se perdió. Es la misma lección de
 * `CustomerLink`, que devuelve el MOTIVO y no un sí o un no.
 *
 * ## El secreto
 *
 * Es una credencial. Va cifrada en reposo, exactamente como el identificador
 * fiscal de un cliente o de un proveedor, y la columna NUNCA se ensancha a
 * texto claro. `..._secret_last4` existe para que la pantalla pueda decir CUÁL
 * secreto hay puesto sin enseñarlo: sin eso, la única forma de comprobar que se
 * guardó el correcto sería volver a leerlo, que es justo lo que no puede pasar.
 *
 * ## Lo que la base impide
 *
 * Encendido sin destino o sin secreto. Un webhook «activo» sin URL es una
 * casilla marcada que no manda nada, y uno sin secreto manda carga sin firmar a
 * un tercero que no puede comprobar que viene de nosotros.
 *
 * ## La URL y la carga viajan CONGELADAS en cada entrega
 *
 * `webhook_deliveries` guarda su propia `url` y su propio `payload` en vez de
 * mirarlos en los ajustes al reintentar. Si el administrador cambia el destino
 * a mitad de los reintentos, lo que ya estaba en cola sigue yendo a donde se
 * creó —y el registro dice a dónde fue de verdad, no a dónde apunta hoy la
 * configuración—. Un registro que miente sobre su propio destino no sirve para
 * auditar nada.
 *
 * ## Lo que esta migración NO crea
 *
 * Una tabla para anotar que el barrido corrió. Hacía falta —un planificador
 * parado es, desde la pantalla, indistinguible de «no ha pasado nada»— y ya
 * existe: `App\Support\Platform\ScheduledRuns` lo escribe en `job_queue`,
 * que es de donde sale la pantalla de salud de la plataforma. Una segunda tabla
 * habría sido una segunda respuesta a la misma pregunta.
 *
 * ## `sending` existe para que un reventón no esconda una entrega
 *
 * El barrido marca la fila antes de salir a la red. Si el proceso se cae con la
 * petición en vuelo, la fila se queda en `sending` para siempre salvo que algo
 * la devuelva: por eso el propio barrido rescata las que llevan demasiado
 * tiempo ahí. Sin ese rescate, una entrega perdida se queda perdida y en la
 * pantalla parece que sigue trabajando.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenant_settings', function (Blueprint $table): void {
            $table->string('carrier_signup_webhook_url', 500)->nullable()->after('signature_consent_copy');
            $table->text('carrier_signup_webhook_secret_encrypted')->nullable()->after('carrier_signup_webhook_url');
            $table->string('carrier_signup_webhook_secret_last4', 8)->nullable()->after('carrier_signup_webhook_secret_encrypted');
            $table->boolean('carrier_signup_webhook_enabled')->default(false)->after('carrier_signup_webhook_secret_last4');
        });

        DB::statement(
            'alter table `tenant_settings` add constraint `chk_tenant_settings_webhook_ready`
             check (
               `carrier_signup_webhook_enabled` = 0
               or (`carrier_signup_webhook_url` is not null and `carrier_signup_webhook_secret_encrypted` is not null)
             )'
        );

        Schema::create('webhook_deliveries', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');

            $table->string('event', 60);
            $table->string('subject_type', 40)->nullable();
            $table->uuid('subject_id')->nullable();

            // Congelados en el momento de crear la entrega: ver la cabecera.
            $table->string('url', 500);
            $table->json('payload');

            $table->string('status', 20)->default('pending');
            $table->unsignedInteger('attempts')->default(0);
            $table->unsignedInteger('max_attempts')->default(6);

            $table->dateTime('next_attempt_at', 3)->nullable();
            $table->dateTime('last_attempt_at', 3)->nullable();
            $table->dateTime('delivered_at', 3)->nullable();

            // Lo que contestó el otro lado. Truncado: un cuerpo de respuesta de
            // un megabyte no cabe en una pantalla ni ayuda a nadie.
            $table->unsignedSmallInteger('response_status')->nullable();
            $table->string('response_body', 500)->nullable();
            $table->string('error', 500)->nullable();

            // Un envío de prueba no es un alta. Se marca para que no se cuele
            // en «la última entrega real» ni haga creer que el flujo funcionó.
            $table->boolean('is_test')->default(false);

            $table->timestamps();

            $table->unique(['tenant_id', 'id'], 'webhook_deliveries_tenant_id_uq');
            $table->index(['tenant_id', 'created_at'], 'webhook_deliveries_tenant_created_idx');
            $table->index(['status', 'next_attempt_at'], 'webhook_deliveries_due_idx');
        });

        DB::statement(
            "alter table `webhook_deliveries` add constraint `chk_webhook_deliveries_status`
             check (`status` in ('pending','sending','delivered','failed','abandoned'))"
        );

        DB::statement(
            'alter table `webhook_deliveries`
             add constraint `fk_webhook_deliveries_tenant`
             foreign key (`tenant_id`) references `tenants` (`id`) on delete cascade'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('webhook_deliveries');

        DB::statement('alter table `tenant_settings` drop constraint `chk_tenant_settings_webhook_ready`');

        Schema::table('tenant_settings', function (Blueprint $table): void {
            $table->dropColumn([
                'carrier_signup_webhook_url',
                'carrier_signup_webhook_secret_encrypted',
                'carrier_signup_webhook_secret_last4',
                'carrier_signup_webhook_enabled',
            ]);
        });
    }
};
