<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * El cargo y el idioma de cada contacto del transportista.
 *
 * El cargo responde «¿a quién llamo para esto?», que es lo único que hace útil
 * una lista de cinco personas. Lista cerrada; ver App\Enums\CarrierContactPosition.
 *
 * El idioma es POR PERSONA y no por empresa. El dueño puede llevar el negocio en
 * inglés y el de guardia contestar solo en español; mandarle a este último un
 * aviso de carga en inglés a las tres de la mañana es la manera más rápida de
 * que no lo lea. `carriers.preferred_locale` se queda como está y pasa a ser el
 * espejo del contacto principal, igual que las otras cuatro columnas.
 *
 * Las dos columnas nacen NOT NULL con valor por omisión: las filas que ya
 * existan —las que retrollenó la migración anterior— quedan en `other` / `en`,
 * que es exactamente lo que se sabía de ellas.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('carrier_contacts', function (Blueprint $table): void {
            $table->string('position', 30)->default('other')->after('phone');
            $table->string('preferred_locale', 2)->default('en')->after('position');
        });

        // Los CHECK van en SQL crudo: el esquema usa CHECK y no ENUM (ver
        // docs/mysql-port.md), y un valor fuera de la lista aquí no daría un
        // error sino un desplegable con una opción fantasma.
        DB::statement("
            alter table carrier_contacts
            add constraint chk_carrier_contacts_position
            check (`position` in (
                'owner','dispatch','safety','compliance','billing',
                'driver_manager','maintenance','after_hours','other'
            ))
        ");

        DB::statement("
            alter table carrier_contacts
            add constraint chk_carrier_contacts_preferred_locale
            check (`preferred_locale` in ('en','es'))
        ");
    }

    public function down(): void
    {
        DB::statement('alter table carrier_contacts drop check chk_carrier_contacts_preferred_locale');
        DB::statement('alter table carrier_contacts drop check chk_carrier_contacts_position');

        Schema::table('carrier_contacts', function (Blueprint $table): void {
            $table->dropColumn(['position', 'preferred_locale']);
        });
    }
};
