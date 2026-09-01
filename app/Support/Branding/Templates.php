<?php

declare(strict_types=1);

namespace App\Support\Branding;

use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Los textos de los avisos, en las palabras de cada empresa.
 *
 * `notification_templates` llevaba en el esquema desde el primer día —por
 * evento, canal e idioma, con su lista de fichas disponibles— y estaba vacía.
 *
 * ## Solo lo que sale FUERA
 *
 * Se pueden reescribir los mensajes que van a alguien que NO es usuario de la
 * aplicación: hoy, el correo del enlace de rastreo que recibe el cliente de la
 * casa de despacho. Los avisos internos —documento que caduca, factura vencida—
 * siguen saliendo del diccionario y no se tocan.
 *
 * La distinción no es técnica, es de responsabilidad: el texto que lee un
 * cliente ajeno lo firma la casa de despacho y tiene que poder escribirlo ella;
 * el que lee su propio equipo forma parte de la aplicación, y dejar que cada
 * empresa reescriba sus avisos internos convierte cada informe de soporte en una
 * adivinanza sobre qué decía realmente la pantalla.
 *
 * ## Una plantilla no puede romper un aviso
 *
 * Si no hay plantilla, se usa el texto de siempre. Si la hay pero se queda sin
 * asunto, se usa el asunto de siempre. Y las fichas que no se reconocen se dejan
 * como están en vez de vaciarse: `{{loadNumbre}}` mal escrito se ve en el correo
 * y se arregla; sustituido por vacío, no se entera nadie.
 */
final class Templates
{
    /** El correo con el enlace de rastreo, que recibe el cliente de la carga. */
    public const ENLACE_DE_RASTREO = 'tracking.link';

    /** El correo con la factura, que recibe el transportista. */
    public const FACTURA = 'invoice.sent';

    /** Los eventos que una empresa puede reescribir. Ver la nota de arriba. */
    public const EDITABLES = [self::ENLACE_DE_RASTREO, self::FACTURA];

    /** Las fichas que admite cada evento. */
    public const FICHAS = [
        self::ENLACE_DE_RASTREO => ['tenant', 'url'],
        self::FACTURA => ['tenant', 'invoice', 'amount', 'url'],
    ];

    /**
     * El asunto y el cuerpo de un evento, con las fichas ya sustituidas.
     *
     * @param  array<string, string>  $fichas
     * @return array{subject: string, body: string}
     */
    public static function render(
        string $tenantId,
        string $eventKey,
        string $locale,
        array $fichas,
        string $asuntoPorDefecto,
        string $cuerpoPorDefecto,
    ): array {
        $plantilla = self::find($tenantId, $eventKey, $locale);

        $asunto = $plantilla?->subject;
        $cuerpo = $plantilla?->body;

        return [
            'subject' => self::sustituir(
                is_string($asunto) && trim($asunto) !== '' ? $asunto : $asuntoPorDefecto,
                $fichas,
            ),
            'body' => self::sustituir(
                is_string($cuerpo) && trim($cuerpo) !== '' ? $cuerpo : $cuerpoPorDefecto,
                $fichas,
            ),
        ];
    }

    /**
     * Guarda —o borra— la plantilla de un evento.
     *
     * Dejar los dos campos en blanco BORRA la plantilla en vez de guardar una
     * vacía. Es la única forma de volver al texto de siempre sin tener que
     * recordarlo y volver a escribirlo.
     */
    public static function save(
        string $tenantId,
        string $eventKey,
        string $locale,
        ?string $subject,
        ?string $body,
    ): void {
        $asunto = $subject === null ? '' : trim($subject);
        $cuerpo = $body === null ? '' : trim($body);

        app(TenantContext::class)->withoutTenant(function () use ($tenantId, $eventKey, $locale, $asunto, $cuerpo): void {
            $base = DB::table('notification_templates')
                ->where('tenant_id', $tenantId)
                ->where('event_key', $eventKey)
                ->where('channel', 'email')
                ->where('locale', $locale);

            if ($cuerpo === '' && $asunto === '') {
                (clone $base)->delete();

                return;
            }

            $fila = (clone $base)->first(['id']);
            $ahora = CarbonImmutable::now();

            $campos = [
                'subject' => $asunto === '' ? null : $asunto,
                // `body` es NOT NULL en el esquema. Un asunto propio con el
                // cuerpo de siempre es una combinación legítima, así que se
                // guarda vacío y `render()` cae al de siempre al leerlo.
                'body' => $cuerpo,
                'available_tokens' => json_encode(self::FICHAS[$eventKey] ?? []),
                'active' => 1,
                'updated_at' => $ahora,
            ];

            if ($fila !== null) {
                DB::table('notification_templates')->where('id', $fila->id)->update($campos);

                return;
            }

            DB::table('notification_templates')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'event_key' => $eventKey,
                'channel' => 'email',
                'locale' => $locale,
                'created_at' => $ahora,
                ...$campos,
            ]);
        });
    }

    public static function find(string $tenantId, string $eventKey, string $locale): ?object
    {
        return app(TenantContext::class)->withoutTenant(fn () => DB::table('notification_templates')
            ->where('tenant_id', $tenantId)
            ->where('event_key', $eventKey)
            ->where('channel', 'email')
            ->where('locale', $locale)
            ->where('active', 1)
            ->whereNull('deleted_at')
            ->first());
    }

    /**
     * Sustituye `{{ficha}}` y, por comodidad, también `{ficha}`.
     *
     * El diccionario de la aplicación usa una llave y el esquema documenta dos.
     * Admitir las dos evita que alguien copie el texto de siempre en una
     * plantilla y se encuentre con que ya no se sustituye nada.
     *
     * @param  array<string, string>  $fichas
     */
    public static function sustituir(string $texto, array $fichas): string
    {
        foreach ($fichas as $nombre => $valor) {
            $texto = str_replace(['{{'.$nombre.'}}', '{'.$nombre.'}'], $valor, $texto);
        }

        return $texto;
    }
}
