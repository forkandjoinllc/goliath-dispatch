<?php

declare(strict_types=1);

namespace App\Support\Documents;

use App\Authorization\Actor;
use App\Enums\AuditAction;
use App\Services\Malware\FileScanner;
use App\Services\Malware\Scan;
use App\Services\Malware\ScanVerdict;
use App\Support\Audit;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * El paso que faltaba entre «el usuario eligió un fichero» y «el fichero está
 * guardado».
 *
 * ## Lo que había
 *
 * Nada. `Attachment` y `DocumentController` escribían `malware_scan_status =
 * 'pending'` con un comentario que decía «el trabajo que lo escanee lo marcará
 * cuando exista». No existía ese trabajo, no había nada previsto que lo
 * escribiera, y la pantalla decía debajo de cada fichero «Todavía sin analizar
 * contra malware» — un futuro que no iba a llegar. En el diccionario había
 * además una frase viva que no usaba nadie: «Este archivo no pasó el análisis
 * de seguridad y no se almacenó», una negativa que el sistema no sabía dar.
 *
 * ## El orden importa
 *
 * Se analiza ANTES de guardar, sobre el fichero temporal que trae la petición.
 * Analizar después obligaría a borrar lo ya guardado, y un borrado que falle
 * —el disco lleno, S3 caído— deja en el almacén exactamente el fichero que se
 * acaba de decidir que no debía estar. Aquí el orden es la garantía: si el
 * veredicto rechaza, `$store->put()` no llega a llamarse nunca.
 *
 * ## Lo que NO hace esta clase
 *
 * No da seguridad. Hoy el adaptador atado es `UnavailableFileScanner`, que no
 * mira los bytes y lo dice: devuelve `unavailable` y la pantalla lo escribe con
 * todas las letras. Lo que este código consigue es que el sistema deje de
 * AFIRMAR que analiza, y que el día que haya un antivirus detrás de la interfaz
 * no haya que tocar ni un controlador — igual que con FMCSA o la pasarela.
 */
final class Scanning
{
    /**
     * Analiza el fichero y devuelve el veredicto. Lanza si hay que rechazarlo.
     *
     * @throws ValidationException cuando el analizador encuentra algo
     */
    public static function revisar(UploadedFile $file, ?Actor $actor = null, ?string $campo = null): ScanVerdict
    {
        $scanner = app(FileScanner::class);

        $veredicto = $scanner->scan(
            (string) $file->getRealPath(),
            (string) $file->getClientOriginalName(),
        );

        if (! $veredicto->rechaza()) {
            return $veredicto;
        }

        // Un fichero parado por el antivirus deja rastro. Sin él, la única
        // señal de que alguien intentó subir algo con un troyano sería un
        // mensaje de error que ve esa misma persona y nadie más.
        if ($actor !== null) {
            Audit::record(
                actor: $actor,
                action: AuditAction::SecurityMalwareBlocked,
                entityType: 'document',
                entityId: null,
                entityLabel: (string) $file->getClientOriginalName(),
                after: [
                    'scanner' => $veredicto->scanner,
                    'signature' => $veredicto->signature,
                    'bytes' => (int) $file->getSize(),
                ],
            );
        }

        throw ValidationException::withMessages([
            ($campo ?? 'file') => __('errors.malwareDetected'),
        ]);
    }

    /**
     * Las dos columnas de `document_versions` que describen el análisis.
     *
     * `malware_scan_at` se escribe TAMBIÉN cuando no hubo analizador. La hora no
     * dice «se analizó»: dice cuándo se preguntó, y con `unavailable` al lado
     * significa «el día 3 de septiembre se intentó y no había con qué». Dejarla
     * nula ahí haría indistinguible una versión que pasó por aquí de una de
     * antes de que este paso existiera.
     *
     * @return array{malware_scan_status: string, malware_scan_at: string}
     */
    public static function columnas(ScanVerdict $veredicto): array
    {
        return [
            'malware_scan_status' => $veredicto->estado,
            'malware_scan_at' => $veredicto->at->toDateTimeString('millisecond'),
        ];
    }

    /**
     * Las columnas de un fichero que la aplicación se generó a sí misma.
     *
     * El sello de una firma o una confirmación de tarifa no vienen de fuera: los
     * escribió este mismo servidor hace un milisegundo. Mandarlos a un antivirus
     * sería teatro. `not_scanned` dice exactamente eso, y es distinto de
     * `unavailable` —que dice que sí se quiso mirar y no se pudo— para quien
     * lee la pantalla.
     *
     * @return array{malware_scan_status: string, malware_scan_at: null}
     */
    public static function propio(): array
    {
        return ['malware_scan_status' => Scan::NO_ANALIZADO, 'malware_scan_at' => null];
    }

    /**
     * ¿Hay analizador de verdad en esta instalación?
     *
     * Lo usan las pantallas para decidir si enseñar el aviso. Se PREGUNTA al
     * contenedor cada vez y no se guarda en ninguna tabla: una fila que dijera
     * «hay antivirus» seguiría diciéndolo el día que se caiga la variable de
     * entorno, que es justo la mentira que todo esto existe para no contar.
     */
    public static function hayAnalizador(): bool
    {
        return app(FileScanner::class)->isLive();
    }

    /**
     * Deja una versión ya escrita al día con su veredicto.
     *
     * Existe para el sembrador y para los controladores que insertan la fila con
     * `DB::table()` en vez de con el modelo.
     */
    public static function marcar(string $versionId, ScanVerdict $veredicto): void
    {
        DB::table('document_versions')->where('id', $versionId)->update([
            ...self::columnas($veredicto),
            'updated_at' => now(),
        ]);
    }
}
