<?php

declare(strict_types=1);

namespace App\Support\Security;

use Illuminate\Support\Facades\Crypt;

/**
 * Un identificador que no puede guardarse en claro: número de licencia, EIN,
 * identificador fiscal.
 *
 * Cada uno se guarda en TRES columnas, y las tres tienen que escribirse juntas
 * o el dato queda inservible:
 *
 *  - `*_encrypted`  — el valor cifrado. Es el único sitio donde existe.
 *  - `*_last4`      — los últimos cuatro, para enseñar «•••• 4821» sin
 *                     descifrar nada. Descifrar para pintar una lista de
 *                     doscientos conductores serían doscientas operaciones
 *                     criptográficas por pantalla.
 *  - `*_hash`       — un índice ciego: HMAC-SHA256 con la clave de la
 *                     aplicación. Permite preguntar «¿ya existe este número?»
 *                     sin descifrar ni una fila, porque el mismo número
 *                     produce siempre el mismo hash.
 *
 * Por qué HMAC y no un hash a secas: un SHA-256 pelado de un número de licencia
 * se rompe con una tabla precalculada en minutos —el espacio de números de
 * licencia es pequeño y predecible—. Con HMAC hace falta además la clave de la
 * aplicación, que no está en la base de datos.
 *
 * Por qué el hash NO sirve para comparar dos empresas distintas: es
 * determinista y global, así que dos empresas con el mismo conductor producen
 * el mismo hash. La detección de duplicados SIEMPRE se hace dentro de una
 * empresa, nunca cruzando. Ver DriverController.
 */
final class SensitiveNumber
{
    /**
     * Las tres columnas de un valor, listas para escribir.
     *
     * @return array{encrypted: string|null, last4: string|null, hash: string|null}
     */
    public static function columns(?string $value): array
    {
        $clean = self::normalize($value);

        if ($clean === null) {
            return ['encrypted' => null, 'last4' => null, 'hash' => null];
        }

        return [
            'encrypted' => Crypt::encryptString($clean),
            'last4' => mb_substr($clean, -4),
            'hash' => self::hash($clean),
        ];
    }

    /**
     * El índice ciego de un valor, para buscarlo.
     *
     * Se normaliza igual que al guardar. Si no, «TX-1234567» y «tx1234567»
     * darían hashes distintos y la detección de duplicados fallaría justo en el
     * caso que existe para atrapar: la misma persona escrita por dos manos.
     */
    public static function hash(string $value): ?string
    {
        $clean = self::normalize($value);

        if ($clean === null) {
            return null;
        }

        // La clave de la aplicación, no una constante en el código. Rotarla
        // invalida los índices ciegos —hay que recalcularlos— pero eso es
        // preferible a que el hash sobreviva a una filtración de la base.
        return hash_hmac('sha256', $clean, (string) config('app.key'));
    }

    /**
     * Descifra para las poquísimas veces que hace falta el valor entero: un
     * envío al proveedor de verificación, una exportación autorizada.
     *
     * NUNCA para pintar una pantalla. Si alguna vista necesita esto, la vista
     * está mal: para eso están los últimos cuatro.
     */
    public static function reveal(?string $encrypted): ?string
    {
        if ($encrypted === null || $encrypted === '') {
            return null;
        }

        try {
            return Crypt::decryptString($encrypted);
        } catch (\Throwable) {
            // Un valor cifrado con una clave anterior. Se devuelve null en vez
            // de reventar: una licencia ilegible es un problema de datos, no
            // motivo para tumbar la pantalla de un conductor.
            return null;
        }
    }

    /**
     * Mayúsculas y sin nada que no sea letra o número.
     *
     * Los guiones y los espacios se los pone cada quien: «TX 1234567»,
     * «TX-1234567» y «tx1234567» son la misma licencia.
     */
    private static function normalize(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $clean = preg_replace('/[^A-Za-z0-9]/', '', $value) ?? '';

        return $clean === '' ? null : mb_strtoupper($clean);
    }
}
