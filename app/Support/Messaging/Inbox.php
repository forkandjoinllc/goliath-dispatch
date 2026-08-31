<?php

declare(strict_types=1);

namespace App\Support\Messaging;

use App\Authorization\Actor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Models\Conversation;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

/**
 * La bandeja: qué hilos hay, cuál se movió y cuánto queda por leer.
 *
 * Lo único con truco es la cuenta de no leídos. Se calcula comparando
 * `messages.created_at` con el `last_read_at` DE QUIEN MIRA —no un contador
 * guardado— porque un contador habría que mantenerlo en dos sitios y se
 * desincroniza en cuanto alguien borra un mensaje o se sale del hilo.
 *
 * Y se calcula en UNA consulta para toda la página, no una por hilo. Con veinte
 * hilos en pantalla, la versión ingenua son veintiuna consultas y la bandeja es
 * la pantalla que más se abre del sistema.
 */
final class Inbox
{
    /** @return LengthAwarePaginator<int, Conversation> */
    public static function page(PermissionChecker $checker, Actor $actor, Scope $scope, int $perPage = 20, array $filtros = []): LengthAwarePaginator
    {
        $query = MessageScope::apply(Conversation::query(), $checker, $actor, $scope);

        if (($filtros['kind'] ?? null) !== null && in_array($filtros['kind'], Threads::KINDS, true)) {
            $query->where('conversations.kind', $filtros['kind']);
        }

        if (($filtros['q'] ?? null) !== null && trim((string) $filtros['q']) !== '') {
            $texto = trim((string) $filtros['q']);
            $query->where('conversations.subject', 'like', '%'.$texto.'%');
        }

        // Los que nunca han tenido mensaje van al final y no al principio:
        // `last_message_at` es NULL ahí, y en MySQL NULL ordena primero al
        // descender. Un hilo vacío encabezando la bandeja tapa el que acaba de
        // moverse, que es lo único que se viene a mirar.
        return $query
            ->orderByRaw('conversations.last_message_at is null')
            ->orderByDesc('conversations.last_message_at')
            ->orderByDesc('conversations.created_at')
            ->paginate($perPage)
            ->withQueryString();
    }

    /**
     * Cuántos mensajes sin leer tiene este usuario en cada uno de estos hilos.
     *
     * @param  list<string>  $conversationIds
     * @return array<string, int>
     */
    public static function unreadCounts(array $conversationIds, string $userId): array
    {
        if ($conversationIds === []) {
            return [];
        }

        $filas = DB::table('messages as m')
            ->join('conversation_participants as p', function ($j) use ($userId): void {
                $j->on('p.conversation_id', '=', 'm.conversation_id')
                    ->where('p.user_id', '=', $userId)
                    ->whereNull('p.deleted_at');
            })
            ->whereIn('m.conversation_id', $conversationIds)
            ->whereNull('m.deleted_at')
            // Lo que uno mismo escribe no está sin leer.
            ->where(function ($q) use ($userId): void {
                $q->whereNull('m.sender_user_id')->orWhere('m.sender_user_id', '!=', $userId);
            })
            ->where(function ($q): void {
                $q->whereNull('p.last_read_at')->orWhereColumn('m.created_at', '>', 'p.last_read_at');
            })
            ->groupBy('m.conversation_id')
            ->selectRaw('m.conversation_id, count(*) as n')
            ->get();

        $salida = [];

        foreach ($filas as $f) {
            $salida[(string) $f->conversation_id] = (int) $f->n;
        }

        return $salida;
    }

