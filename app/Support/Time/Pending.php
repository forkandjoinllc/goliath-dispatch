<?php

declare(strict_types=1);

namespace App\Support\Time;

/**
 * Las horas que TODAVÍA salen en UTC, contadas y con motivo escrito.
 *
 * ## Por qué existe una lista en vez de terminar el trabajo
 *
 * Porque el trabajo eran sesenta y tantos sitios repartidos por veintidós
 * ficheros, y hacerlos todos de una vez habría producido un cambio que nadie
 * puede revisar de verdad. Se convirtieron las pantallas donde la hora equivoca
 * a alguien —firmas, alta de transportistas, permisos, mensajes, avisos— y el
 * resto está aquí, contado.
 *
 * Es el mismo patrón que `App\Authorization\Enforcement::SIN_APLICAR`, y por el
 * mismo motivo: una deuda escrita en una lista que una prueba comprueba se paga;
 * una deuda que solo vive en la cabeza de quien la contrajo, no.
 *
 * ## Qué obliga esta lista
 *
 * `tests/Unit/Suite/ViewerClockTest.php` cuenta los sitios de verdad y los
 * compara con esta tabla. Eso corta las dos formas de que esto se pudra:
 *
 *  - Un fichero NUEVO que saque una hora en crudo falla, porque no está aquí.
 *    Es lo que de verdad se está comprando: que el defecto no vuelva a entrar.
 *  - Un fichero que se arregle y no se borre de aquí también falla. La lista no
 *    puede quedarse diciendo que hay deuda donde ya no la hay.
 *
 * ## Lo que NO está aquí, y no es un olvido
 *
 * Tres formas de presentar una hora son correctas y por eso no cuentan:
 *
 *  - `Clock::at()` / `Viewer::at()` — el instante en el huso de quien mira. Es
 *    lo que hay que hacer casi siempre.
 *  - `Clock::literal()` y `StopClock::window()` — horas que escribió una
 *    persona y que significan la hora del sitio, no la del servidor. Convertir
 *    esas sería moverlas.
 *  - `Clock::utc()` — lo que se queda en UTC a propósito porque la superficie
 *    pone «UTC» al lado. Hoy solo el certificado de auditoría de una firma.
 */
final class Pending
{
    /**
     * Fichero => [cuántas horas en crudo, por qué siguen así].
     *
     * El número es lo que hace que esto no se pudra: cambiarlo sin mirar es más
     * trabajo que arreglar el sitio.
     *
     * @var array<string, array{int, string}>
     */
    public const SIN_CONVERTIR = [
        // ── Fechas (0, 10) ──────────────────────────────────────────────────
        //
        // Recortar a diez caracteres se equivoca solo en la frontera del día:
        // algo creado a las 22:00 en Chicago se guarda a las 03:00 UTC y sale
        // con la fecha del día siguiente. Es un error de verdad y es más raro
        // que el de la hora, así que va después.

        'app/Http/Controllers/App/BillingController.php' => [1, 'Fecha: fin del periodo de prueba. Se pinta como día suelto en la pantalla de suscripción.'],
        'app/Http/Controllers/App/CommissionController.php' => [2, 'Fechas: devengo y pago de una comisión. Van en una tabla de importes donde el día es lo que se compara.'],
        'app/Http/Controllers/App/EquipmentController.php' => [1, 'Fecha: última verificación de una unidad. La columna se elige con un coalesce de tres, y hay que mirar las tres antes de tocarla.'],
        'app/Http/Controllers/App/InvoiceController.php' => [1, 'Fecha: cuándo se recibió un cobro. La teclea una persona, así que puede que lo correcto sea Clock::literal y no convertirla — hay que leer quién escribe la columna antes de decidir.'],
        'app/Http/Controllers/App/TenantSettingController.php' => [1, 'Fecha: fin del periodo de prueba, la misma que BillingController. Las dos a la vez o ninguna.'],
        'app/Http/Controllers/App/UserController.php' => [1, 'Fecha: último acceso de una persona. Se enseña como día en la lista de usuarios.'],
        'app/Http/Controllers/Platform/TenantController.php' => [3, 'Fechas de plataforma: alta, fin de prueba y desde cuándo se aplican los topes. Las mira el equipo de la plataforma, no un cliente.'],
        'app/Support/Oversize/Evaluator.php' => [1, 'Fecha: última revisión de una regla de sobredimensionado.'],

        // ── Instantes (0, 16 y 0, 19) ───────────────────────────────────────
        //
        // Estos sí se leen mal todo el día, no solo en la frontera.

        'app/Http/Controllers/App/LeadController.php' => [3, 'Dos fechas y un instante de cuándo entró un prospecto. Se convierte con la pantalla de prospectos, que tiene además su propio huso pendiente: un prospecto puede entrar por un formulario público desde otro estado.'],
        'app/Http/Controllers/App/LoadDocumentController.php' => [1, 'Instante: cuándo se recibió el POD. Va junto a las paradas, que ya llevan reloj de muelle; hay que decidir si esta hora es del muelle o del que mira antes de moverla.'],
        'app/Http/Controllers/App/RateConfirmationController.php' => [2, 'Instantes: cuándo se emitió la confirmación de tarifa y cuándo se contestó. Los mismos que RateResponse deduplica; se convierten con esa pantalla.'],
        'app/Http/Controllers/App/RetentionController.php' => [2, 'Instantes: cuándo se puso una retención legal y cuándo corrió una purga. Son registro de cumplimiento y puede que lo correcto sea Clock::utc con la etiqueta, como el certificado de firma, en vez de convertirlos.'],
        'app/Http/Controllers/App/TrackingController.php' => [6, 'Seis: sesión de rastreo, último parte, llegada estimada, última llamada de control. Esta pantalla ya mezcla dos relojes —las citas van en hora del muelle por StopClock— y meter un tercero sin rediseñar la tabla la deja peor. Es la que más cuidado necesita.'],
        'app/Http/Controllers/Public/TrackingController.php' => [1, 'Fecha de entrega prevista en la página PÚBLICA. Aquí no hay actor del que sacar el huso: quien mira es un cliente sin cuenta. Necesita otra decisión —el huso de la empresa, o el de la última parada— y no la del que mira, que no existe.'],
        'app/Support/Billing/EventLedger.php' => [1, 'Instante: cuándo ocurrió un suceso de facturación. Lo mira el equipo de la plataforma.'],
        'app/Support/Equipment/Media.php' => [1, 'Instante: cuándo se subió una foto de una unidad.'],
        'app/Support/Finance/InvoicePayments.php' => [1, 'Instante: cuándo se intentó cobrar. Se convierte con la pantalla de facturas.'],
        'app/Support/Platform/Expirations.php' => [1, 'Instante: cuándo se detectó por primera vez un vencimiento. Pantalla de plataforma.'],
        'app/Support/Platform/ScheduledRuns.php' => [2, 'Instantes: cuándo empezó y acabó una tarea programada. Pantalla de salud de la plataforma, y ahí UTC puede ser lo correcto: quien la mira compara con los registros del servidor, que están en UTC.'],
        'app/Support/Tracking/TrackingLinks.php' => [4, 'Cuatro: cuándo se mandó el enlace de rastreo, cuándo se revocó, cuándo se vio y cuándo se creó. Se convierten con TrackingController, que es donde salen.'],
    ];
}
