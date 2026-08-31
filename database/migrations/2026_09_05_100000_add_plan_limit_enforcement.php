<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * `tenant_subscriptions.limits_enforced_at`: desde cuándo los topes del plan
 * BLOQUEAN, y no solo se cuentan.
 *
 * ## Por qué hace falta una columna y no basta con empezar a bloquear
 *
 * `saas_plans` trae `max_users`, `max_carriers` y `max_loads_per_month` desde el
 * primer día. La pantalla de suscripción los VENDE —«hasta 5 usuarios, 15
 * transportistas, 150 cargas al mes»— y hasta hoy no los leía nadie: se podían
 * crear los que fuera. Un plan cuyos topes son decorativos es una promesa falsa
 * en las dos direcciones: quien paga el plan grande no recibe nada a cambio, y
 * quien paga el pequeño usa lo que no ha comprado.
 *
 * Pero encenderlo de golpe para todos tiene un problema que ya estaba escrito en
 * Platform\TenantController: **hay empresas que llevan meses por encima del tope
 * sin saberlo**, porque nadie se lo ha enseñado nunca. Un despliegue que empieza
 * a bloquear altas convierte un martes cualquiera en una avería para un cliente
 * que no ha hecho nada mal. Eso no es aplicar una política: es cambiarle las
 * reglas a alguien a mitad de partida y sin avisar.
 *
 * Así que la columna guarda el MOMENTO en que esta empresa pasó a estar sujeta a
 * sus topes:
 *
 *  - **Nula** — se cuentan y se enseñan, y no bloquean nada. Es el estado de todo
 *    lo que ya existe.
 *  - **Con fecha** — bloquean. Las suscripciones nuevas nacen así: quien contrata
 *    hoy un plan que dice cinco usuarios recibe un plan de cinco usuarios, que es
 *    lo honesto.
 *
 * Y quien la enciende a mano no puede encenderla sobre una empresa que YA está
 * por encima: la pantalla de plataforma se niega y dice de qué recurso se trata.
 * Primero la conversación con el cliente, después el muro — nunca al revés.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('tenant_subscriptions', 'limits_enforced_at')) {
            return;
        }

        Schema::table('tenant_subscriptions', function (Blueprint $table): void {
            $table->dateTime('limits_enforced_at', 3)->nullable()->after('past_due_since');
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('tenant_subscriptions', 'limits_enforced_at')) {
            return;
        }

        Schema::table('tenant_subscriptions', function (Blueprint $table): void {
            $table->dropColumn('limits_enforced_at');
        });
    }
};