    /**
     * El último mensaje de cada hilo, para la línea de vista previa.
     *
     * @param  list<string>  $conversationIds
     * @return array<string, array<string, mixed>>
     */
    public static function lastMessages(array $conversationIds): array
    {
        if ($conversationIds === []) {
            return [];
        }

        // Una sola consulta con una ventana. La alternativa —traerlos todos
        // ordenados y quedarse con el primero de cada grupo en PHP— cargaría en
        // memoria todos los mensajes de todos los hilos de la página para usar
        // veinte.
        //
        // En crudo y no con el constructor: `mergeBindings` sobre una subconsulta
        // con `whereIn` es de las cosas que funcionan hasta que alguien cambia
        // el orden de las cláusulas y los parámetros se desalinean en silencio.
        $marcas = implode(',', array_fill(0, count($conversationIds), '?'));

        $filas = DB::select(
            "select x.conversation_id, x.body, x.origin, x.system_key, x.system_params,
                    x.created_at, x.sender_user_id
             from (
                select m.conversation_id, m.body, m.origin, m.system_key, m.system_params,
                       m.created_at, m.sender_user_id,
                       row_number() over (
                           partition by m.conversation_id order by m.created_at desc, m.id desc
                       ) as rn
                from messages m
                where m.conversation_id in ({$marcas})
                  and m.deleted_at is null
             ) as x
             where x.rn = 1",
            $conversationIds,
        );

        $salida = [];

        foreach ($filas as $f) {
            $salida[(string) $f->conversation_id] = [
                'origin' => (string) $f->origin,
                'body' => (string) $f->body,
                'systemKey' => $f->system_key === null ? null : (string) $f->system_key,
                'systemParams' => $f->system_params === null ? null : json_decode((string) $f->system_params, true),
                'createdAt' => (string) $f->created_at,
                'senderUserId' => $f->sender_user_id === null ? null : (string) $f->sender_user_id,
            ];
        }

        return $salida;
    }

    /**
     * Los mensajes de un hilo, del más viejo al más nuevo.
     *
     * @return list<array<string, mixed>>
     */
    public static function messages(string $conversationId): array
    {
        $filas = DB::table('messages as m')
            ->leftJoin('users as u', 'u.id', '=', 'm.sender_user_id')
            ->where('m.conversation_id', $conversationId)
            ->whereNull('m.deleted_at')
            ->orderBy('m.created_at')
            ->orderBy('m.id')
            ->get([
                'm.id', 'm.origin', 'm.body', 'm.system_key', 'm.system_params',
                'm.created_at', 'm.edited_at', 'm.sender_user_id',
                'u.first_name', 'u.last_name', 'u.email',
            ]);

        $adjuntos = self::attachments($filas->pluck('id')->map(static fn ($i): string => (string) $i)->all());

        return $filas->map(static fn ($m): array => [
            'id' => (string) $m->id,
            'origin' => (string) $m->origin,
            // Para los de sistema la pantalla usa la clave y NO este texto: la
            // clave se traduce al idioma de quien lee, el texto quedó fijado en
            // el de quien provocó el cambio. Ver Posting::narrate().
            'body' => (string) $m->body,
            'systemKey' => $m->system_key === null ? null : (string) $m->system_key,
            'systemParams' => $m->system_params === null ? null : json_decode((string) $m->system_params, true),
            'createdAt' => (string) $m->created_at,
            'editedAt' => $m->edited_at === null ? null : (string) $m->edited_at,
            'senderUserId' => $m->sender_user_id === null ? null : (string) $m->sender_user_id,
            'sender' => $m->sender_user_id === null
                ? null
                : (trim((string) $m->first_name.' '.(string) $m->last_name) ?: (string) $m->email),
            'attachments' => $adjuntos[(string) $m->id] ?? [],
        ])->all();
    }

    /**
     * @param  list<string>  $messageIds
     * @return array<string, list<array<string, mixed>>>
     */
    private static function attachments(array $messageIds): array
    {
        if ($messageIds === []) {
            return [];
        }

        $filas = DB::table('message_attachments')
            ->whereIn('message_id', $messageIds)
            ->whereNull('deleted_at')
            ->orderBy('created_at')
            ->get(['id', 'message_id', 'filename', 'content_type', 'byte_size']);

        $salida = [];

        foreach ($filas as $f) {
            $salida[(string) $f->message_id][] = [
                'id' => (string) $f->id,
                'filename' => (string) $f->filename,
                'contentType' => (string) $f->content_type,
                'byteSize' => (int) $f->byte_size,
            ];
        }

        return $salida;
    }
}
