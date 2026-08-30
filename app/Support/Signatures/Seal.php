<?php

declare(strict_types=1);

namespace App\Support\Signatures;

use Illuminate\Support\Facades\Config;

/**
 * El sello de integridad de un registro de firma, y la clave con la que se hace.
 *
 * El sello es un HMAC-SHA256 sobre los componentes que definen QUÉ se firmó y
 * QUIÉN lo firmó: la huella de la plantilla, la del documento, la de la propia
 * firma, la identidad del firmante y el instante. Cambiar cualquiera de esos
 * datos después rompe el sello, y `Verifier` lo recalcula en cada visita en vez
 * de leer una bandera guardada — una bandera se puede cambiar con el mismo
 * `update` que cambió lo que decía proteger.
 *
 * POR QUÉ HMAC Y NO UN SHA A SECAS: un sha256 lo puede recalcular cualquiera
 * que tenga la fila, así que quien modificara el registro podría reescribir el
 * sello para que cuadre. El HMAC necesita una clave que no está en la base de
 * datos, así que un atacante con acceso a MySQL —o una copia de seguridad
 * robada— puede alterar la fila pero no puede volver a sellarla.
 *
 * LA CLAVE. `SIGNATURE_HASH_PEPPER` va en el entorno del servidor. Si falta, se
 * DERIVA de `APP_KEY` en vez de fallar, y aquí está el razonamiento: una clave
 * ausente que tumbe la aplicación convierte un despliegue olvidadizo en una
 * caída, y una clave ausente que se sustituya por una constante vacía no
 * protege nada. Derivarla de `APP_KEY` da una clave que ya es secreta, ya es
 * distinta en cada instalación y ya está fuera del repositorio. Lo que hay que
 * saber es lo que cuesta: si algún día se rota `APP_KEY` sin poner un pepper
 * propio, TODOS los sellos anteriores dejan de validar. Por eso el verificador
 * distingue «sello no válido» de «no se puede verificar», y por eso
 * `docs/signatures.md` dice que en producción se ponga el pepper explícito.
 */
final class Seal
{
    public const ALGORITHM = 'HMAC-SHA256';

    /**
     * @param  array<string, string>  $componentes  Se ordenan por clave antes
     *                                              de unirse: el sello no puede
     *                                              depender del orden en que
     *                                              quien llama pasó los datos.
     */
    public static function compute(array $componentes): string
    {
        ksort($componentes);

        $canonico = self::canonical($componentes);

        return hash_hmac('sha256', $canonico, self::key());
    }

    /**
     * Los componentes de un registro de firma, en la forma exacta que se sella.
     *
     * Vive aquí y no en quien la escribe para que sellar y verificar no puedan
     * discrepar: las dos llamadas pasan por esta función.
     *
     * @return array<string, string>
     */
    public static function components(
        string $templateContentHash,
        string $documentSha256,
        string $signatureSha256,
        string $signerLegalName,
        string $signerEmail,
        string $signedAt,
    ): array {
        return [
            'documentSha256' => $documentSha256,
            'signatureSha256' => $signatureSha256,
            'signedAt' => $signedAt,
            'signerEmail' => mb_strtolower(trim($signerEmail)),
            'signerLegalName' => trim($signerLegalName),
            'templateContentHash' => $templateContentHash,
        ];
    }

    /**
     * La forma canónica de un conjunto de componentes.
     *
     * `clave=valor` separados por salto de línea. Se elige esto y no JSON
     * porque `json_encode` puede cambiar de escapado entre versiones de PHP, y
     * un sello que dependa de eso caducaría en una actualización del intérprete.
     *
     * @param  array<string, string>  $componentes
     */
    public static function canonical(array $componentes): string
    {
        ksort($componentes);

        $lineas = [];

        foreach ($componentes as $clave => $valor) {
            // El valor no puede llevar saltos de línea sin escapar o dos
            // conjuntos distintos podrían dar la misma cadena canónica.
            $lineas[] = $clave.'='.str_replace(["\\", "\n", "\r"], ['\\\\', '\\n', '\\r'], $valor);
        }

        return implode("\n", $lineas);
    }

    /** ¿Hay un pepper explícito, o se está usando el derivado de APP_KEY? */
    public static function usingDerivedKey(): bool
    {
        return self::pepper() === null;
    }

    private static function key(): string
    {
        $pepper = self::pepper();

        if ($pepper !== null) {
            return $pepper;
        }

        // Derivada, no la propia APP_KEY: si esta clave se filtrara por
        // cualquier vía, no debe servir para descifrar sesiones ni cookies.
        return hash_hmac('sha256', 'goliath:signature-seal:v1', (string) Config::get('app.key'), true);
    }

    private static function pepper(): ?string
    {
        $valor = Config::get('signatures.pepper');

        if (! is_string($valor) || trim($valor) === '') {
            return null;
        }

        return $valor;
    }
}
