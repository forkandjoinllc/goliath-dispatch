<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

/**
 * La firma que acompaña cada entrega, para que el receptor sepa que venimos de
 * nosotros y que no le están repitiendo un envío viejo.
 *
 * ## La cabecera
 *
 *     X-Goliath-Signature: t=1761048000000,v1=<hex>
 *
 * donde `<hex>` es `HMAC-SHA256(secreto, "<t>.<cuerpo>")`.
 *
 * ## Por qué el tiempo va DENTRO de lo firmado
 *
 * Firmar solo el cuerpo deja la puerta abierta a la repetición: quien capture
 * una entrega puede reenviarla mañana, idéntica y con la firma válida, y el
 * receptor dará de alta al mismo transportista otra vez. Con el momento dentro
 * del material firmado, el receptor puede descartar lo que llegue con muchas
 * horas de retraso sin que nadie pueda retocar esa marca de tiempo.
 *
 * ## Lo que el receptor TIENE que hacer, y no podemos hacer por él
 *
 * Comparar con `hash_equals` —no con `==`—, y rechazar lo que llegue fuera de
 * su ventana de tolerancia. Está escrito en docs/webhook-alta.md porque un
 * esquema de firma que el receptor implementa mal no protege nada, y eso no se
 * arregla desde este lado.
 *
 * ## Lo que esto NO es
 *
 * No es cifrado: el cuerpo viaja legible dentro de TLS. No es autenticación del
 * receptor: que alguien reciba la carga no prueba quién es. Para eso están
 * `https` obligatorio y la validación de destino de `SafeUrl`.
 */
final class Signature
{
    public const HEADER = 'X-Goliath-Signature';

    /** Longitud del secreto que genera el botón de «crear secreto». */
    public const BYTES = 32;

    public static function generateSecret(): string
    {
        // `whsec_` delante para que quien lo vea pegado en un fichero de
        // configuración sepa qué es. El prefijo no es secreto y no resta
        // entropía: los 32 bytes van detrás.
        return 'whsec_'.bin2hex(random_bytes(self::BYTES));
    }

    public static function for(string $secret, string $body, int $timestampMs): string
    {
        return 't='.$timestampMs.',v1='.hash_hmac('sha256', $timestampMs.'.'.$body, $secret);
    }

    /**
     * Comprueba una firma. Existe para las pruebas y para el ejemplo de la
     * documentación: en producción quien comprueba es el receptor.
     */
    public static function check(string $secret, string $body, string $header, int $toleranceSeconds = 300): bool
    {
        $partes = [];

        foreach (explode(',', $header) as $trozo) {
            [$k, $v] = array_pad(explode('=', trim($trozo), 2), 2, '');
            $partes[$k] = $v;
        }

        if (! isset($partes['t'], $partes['v1']) || ! ctype_digit($partes['t'])) {
            return false;
        }

        $t = (int) $partes['t'];

        if (abs((int) (microtime(true) * 1000) - $t) > $toleranceSeconds * 1000) {
            return false;
        }

        // hash_equals y no ==: comparar firmas carácter a carácter filtra, por
        // el tiempo que tarda en fallar, cuántos caracteres se acertaron.
        return hash_equals(hash_hmac('sha256', $t.'.'.$body, $secret), (string) $partes['v1']);
    }
}
