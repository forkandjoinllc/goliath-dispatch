<?php

declare(strict_types=1);

namespace App\Support\Forms;

use Illuminate\Support\Facades\Config;
use Illuminate\Support\Str;

/**
 * Un sello de tiempo firmado, emitido por el servidor al renderizar el
 * formulario y verificado al recibirlo.
 *
 * Por qué firmado y no un simple `renderedAt` del cliente: el original en
 * Next.js mandaba `Date.now()` desde el navegador y comprobaba en el servidor
 * que hubieran pasado tres segundos. Un bot no ejecuta el JavaScript — manda el
 * POST directamente— y puede poner en ese campo cualquier valor, por ejemplo uno
 * de hace diez segundos. La comprobación parecía existir y no existía.
 *
 * Firmando con APP_KEY, el cliente no puede fabricar un sello: o viene de una
 * página que servimos nosotros, o no pasa.
 *
 * Sigue sin ser un CAPTCHA, y eso es intencionado: un CAPTCHA cobra el peaje a
 * quien rellena el formulario con un lector de pantalla, no al bot. Esto, más el
 * campo trampa y el límite por IP, para el volumen automatizado sin cobrarle
 * nada a nadie.
 */
final class FormToken
{
    /** Por debajo de esto no lo ha escrito una persona. */
    public const MIN_SECONDS = 3;

    /** Por encima, la pestaña llevaba horas abierta: mejor que recargue. */
    public const MAX_SECONDS = 7200;

    public static function issue(string $form): string
    {
        $payload = json_encode(['f' => $form, 't' => (int) (microtime(true) * 1000)], JSON_THROW_ON_ERROR);
        $body = rtrim(strtr(base64_encode($payload), '+/', '-_'), '=');

        return $body.'.'.self::sign($body);
    }

    /**
     * @param  bool  $exigirPausa  Si se exige que hayan pasado `MIN_SECONDS`.
     *
     * ## Por qué la pausa es opcional
     *
     * La pausa existe para los ENVÍOS: nadie rellena veinte campos en tres
     * segundos, así que quien lo hace es un script. Pero el mismo sello vale
     * para la búsqueda en el registro federal del alta de transportista, y ahí
     * la regla dice lo contrario de lo que quiere decir: a esa casilla llega
     * alguien con el número del DOT ya en la mano, lo pega y pulsa buscar. Es
     * el camino rápido, no el sospechoso.
     *
     * Lo que sujeta la búsqueda frente al abuso es el límite por IP, que es la
     * defensa que de verdad cuenta peticiones.
     * @return array{valid: bool, reason?: 'malformed'|'bad_signature'|'wrong_form'|'too_fast'|'expired'|'future'}
     */
    public static function verify(?string $token, string $form, bool $exigirPausa = true): array
    {
        if ($token === null || ! str_contains($token, '.')) {
            return ['valid' => false, 'reason' => 'malformed'];
        }

        [$body, $signature] = explode('.', $token, 2);

        // hash_equals y no ===: la comparación de firmas debe ser de tiempo
        // constante o su duración filtra cuántos bytes coincidían.
        if (! hash_equals(self::sign($body), $signature)) {
            return ['valid' => false, 'reason' => 'bad_signature'];
        }

        $decoded = base64_decode(strtr($body, '-_', '+/'), true);
        $payload = $decoded === false ? null : json_decode($decoded, true);

        if (! is_array($payload) || ! isset($payload['f'], $payload['t'])) {
            return ['valid' => false, 'reason' => 'malformed'];
        }

        // Un sello emitido para el formulario de contacto no vale para el alta de
        // transportista: si no, uno solo serviría para todo el sitio.
        if ($payload['f'] !== $form) {
            return ['valid' => false, 'reason' => 'wrong_form'];
        }

        $elapsed = (microtime(true) * 1000) - (float) $payload['t'];

        if ($elapsed < 0) {
            return ['valid' => false, 'reason' => 'future'];
        }
        if ($exigirPausa && $elapsed < self::MIN_SECONDS * 1000) {
            return ['valid' => false, 'reason' => 'too_fast'];
        }
        if ($elapsed > self::MAX_SECONDS * 1000) {
            return ['valid' => false, 'reason' => 'expired'];
        }

        return ['valid' => true];
    }

    private static function sign(string $body): string
    {
        $key = (string) Config::get('app.key');

        if (Str::startsWith($key, 'base64:')) {
            $key = (string) base64_decode(Str::after($key, 'base64:'), true);
        }

        return hash_hmac('sha256', $body, $key);
    }
}
