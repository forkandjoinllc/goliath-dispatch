<?php

declare(strict_types=1);

namespace App\Support\Messaging;

use App\Authorization\Actor;
use App\Models\Message;
use App\Support\Storage\DocumentStore;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Escribir en un hilo.
 *
 * Dos clases de mensaje, y la segunda es la interesante.
 *
 * **De persona** (`origin = 'user'`): lo que alguien escribe. `body` es el
 * texto y ya está.
 *
 * **De sistema** (`origin = 'system'`): lo que pasó. «La carga pasó a en ruta»,
 * «se asignó el camión 104». Y aquí el esquema pide algo que es fácil no ver:
 * `system_key` + `system_params` en vez de texto.
 *
 *     -- For system messages: i18n key + params instead of hard-coded text.
 *     system_key         varchar(80)      null,
 *     system_params      json             null,
 *
 * Es una decisión de producto escrita en el esquema. En un hilo de carga hay
 * despacho —que trabaja en español— y un transportista que puede trabajar en
 * inglés. Si el mensaje de sistema se guardara ya redactado, quedaría en el
 * idioma del que provocó el cambio: el transportista inglés leería «La carga
 * pasó a en ruta» y el despachador español leería «Load moved to in transit»,
 * cada uno a medias. Guardando la clave, **cada uno lo lee en el suyo** y el
 * mismo hilo se cuenta bien dos veces.
 *
 * `body` sigue siendo NOT NULL, así que se escribe también una redacción — en
 * el idioma de la empresa — para que quien mire la tabla en crudo, o un volcado
 * de retención, no vea filas mudas. Pero la pantalla NO la usa: usa la clave.
 */
final class Posting
{
    /** Cuántos adjuntos y de qué tamaño. Un hilo no es un archivador. */
    public const MAX_KB = 25600;

    /** Lo que una persona escribe. */
    public static function say(Actor $actor, string $conversationId, string $body): Message
    {
        return DB::transaction(function () use ($actor, $conversationId, $body): Message {
            $mensaje = new Message;
            // La empresa se toma del actor y no del contexto ambiental. El
            // rasgo BelongsToTenant la rellenaría solo, pero solo si hay
            // contexto: en una cola, en un comando de consola o en cualquier
            // sitio sin petición HTTP no lo hay, y la columna es NOT NULL. El
            // actor la lleva siempre encima.
            $mensaje->tenant_id = $actor->tenantId;
            $mensaje->conversation_id = $conversationId;
            $mensaje->sender_user_id = $actor->auditUserId();
            $mensaje->origin = 'user';
            $mensaje->body = $body;
            $mensaje->save();

            self::touch($conversationId, $mensaje);

            return $mensaje;
        });
    }

    /**
     * Lo que pasó, guardado como clave y no como frase.
     *
     * @param  array<string, string|int>  $params
     */
    public static function narrate(
        string $tenantId,
        string $conversationId,
        string $systemKey,
        array $params = [],
        ?string $fallbackLocale = null,
    ): Message {
        return DB::transaction(function () use ($tenantId, $conversationId, $systemKey, $params, $fallbackLocale): Message {
            $mensaje = new Message;
            $mensaje->tenant_id = $tenantId;
            $mensaje->conversation_id = $conversationId;
            // Sin remitente: no lo dijo nadie, pasó.
            $mensaje->sender_user_id = null;
            $mensaje->origin = 'system';
            $mensaje->system_key = $systemKey;
            $mensaje->system_params = $params;
            // La redacción de reserva. La pantalla usa la clave; esto es para
            // quien mire la tabla en crudo o un volcado de retención.
            $mensaje->body = __('messages.system.'.$systemKey, $params, $fallbackLocale ?? config('app.locale'));
            $mensaje->save();

            self::touch($conversationId, $mensaje);

            return $mensaje;
        });
    }

    /**
     * Cuelga un fichero de un mensaje.
     *
     * `message_attachments` guarda su propio `sha256` igual que
     * `document_versions`: es lo que responde «¿este PDF es el que me
     * mandaste?» sin depender del nombre ni de la fecha.
     */
    public static function attach(Actor $actor, Message $mensaje, UploadedFile $file, DocumentStore $store): string
    {
        $key = $store->put((string) $actor->tenantId, $file);
        $id = (string) Str::uuid();

        DB::table('message_attachments')->insert([
            'id' => $id,
            'tenant_id' => $mensaje->tenant_id,
            'message_id' => $mensaje->id,
            'storage_key' => $key,
            // El nombre original es un DATO, no un nombre de fichero.
            'filename' => mb_substr((string) $file->getClientOriginalName(), 0, 255),
            'content_type' => (string) $file->getMimeType(),
            'byte_size' => (int) $file->getSize(),
            'sha256' => hash_file('sha256', (string) $file->getRealPath()),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }

    /**
     * Marca el hilo como leído hasta ahora, para este usuario.
     *
     * `last_read_at` y no un contador: un contador habría que mantenerlo en dos
     * sitios y se desincroniza en cuanto alguien borra un mensaje. Una marca de
     * tiempo se compara con `created_at` y siempre da la cuenta correcta.
     */
    public static function markRead(string $conversationId, string $userId): void
    {
        DB::table('conversation_participants')
            ->where('conversation_id', $conversationId)
            ->where('user_id', $userId)
            ->whereNull('deleted_at')
            ->update(['last_read_at' => now(), 'updated_at' => now()]);
    }

    /**
     * `conversations.last_message_at` al día.
     *
     * Está desnormalizado a propósito y el esquema lo dice con un índice:
     * `conversations_last_message_idx (tenant_id, last_message_at)`. La bandeja
     * ordena por él, y calcularlo con un MAX() sobre `messages` en cada carga de
     * la bandeja sería recorrer todos los mensajes de la empresa para pintar
     * veinte filas.
     *
     * Se escribe aquí y solo aquí, dentro de la misma transacción que el
     * mensaje: si se escribiera fuera, un fallo entre las dos dejaría un hilo
     * cuyo último mensaje es más nuevo que su `last_message_at`, y la bandeja lo
     * enterraría abajo justo cuando acaba de moverse.
     */
    private static function touch(string $conversationId, Message $mensaje): void
    {
        DB::table('conversations')->where('id', $conversationId)->update([
            'last_message_at' => $mensaje->created_at,
            'updated_at' => now(),
        ]);
    }
}
