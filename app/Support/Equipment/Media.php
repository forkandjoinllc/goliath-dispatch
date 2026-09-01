<?php

declare(strict_types=1);

namespace App\Support\Equipment;

use App\Support\Storage\DocumentStore;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Las fotos de un camión o un remolque.
 *
 * ## El defecto
 *
 * La página de transportistas del sitio público dice:
 *
 * > «Cada camión y remolque necesita **al menos cuatro fotos** antes de
 * > activarse.»
 *
 * Y la portada las mete en la lista de cosas que «se verifican automáticamente
 * antes de asignar una carga — no se detectan después».
 *
 * `equipment_media` estaba vacía. En el lote 57 dejé `insufficient_media` FUERA
 * de los motivos de bloqueo precisamente para no prometer una puerta que no
 * existía, y lo escribí en docs/equipment.md como cabo suelto. Este es el cabo.
 *
 * ## Cuatro ÁNGULOS, no cuatro ficheros
 *
 * «Al menos cuatro fotos» se puede cumplir con cuatro fotos del mismo faro. Lo
 * que hace falta de verdad —para una reclamación, para un seguro, para saber en
 * qué estado salió la unidad— son los cuatro lados: frente, detrás, izquierda y
 * derecha. Así que el mínimo son los cuatro ÁNGULOS, y la pantalla dice cuál
 * falta en vez de un número que no explica nada.
 *
 * Es más estricto que la frase y la cumple: quien tiene los cuatro ángulos tiene
 * cuatro fotos. Y es la única lectura que hace el requisito útil en vez de
 * burocrático.
 *
 * ## Borrar es marcar como borrado
 *
 * Nunca se tira el fichero al borrar una foto: la fila se marca y el barrido de
 * huérfanos del lote 53 decide cuándo el fichero puede irse de verdad. Una foto
 * que documenta el estado de un camión el día que salió es exactamente el tipo
 * de dato que alguien reclama nueve meses después.
 */
final class Media
{
    /** Los cuatro lados. El orden es el que se pinta. */
    public const ANGULOS = ['front', 'rear', 'left', 'right'];

    /** Ángulos que se admiten además de los obligatorios. */
    public const OPCIONALES = ['vin_plate', 'odometer', 'damage', 'other'];

    /**
     * Las fotos de una unidad.
     *
     * @return list<array<string, mixed>>
     */
    public static function forUnit(string $tenantId, string $type, string $id): array
    {
        return DB::table('equipment_media')
            ->where('tenant_id', $tenantId)
            ->where('equipment_type', $type)
            ->where('equipment_id', $id)
            ->whereNull('deleted_at')
            ->orderBy('sort_order')
            ->orderBy('created_at')
            ->get(['id', 'angle', 'caption', 'content_type', 'byte_size', 'created_at'])
            ->map(static fn (object $m): array => [
                'id' => (string) $m->id,
                'angle' => (string) $m->angle,
                'caption' => $m->caption,
                'contentType' => (string) $m->content_type,
                'bytes' => (int) $m->byte_size,
                'createdAt' => substr((string) $m->created_at, 0, 16),
            ])
            ->all();
    }

    /**
     * Los ángulos obligatorios que todavía faltan.
     *
     * @return list<string>
     */
    public static function missingAngles(string $tenantId, string $type, string $id): array
    {
        $tiene = DB::table('equipment_media')
            ->where('tenant_id', $tenantId)
            ->where('equipment_type', $type)
            ->where('equipment_id', $id)
            ->whereNull('deleted_at')
            ->pluck('angle')
            ->unique()
            ->all();

        return array_values(array_diff(self::ANGULOS, $tiene));
    }

    /** ¿Tiene los cuatro lados? */
    public static function complete(string $tenantId, string $type, string $id): bool
    {
        return self::missingAngles($tenantId, $type, $id) === [];
    }

    /** Guarda una foto y devuelve su id. */
    public static function add(
        DocumentStore $store,
        string $tenantId,
        string $type,
        string $id,
        string $angle,
        UploadedFile $file,
        ?string $caption,
        ?string $userId,
    ): string {
        $mediaId = (string) Str::uuid();
        $ahora = CarbonImmutable::now();

        DB::table('equipment_media')->insert([
            'id' => $mediaId,
            'tenant_id' => $tenantId,
            'equipment_type' => $type,
            'equipment_id' => $id,
            'angle' => $angle,
            'media_kind' => 'photo',
            'storage_key' => $store->put($tenantId, $file),
            'content_type' => (string) ($file->getMimeType() ?? 'application/octet-stream'),
            'byte_size' => (int) $file->getSize(),
            // El resumen del contenido. Sirve para saber si dos fotos son la
            // MISMA foto subida dos veces con otro nombre —que en un expediente
            // de cuatro ángulos pasa— y para comprobar años después que el
            // fichero del almacén sigue siendo el que se subió.
            'sha256' => hash_file('sha256', $file->getRealPath()),
            'caption' => $caption,
            'sort_order' => array_search($angle, self::ANGULOS, true) === false
                ? 99
                : (int) array_search($angle, self::ANGULOS, true),
            'uploaded_by_user_id' => $userId,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return $mediaId;
    }

    /** Marca una foto como borrada. El fichero lo retira el barrido de huérfanos. */
    public static function remove(string $tenantId, string $mediaId, ?string $userId, string $motivo): bool
    {
        return DB::table('equipment_media')
            ->where('tenant_id', $tenantId)
            ->where('id', $mediaId)
            ->whereNull('deleted_at')
            ->update([
                'deleted_at' => CarbonImmutable::now(),
                'deleted_by' => $userId,
                'deletion_reason' => $motivo,
                'updated_at' => CarbonImmutable::now(),
            ]) > 0;
    }
}
