<?php

declare(strict_types=1);

namespace App\Support\Signatures;

/**
 * El cuerpo de una plantilla: sus variables, su huella y cómo se convierte en
 * el documento concreto que alguien va a firmar.
 *
 * El formato es texto con `{{variable}}` dentro, en los dos idiomas. No se
 * ejecuta nada: se sustituye texto por texto. Una plantilla es un dato que
 * escribe una persona de la empresa, y un motor de plantillas de verdad ahí
 * dentro sería una vía para que ese dato ejecutara código.
 *
 * LA HUELLA es lo que ata una firma a un texto exacto. Se calcula sobre el
 * contenido canónico —los dos títulos, los dos cuerpos y los dos avisos de
 * consentimiento, en orden fijo— y se copia dentro de cada solicitud y de cada
 * registro. Si mañana alguien publica una versión nueva, la huella cambia y las
 * firmas anteriores siguen apuntando a la suya, que es justo lo que permite
 * decir «esto se firmó sobre este texto y no sobre el de ahora».
 */
final class TemplateBody
{
    /** Huella del contenido de una plantilla. */
    public static function contentHash(
        string $titleEn,
        string $titleEs,
        string $bodyEn,
        string $bodyEs,
        string $consentEn,
        string $consentEs,
    ): string {
        return hash('sha256', Seal::canonical([
            'bodyEn' => $bodyEn,
            'bodyEs' => $bodyEs,
            'consentEn' => $consentEn,
            'consentEs' => $consentEs,
            'titleEn' => $titleEn,
            'titleEs' => $titleEs,
        ]));
    }

    /**
     * Las variables que aparecen en un cuerpo, en el orden en que salen.
     *
     * @return list<string>
     */
    public static function tokensIn(string ...$cuerpos): array
    {
        $encontradas = [];

        foreach ($cuerpos as $cuerpo) {
            preg_match_all('/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/', $cuerpo, $coincidencias);

            foreach ($coincidencias[1] as $nombre) {
                if (! in_array($nombre, $encontradas, true)) {
                    $encontradas[] = $nombre;
                }
            }
        }

        return $encontradas;
    }

    /**
     * Las variables obligatorias que NO tienen valor.
     *
     * Se comprueba antes de crear la solicitud y otra vez antes de sellar. Un
     * documento firmado con un «{{carrierLegalName}}» literal en medio no es un
     * acuerdo, es una plantilla con una firma debajo.
     *
     * @param  list<string>  $requeridas
     * @param  array<string, mixed>  $valores
     * @return list<string>
     */
    public static function missingTokens(array $requeridas, array $valores): array
    {
        $faltan = [];

        foreach ($requeridas as $nombre) {
            $valor = $valores[$nombre] ?? null;

            if (! is_string($valor) || trim($valor) === '') {
                $faltan[] = $nombre;
            }
        }

        return $faltan;
    }

    /**
     * Sustituye las variables por sus valores.
     *
     * Una variable sin valor se deja TAL CUAL, con sus llaves. Borrarla dejaría
     * un hueco silencioso en un documento legal —«El transportista  acuerda»—
     * mientras que dejarla salta a la vista de quien lo lee antes de firmarlo.
     *
     * @param  array<string, mixed>  $valores
     */
    public static function render(string $cuerpo, array $valores): string
    {
        return (string) preg_replace_callback(
            '/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/',
            static function (array $m) use ($valores): string {
                $valor = $valores[$m[1]] ?? null;

                return is_string($valor) && trim($valor) !== '' ? $valor : $m[0];
            },
            $cuerpo,
        );
    }
}
