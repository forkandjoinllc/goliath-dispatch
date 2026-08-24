<?php

declare(strict_types=1);

namespace App\Support\Database;

use Illuminate\Database\Query\Grammars\MySqlGrammar;

/**
 * La gramática de consultas, pero escribiendo los milisegundos.
 *
 * Las columnas de fecha del esquema son `datetime(3)`, y los modelos declaran
 * `$dateFormat = 'Y-m-d H:i:s.v'` para conservarlos. Pero los INSERT en crudo
 * —`DB::table(...)->insert(['created_at' => now()])`— no pasan por el modelo:
 * ahí convierte esta gramática, y la de Laravel devuelve 'Y-m-d H:i:s'. Los
 * milisegundos se perdían y la columna guardaba `.000`.
 *
 * No es un detalle de precisión. Las tablas que lo sufren son las de
 * solo-añadir —`load_status_history`, `carrier_onboarding_events`,
 * `audit_events`, `financial_snapshots`—, que existen para responder «¿cuándo?»
 * y «¿en qué orden?». Dos filas del mismo segundo quedaban con la misma marca y
 * `order by created_at` devolvía lo que quisiera el motor. Una carga que pasa
 * de despachada a en ruta dentro del mismo segundo —cosa corriente— dejaba una
 * cadena de horas que ya no era una cadena.
 *
 * Se descubrió porque una prueba del historial de altas fallaba de forma
 * intermitente: las dos filas salían en orden inverso una de cada dos veces.
 *
 * Sobre una columna sin fracción (`failed_jobs.failed_at`, que es `timestamp`)
 * MySQL redondea al segundo, que es lo que hacía antes.
 */
final class MillisecondGrammar extends MySqlGrammar
{
    public function getDateFormat(): string
    {
        return 'Y-m-d H:i:s.v';
    }
}
