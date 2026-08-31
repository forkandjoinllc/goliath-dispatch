<?php

declare(strict_types=1);

namespace App\Support\Billing;

use App\Services\Billing\BillingEvent;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * El libro de sucesos del proveedor de cobro.
 *
 * `stripe_events` existía desde el primer día, vacía, y el esquema ya decía para
 * qué es: un índice único sobre `stripe_event_id` y dos disparadores que
 * impiden borrar una fila y cambiarle el id, el tipo o la huella. Es un libro de
 * solo-añadir, y con razón: es la única prueba de qué dijo el proveedor y
 * cuándo.
 *
 * ## La idempotencia la da el ÍNDICE, no una comprobación
 *
 * Un proveedor de pagos reenvía. Es su comportamiento normal —si no le
 * contestamos rápido, vuelve— así que el mismo suceso llega dos y tres veces, a
 * veces a la vez.
 *
 * La forma ingenua es «mira si ya está, y si no, insértalo». Falla justo cuando
 * importa: dos entregas simultáneas consultan a la vez, las dos ven que no
 * está, y las dos activan la suscripción. Con un pago eso es un cobro doble;
 * con un fallo de pago, un cliente suspendido dos veces.
 *
 * Aquí se INSERTA y se deja que el índice único decida. Si revienta por
 * duplicado, el suceso ya estaba y no hay nada que hacer. Es la base de datos
 * quien resuelve la carrera, que es el único sitio donde se puede resolver.
 */
final class EventLedger
{
    /**
     * Anota el suceso. Devuelve el id de la fila, o nulo si ya estaba.
     *
     * Nulo NO es un error: es «esto ya lo procesamos». Quien llama contesta 200
     * igual, porque contestar un error haría que el proveedor lo reenviara para
     * siempre.
     */
    public static function record(BillingEvent $evento): ?string
    {
        $id = (string) Str::uuid();
        $payload = json_encode($evento->payload);

        try {
            DB::table('stripe_events')->insert([
                'id' => $id,
                'tenant_id' => $evento->tenantId,
                'stripe_event_id' => $evento->id,
                'event_type' => $evento->providerType,
                'processing_status' => 'received',
                // La huella del cuerpo tal y como llegó. Uno de los disparadores
                // impide cambiarla: es lo que responde «¿este suceso es el que
                // mandaron?» dentro de tres años.
                'payload_digest' => hash('sha256', (string) $payload),
                'payload' => $payload,
                'attempts' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (QueryException $e) {
            // 1062 es «clave duplicada». Cualquier otro error sí es un problema
            // y tiene que subir: un webhook que se traga los errores de base de
            // datos es un webhook que pierde pagos en silencio.
            if (($e->errorInfo[1] ?? null) !== 1062) {
                throw $e;
            }

            self::countRedelivery($evento->id);

            return null;
        }

        return $id;
    }

    /** Marca el suceso como procesado. */
    public static function processed(string $rowId): void
    {
        // Solo columnas que el disparador admite cambiar: `stripe_event_id`,
        // `event_type` y `payload_digest` son inmutables y tocarlas revienta con
        // un SIGNAL a mitad de la petición del proveedor.
        DB::table('stripe_events')->where('id', $rowId)->update([
            'processing_status' => 'processed',
            'processed_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** Un suceso que no nos interesa. Se guarda igual: el libro es completo. */
    public static function ignored(string $rowId): void
    {
        DB::table('stripe_events')->where('id', $rowId)->update([
            'processing_status' => 'ignored',
            'processed_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public static function failed(string $rowId, string $mensaje): void
    {
        DB::table('stripe_events')->where('id', $rowId)->update([
            'processing_status' => 'failed',
            'error_message' => Str::limit($mensaje, 2000),
            'updated_at' => now(),
        ]);
    }

    /**
     * Los últimos sucesos de una empresa, para la pantalla.
     *
     * @return list<array<string, mixed>>
     */
    public static function forTenant(string $tenantId, int $limite = 20): array
    {
        return DB::table('stripe_events')
            ->where('tenant_id', $tenantId)
            ->orderByDesc('created_at')
            ->limit($limite)
            ->get(['id', 'event_type', 'processing_status', 'error_message', 'created_at', 'processed_at'])
            ->map(static fn (object $e): array => [
                'id' => (string) $e->id,
                'type' => (string) $e->event_type,
                'status' => (string) $e->processing_status,
                'error' => $e->error_message,
                'at' => substr((string) $e->created_at, 0, 16),
            ])
            ->all();
    }

    /**
     * Cuenta un reenvío del mismo suceso.
     *
     * `attempts` no es decoración: un suceso que llega catorce veces significa
     * que algo nuestro contestó mal catorce veces, y ese número es lo único que
     * lo dice.
     */
    private static function countRedelivery(string $providerEventId): void
    {
        DB::table('stripe_events')
            ->where('stripe_event_id', $providerEventId)
            ->increment('attempts', 1, ['updated_at' => now()]);
    }
}
