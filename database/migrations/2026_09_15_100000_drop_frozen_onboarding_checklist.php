<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Fuera la columna `checklist`: una lista de cumplimiento congelada.
 *
 * ## Qué guardaba
 *
 * Nada, en producción. En el alta se escribía `json_encode([])` y ningún
 * camino la actualizaba jamás; los únicos valores de verdad los ponía el
 * sembrador de datos de demostración.
 *
 * Con esos datos, la ficha del transportista pintaba vistos verdes —seguro,
 * autoridad, contrato firmado— del día en que se sembró. Con datos reales la
 * tarjeta no salía nunca, porque la lista estaba vacía.
 *
 * ## Por qué se quita en vez de empezar a escribirla
 *
 * Porque el docblock de `App\Support\Onboarding\Readiness` ya explicaba, antes
 * de este cambio, por qué no debe guardarse:
 *
 * > SE CALCULA, NO SE GUARDA. […] una lista guardada dice «listo» el día que se
 * > guardó y sigue diciéndolo el día que caduca el certificado de seguro. La
 * > pregunta «¿puede llevar carga HOY?» solo la puede contestar el estado de
 * > hoy.
 *
 * Una columna que nadie escribe y que nadie puede leer sin equivocarse es una
 * trampa esperando a la siguiente persona. La lista ahora la calcula
 * `Readiness::checklist()` de lo mismo que usa `Guards` para dejar despachar.
 *
 * ## Qué se pierde
 *
 * Los vistos de demostración. Ningún dato de una empresa real: todas las filas
 * de producción valen `[]`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('carrier_onboardings', fn (Blueprint $t) => $t->dropColumn('checklist'));
    }

    public function down(): void
    {
        Schema::table('carrier_onboardings', function (Blueprint $table): void {
            $table->json('checklist')->nullable()->after('required_document_types');
        });
    }
};
