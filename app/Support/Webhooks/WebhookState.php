<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

use App\Support\Platform\ScheduledRuns;
use Illuminate\Support\Facades\DB;

/**
 * Si el webhook del alta está entregando de verdad, y desde cuándo.
 *
 * ## El defecto que esta clase existe para no repetir
 *
 * La pantalla de ajustes va a tener una casilla «Activado» y un campo de URL.
 * Quien los rellena se queda con que, a partir de ahí, cada alta llega a su
 * CRM. Si el cron de Forge no está puesto, no llega ninguna — y la pantalla,
 * sin esto, diría exactamente lo mismo en los dos casos.
 *
 * Cero entregas puede significar que nadie se ha dado de alta o que nada está
 * corriendo. Son dos cosas muy distintas y la pantalla tiene que separarlas.
 *
 * ## Lo que se devuelve por separado, y por qué NO se junta
 *
 *  • `enabled` — lo que dice la configuración.
 *  • `sweepLastRunAt` — cuándo pasó el barrido por última vez, haya tenido
 *    trabajo o no.
 *  • `pending` / `abandoned` — cuánta cola hay y cuánta se dio por perdida.
 *  • `last` — la última entrega REAL (los envíos de prueba no cuentan: uno de
 *    prueba que salió bien no dice nada de si las altas están llegando).
 *
 * Juntar todo eso en un semáforo verde sería inventarse una garantía. Es la
 * misma decisión que tomó `RevalidationState` con FMCSA, y por lo mismo.
 *
 * ## De dónde sale «cuándo corrió el barrido»
 *
 * De `job_queue`, a través de `ScheduledRuns`, que es donde ya se anotan
 * `notifications:sweep` y `retention:sweep` y de donde bebe la pantalla de
 * salud de la plataforma. No se inventa una tabla nueva para esto: dos sitios
 * contestando «¿corrió el planificador?» acaban contestando cosas distintas.
 */
final class WebhookState
{
    public const BARRIDO = 'webhooks:deliver';

    /**
     * Un barrido que lleva más de esto sin firmar se considera parado.
     *
     * El barrido corre cada minuto. Diez minutos de margen absorben un reinicio
     * o un despliegue sin cantar un fallo que no existe.
     */
    private const PARADO_MINUTOS = 10;

    /**
     * @return array{
     *   enabled: bool, url: string|null, secretLast4: string|null,
     *   sweepLastRunAt: string|null, sweepStalled: bool,
     *   pending: int, abandoned: int,
     *   last: array<string, mixed>|null,
     *   recent: list<array<string, mixed>>
     * }
     */
    public static function for(string $tenantId): array
    {
        $ajustes = Deliveries::settings($tenantId);

        $barrido = DB::table('job_queue')
            ->whereNull('tenant_id')
            ->where('job_type', ScheduledRuns::PREFIJO.self::BARRIDO)
            ->orderByDesc('started_at')
            ->value('started_at');

        $ultima = DB::table('webhook_deliveries')
            ->where('tenant_id', $tenantId)
            ->where('is_test', false)
            ->orderByDesc('created_at')
            ->first();

        return [
            'enabled' => $ajustes['enabled'],
            'url' => $ajustes['url'],
            // El secreto NUNCA vuelve a pantalla. Solo los últimos cuatro, para
            // poder decir CUÁL hay puesto sin enseñarlo.
            'secretLast4' => $ajustes['last4'],

            'sweepLastRunAt' => $barrido === null ? null : (string) $barrido,
            'sweepStalled' => $barrido === null
                || now()->diffInMinutes((string) $barrido, true) > self::PARADO_MINUTOS,

            'pending' => DB::table('webhook_deliveries')
                ->where('tenant_id', $tenantId)
                ->whereIn('status', ['pending', 'sending'])
                ->count(),
            'abandoned' => DB::table('webhook_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('status', 'abandoned')
                ->count(),

            'last' => $ultima === null ? null : self::fila($ultima),
            'recent' => DB::table('webhook_deliveries')
                ->where('tenant_id', $tenantId)
                ->orderByDesc('created_at')
                ->limit(10)
                ->get()
                ->map(static fn (object $f): array => self::fila($f))
                ->all(),
        ];
    }

    /** @return array<string, mixed> */
    private static function fila(object $f): array
    {
        return [
            'id' => (string) $f->id,
            'event' => (string) $f->event,
            'status' => (string) $f->status,
            'attempts' => (int) $f->attempts,
            'responseStatus' => $f->response_status === null ? null : (int) $f->response_status,
            // El cuerpo de la respuesta NO viaja a la pantalla: lo escribe un
            // tercero y acabaría pintado dentro de nuestro panel. El código de
            // estado y el motivo acotado bastan para saber qué pasó.
            'error' => $f->error === null ? null : mb_substr((string) $f->error, 0, 200),
            'isTest' => (bool) $f->is_test,
            'createdAt' => (string) $f->created_at,
            'lastAttemptAt' => $f->last_attempt_at === null ? null : (string) $f->last_attempt_at,
            'nextAttemptAt' => $f->next_attempt_at === null ? null : (string) $f->next_attempt_at,
        ];
    }
}
