<?php

declare(strict_types=1);

namespace App\Support\Branding;

use App\Support\Storage\DocumentStore;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * La cara de la empresa: su logo, sus colores y su pie de correo.
 *
 * ## Por qué existe
 *
 * El lote 59 hizo que al despachar una carga le SALGA de verdad un correo al
 * cliente de la casa de despacho. Y lo dejé escrito en su documento: ese correo
 * va en texto plano y con nuestro nombre, cuando quien lo recibe no es cliente
 * nuestro sino de ellos. Lo mismo la página pública de rastreo, que el cliente
 * abre desde ese correo: dice el nombre de la empresa al pie y por lo demás
 * tiene nuestros colores.
 *
 * `tenant_branding` llevaba en el esquema desde el primer día, con logo, cinco
 * colores, dos tipografías y cabecera y pie de correo, y estaba vacía.
 *
 * ## Qué se guarda, y qué NO
 *
 * Se guarda el logo, los colores y un pie de correo **en texto plano**.
 *
 * Las columnas se llaman `email_header_html` y `email_footer_html`, y aun así
 * NO se acepta HTML. La razón no es pereza: ese texto lo escribe el
 * administrador de una empresa y viaja en un correo a un TERCERO que no nos
 * conoce. Aceptar marcado libre ahí es regalar un vector de suplantación —un
 * bloque «confirme sus datos bancarios» con el aspecto del resto del mensaje— a
 * cambio de dejar poner negritas. Se escapa al componer, y lo que se gana en
 * apariencia no compensa lo que se abre.
 *
 * Tampoco se manda el logo DENTRO del correo. Un logo incrustado engorda cada
 * mensaje, y una dirección firmada caduca mientras el correo vive para siempre.
 * El logo vive en la página pública, que es donde el cliente mira de verdad.
 *
 * ## Los colores son datos, no CSS
 *
 * Se validan como `#RRGGBB` y se entregan como variables CSS a una sola capa de
 * la página pública. No se inyecta una hoja de estilos de la empresa: un color
 * mal puesto puede dejar un texto ilegible, pero no puede ejecutar nada.
 */
final class Brand
{
    /** Los de Goliath, que son los que se usan cuando la empresa no ha puesto los suyos. */
    public const POR_DEFECTO = [
        'primary_color' => '#062B5C',
        'accent_color' => '#FF5A00',
    ];

    /**
     * La marca de una empresa, con los valores por defecto donde falte.
     *
     * @return array{name: string, logoUrl: ?string, primaryColor: string, accentColor: string, emailFooter: ?string}
     */
    public static function for(string $tenantId): array
    {
        $fila = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_branding')
            ->where('tenant_id', $tenantId)
            ->first());

        $nombre = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenants')
            ->where('id', $tenantId)
            ->value('display_name'));

        return [
            'name' => (string) ($nombre ?? ''),
            'logoUrl' => $fila?->logo_storage_key === null ? null : url('/b/'.$tenantId.'/logo'),
            'primaryColor' => self::color($fila?->primary_color, self::POR_DEFECTO['primary_color']),
            'accentColor' => self::color($fila?->accent_color, self::POR_DEFECTO['accent_color']),
            // Se guarda en la columna que el esquema llama `_html` y se trata
            // como texto: ver la nota de arriba.
            'emailFooter' => self::texto($fila?->email_footer_html),
        ];
    }

    /** La clave de almacén del logo, para servirlo. */
    public static function logoKey(string $tenantId): ?string
    {
        $clave = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_branding')
            ->where('tenant_id', $tenantId)
            ->value('logo_storage_key'));

        return $clave === null ? null : (string) $clave;
    }

    /** Guarda colores y pie. */
    public static function save(string $tenantId, ?string $primary, ?string $accent, ?string $footer): void
    {
        self::write($tenantId, [
            'primary_color' => $primary ?? self::POR_DEFECTO['primary_color'],
            'accent_color' => $accent ?? self::POR_DEFECTO['accent_color'],
            'email_footer_html' => $footer === null || trim($footer) === '' ? null : trim($footer),
        ]);
    }

    /** Guarda el logo y devuelve su clave. */
    public static function saveLogo(DocumentStore $store, string $tenantId, UploadedFile $file): string
    {
        $clave = $store->put($tenantId, $file);

        self::write($tenantId, ['logo_storage_key' => $clave]);

        return $clave;
    }

    /** @param array<string, mixed> $campos */
    private static function write(string $tenantId, array $campos): void
    {
        $ahora = CarbonImmutable::now();

        app(TenantContext::class)->withoutTenant(function () use ($tenantId, $campos, $ahora): void {
            $existe = DB::table('tenant_branding')->where('tenant_id', $tenantId)->exists();

            if ($existe) {
                DB::table('tenant_branding')
                    ->where('tenant_id', $tenantId)
                    ->update([...$campos, 'updated_at' => $ahora]);

                return;
            }

            DB::table('tenant_branding')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'created_at' => $ahora,
                'updated_at' => $ahora,
                ...$campos,
            ]);
        });
    }

    /** Un color válido, o el de siempre. Nunca lo que venga. */
    private static function color(mixed $valor, string $porDefecto): string
    {
        return is_string($valor) && preg_match('/^#[0-9A-Fa-f]{6}$/', $valor) === 1
            ? strtoupper($valor)
            : $porDefecto;
    }

    private static function texto(mixed $valor): ?string
    {
        if (! is_string($valor) || trim($valor) === '') {
            return null;
        }

        // Por si alguna vez entró marcado por otra vía —una migración, un
        // volcado— se limpia al LEER y no solo al escribir. Una defensa que solo
        // está en el formulario es una defensa que se salta con un `update`.
        return trim(strip_tags($valor));
    }
}
