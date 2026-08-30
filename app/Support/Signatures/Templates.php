<?php

declare(strict_types=1);

namespace App\Support\Signatures;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Las plantillas de firma de una empresa, y qué pasa al publicar una versión.
 *
 * PUBLICAR UNA VERSIÓN NO EDITA NADA. Escribe una fila nueva con `version + 1`
 * y retira la anterior. La razón está en la propia tabla: `content_hash` viaja
 * dentro de cada solicitud y de cada registro de firma. Si el texto de una
 * versión ya firmada pudiera cambiar, la huella guardada dejaría de coincidir
 * con el texto y sería imposible saber cuál de los dos es el que se firmó.
 *
 * Lo que sí ocurre al publicar: las solicitudes PENDIENTES sobre la versión
 * vieja pasan a `superseded`, porque a nadie se le debe pedir que firme un
 * texto que la casa ya retiró. Las que ya están FIRMADAS no se tocan — siguen
 * siendo válidas para el texto que sí se firmó— y la pantalla las agrupa aparte
 * bajo «requiere nueva firma», que es una decisión de la casa, no un borrado.
 */
final class Templates
{
    /**
     * Siembra las plantillas de partida de una empresa. Idempotente: no toca
     * una clave que ya exista, ni siquiera para actualizarla.
     *
     * @return int Cuántas se crearon.
     */
    public static function install(string $tenantId): int
    {
        $existentes = DB::table('signature_templates')
            ->where('tenant_id', $tenantId)
            ->pluck('template_key')
            ->all();

        $creadas = 0;
        $ahora = CarbonImmutable::now();

        foreach (DefaultTemplates::all() as $plantilla) {
            if (in_array($plantilla['key'], $existentes, true)) {
                continue;
            }

            $tokens = TemplateBody::tokensIn($plantilla['bodyEn'], $plantilla['bodyEs']);

            DB::table('signature_templates')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'template_key' => $plantilla['key'],
                'version' => 1,
                'title_en' => $plantilla['titleEn'],
                'title_es' => $plantilla['titleEs'],
                'body_en' => $plantilla['bodyEn'],
                'body_es' => $plantilla['bodyEs'],
                'consent_copy_en' => $plantilla['consentEn'],
                'consent_copy_es' => $plantilla['consentEs'],
                'content_hash' => TemplateBody::contentHash(
                    $plantilla['titleEn'], $plantilla['titleEs'],
                    $plantilla['bodyEn'], $plantilla['bodyEs'],
                    $plantilla['consentEn'], $plantilla['consentEs'],
                ),
                'required_tokens' => json_encode($tokens),
                'active' => 1,
                'effective_from' => $ahora,
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ]);

            $creadas++;
        }

        return $creadas;
    }

    /**
     * Publica la siguiente versión de una clave de plantilla.
     *
     * @return array{id: string, version: int, superseded: int}
     */
    public static function publish(
        string $tenantId,
        string $templateKey,
        string $titleEn,
        string $titleEs,
        string $bodyEn,
        string $bodyEs,
        string $consentEn,
        string $consentEs,
    ): array {
        $ahora = CarbonImmutable::now();

        $ultima = (int) DB::table('signature_templates')
            ->where('tenant_id', $tenantId)
            ->where('template_key', $templateKey)
            ->max('version');

        $siguiente = $ultima + 1;
        $id = (string) Str::uuid();
        $tokens = TemplateBody::tokensIn($bodyEn, $bodyEs);

        DB::table('signature_templates')
            ->where('tenant_id', $tenantId)
            ->where('template_key', $templateKey)
            ->where('active', 1)
            ->update(['active' => 0, 'retired_at' => $ahora, 'updated_at' => $ahora]);

        DB::table('signature_templates')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'template_key' => $templateKey,
            'version' => $siguiente,
            'title_en' => $titleEn,
            'title_es' => $titleEs,
            'body_en' => $bodyEn,
            'body_es' => $bodyEs,
            'consent_copy_en' => $consentEn,
            'consent_copy_es' => $consentEs,
            'content_hash' => TemplateBody::contentHash($titleEn, $titleEs, $bodyEn, $bodyEs, $consentEn, $consentEs),
            'required_tokens' => json_encode($tokens),
            'active' => 1,
            'effective_from' => $ahora,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return [
            'id' => $id,
            'version' => $siguiente,
            'superseded' => self::supersedePending($tenantId, $templateKey, $siguiente),
        ];
    }

    /** Retira la versión vigente de una clave sin publicar otra. */
    public static function retire(string $tenantId, string $templateKey): int
    {
        $ahora = CarbonImmutable::now();

        $retiradas = DB::table('signature_templates')
            ->where('tenant_id', $tenantId)
            ->where('template_key', $templateKey)
            ->where('active', 1)
            ->update(['active' => 0, 'retired_at' => $ahora, 'updated_at' => $ahora]);

        if ($retiradas > 0) {
            self::supersedePending($tenantId, $templateKey, null);
        }

        return $retiradas;
    }

    /**
     * Las solicitudes todavía sin firmar sobre versiones viejas de esta clave
     * pasan a `superseded`.
     *
     * Solo `pending` y `viewed`: una firmada, rechazada o anulada ya terminó su
     * vida y reescribirle el estado borraría lo que pasó.
     */
    private static function supersedePending(string $tenantId, string $templateKey, ?int $nuevaVersion): int
    {
        $ahora = CarbonImmutable::now();

        $idsDeClave = DB::table('signature_templates')
            ->where('tenant_id', $tenantId)
            ->where('template_key', $templateKey)
            ->when($nuevaVersion !== null, fn ($q) => $q->where('version', '<', $nuevaVersion))
            ->pluck('id')
            ->all();

        if ($idsDeClave === []) {
            return 0;
        }

        $afectadas = DB::table('signature_requests')
            ->where('tenant_id', $tenantId)
            ->whereIn('template_id', $idsDeClave)
            ->whereIn('status', ['pending', 'viewed'])
            ->whereNull('deleted_at')
            ->pluck('id')
            ->all();

        if ($afectadas === []) {
            return 0;
        }

        DB::table('signature_requests')
            ->whereIn('id', $afectadas)
            ->update(['status' => 'superseded', 'updated_at' => $ahora]);

        foreach ($afectadas as $solicitudId) {
            Ceremony::record(
                tenantId: $tenantId,
                requestId: (string) $solicitudId,
                eventType: Ceremony::SUPERSEDED,
                detail: ['templateKey' => $templateKey, 'newVersion' => $nuevaVersion],
            );
        }

        return count($afectadas);
    }
}
