<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Que un suceso de rastreo pueda no venir de una sesión de proveedor.
 *
 * `tracking_events.session_id` nació NOT NULL, y el esquema lo decía con todas
 * las letras: un evento viene de una sesión de proveedor. Con esa regla, el lote
 * que construyó las llamadas de control se negó —bien— a inventar sesiones
 * falsas para colgar de ellas posiciones tecleadas a mano.
 *
 * Lo que se ve ahora, al construir la ingesta de verdad, es que la regla
 * describía el único caso que había entonces y no el dominio. La mayor parte de
 * lo que se sabe del viaje de un camión en esta aplicación NO viene de un
 * aparato: viene de que alguien de despacho marcó que llegó a la parada, o
 * colgó el teléfono y anotó dónde estaba. Eso es un suceso de rastreo con todas
 * las de la ley —tiene hora, lugar, carga y quién lo dice— y lo único que no
 * tiene es una sesión de proveedor, porque no hay proveedor.
 *
 * La alternativa era una línea de tiempo cosida en el cliente a partir de tres
 * tablas —paradas, llamadas y eventos— con su duplicado cuando el mismo hecho
 * estuviera en dos. Sale más barato admitir en la tabla lo que ya es verdad:
 * hay sucesos sin sesión, y `provider = 'manual'` —que la restricción del
 * esquema ya permitía desde el primer día— dice exactamente cuáles.
 *
 * El índice `(session_id, occurred_at)` sigue en pie y sigue sirviendo: MySQL
 * indexa los nulos, y las consultas por sesión piden una sesión concreta.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table tracking_events modify session_id char(36) null');
    }

    public function down(): void
    {
        // Los sucesos sin sesión no caben en la forma anterior. Se van, y solo
        // ellos: un `modify` a NOT NULL con filas nulas lo rechaza el motor, y
        // lo que no se puede es que la vuelta atrás rellene el hueco con una
        // sesión inventada, que es justo lo que esta migración vino a no hacer.
        DB::table('tracking_events')->whereNull('session_id')->delete();

        DB::statement('alter table tracking_events modify session_id char(36) not null');
    }
};
