<?php

declare(strict_types=1);

namespace App\Support\Time;

/**
 * Da a un controlador la hora de quien está mirando.
 *
 * ## Por qué un trait y no un parámetro más
 *
 * Porque el reemplazo tiene que ser de UNO por UNO. Había sesenta y siete
 * llamadas repartidas en veintidós controladores con esta forma:
 *
 *     'sentAt' => substr((string) $f->sent_at, 0, 16),
 *
 * Cambiar eso por `$this->hora($f->sent_at)` es una sustitución mecánica que se
 * puede comprobar leyendo la línea. Pasar el huso como argumento habría exigido
 * tocar además cada firma y cada `map()` intermedio, y en un cambio de sesenta y
 * siete sitios la diferencia entre mecánico y no mecánico es la diferencia entre
 * revisable y no revisable.
 *
 * ## De dónde sale el huso
 *
 * De `users.timezone`, a través del `Actor`, y la resolución vive en
 * `App\Support\Time\Viewer` — no aquí. Un trait solo sirve a quien tiene
 * `$this`, y las ayudas estáticas (`Inbox::messages()`, `Readiness`,
 * `TrackingLinks`) necesitaban la misma respuesta. Este trait es la puerta
 * cómoda para los controladores; `Viewer` es donde está la regla.
 */
trait PresentsTime
{
    /** El instante, en el huso de quien mira, al minuto. */
    protected function hora(mixed $utc): ?string
    {
        return Viewer::at($utc);
    }

    /** La abreviatura del huso de quien mira, para ese instante. */
    protected function husoDelQueMira(mixed $cuando = null): string
    {
        return Viewer::label($cuando);
    }
}
