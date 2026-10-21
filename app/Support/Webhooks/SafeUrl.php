<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

/**
 * ¿Se puede mandar una petición a esta URL sin convertir el servidor en el
 * cliente HTTP de quien la escribió?
 *
 * ## El ataque
 *
 * Un administrador —o alguien que le haya tomado prestada la sesión— escribe
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/` en el
 * campo del webhook. Nuestro servidor sale a buscarlo desde DENTRO de la nube,
 * con la red interna a su alcance, y le entrega el resultado. Lo mismo vale
 * para `http://127.0.0.1:3306`, para `http://10.0.0.5/admin` y para cualquier
 * nombre público que resuelva a una dirección privada.
 *
 * ## Las cuatro defensas, y en qué orden
 *
 * 1. **Solo `https`.** Sin excepción para «mi receptor es interno»: cifrar el
 *    canal no es negociable cuando lo que viaja lleva nombre, correo y teléfono
 *    de una persona. Y de paso cierra `file://`, `gopher://` y `dict://`.
 * 2. **Nada de credenciales en la URL.** `https://user:pass@host/` manda esas
 *    credenciales a quien conteste, y además sirve para disfrazar el destino.
 * 3. **Toda dirección a la que resuelve el nombre tiene que ser pública.** No
 *    basta con mirar si el host «parece» una IP privada: `interno.ejemplo.com`
 *    puede resolver a `10.0.0.5`, y un atacante controla su propio DNS.
 * 4. **Se CONGELA la dirección validada.** Entre resolver para validar y
 *    resolver para conectar hay una ventana en la que el mismo nombre puede
 *    pasar a contestar otra dirección —el ataque se llama «rebinding de DNS»—.
 *    Por eso `resolved()` devuelve la IP comprobada y quien envía le dice a
 *    cURL que use ESA, en vez de volver a preguntar.
 *
 * ## Lo que esto NO garantiza
 *
 * Que el destino sea de quien dice ser. Una IP pública puede ser de cualquiera,
 * y un receptor legítimo puede estar comprometido. Esto cierra la puerta a la
 * red interna; no certifica al que está al otro lado. Por eso la carga va
 * FIRMADA y no lleva más de lo que hace falta.
 *
 * Tampoco impide que un nombre que hoy es público apunte mañana a otro sitio.
 * Cada entrega se valida de nuevo, que es lo único que se puede hacer.
 */
final class SafeUrl
{
    /** Rangos que nunca son un destino legítimo de webhook. */
    private const PROHIBIDOS_V4 = [
        ['0.0.0.0', 8],          // «esta» red
        ['10.0.0.0', 8],         // privada
        ['100.64.0.0', 10],      // CGNAT
        ['127.0.0.0', 8],        // loopback
        ['169.254.0.0', 16],     // enlace local — incluye la metadata de la nube
        ['172.16.0.0', 12],      // privada
        ['192.0.0.0', 24],       // IETF
        ['192.168.0.0', 16],     // privada
        ['198.18.0.0', 15],      // pruebas de rendimiento
        ['224.0.0.0', 4],        // multicast
        ['240.0.0.0', 4],        // reservada
    ];

    /**
     * @param  callable(string): list<string>|null  $resolver  inyectable en pruebas
     * @return array{ok: bool, reason: string|null, host: string|null, ip: string|null, port: int}
     */
    public static function check(string $url, ?callable $resolver = null): array
    {
        $no = static fn (string $motivo): array => [
            'ok' => false, 'reason' => $motivo, 'host' => null, 'ip' => null, 'port' => 443,
        ];

        $partes = parse_url($url);

        if ($partes === false || ! isset($partes['scheme'], $partes['host'])) {
            return $no('malformed');
        }

        if (strtolower((string) $partes['scheme']) !== 'https') {
            return $no('scheme');
        }

        if (isset($partes['user']) || isset($partes['pass'])) {
            return $no('credentials');
        }

        $host = strtolower((string) $partes['host']);
        $puerto = (int) ($partes['port'] ?? 443);

        if ($host === '') {
            return $no('malformed');
        }

        // Un nombre entre corchetes es una IPv6 literal.
        $host = trim($host, '[]');

        $direcciones = self::direcciones($host, $resolver);

        if ($direcciones === []) {
            return $no('dns');
        }

        // TODAS tienen que ser públicas. Con una sola interna basta para que el
        // nombre sirva de puente: si se dejara pasar «la primera que valga», un
        // atacante solo tendría que publicar dos direcciones.
        foreach ($direcciones as $ip) {
            if (! self::publica($ip)) {
                return $no('private_address');
            }
        }

        return [
            'ok' => true,
            'reason' => null,
            'host' => $host,
            'ip' => $direcciones[0],
            'port' => $puerto,
        ];
    }

    public static function valid(string $url): bool
    {
        return self::check($url)['ok'];
    }

    /**
     * Las direcciones a las que resuelve el nombre, o la propia si ya es una IP.
     *
     * @param  callable(string): list<string>|null  $resolver
     * @return list<string>
     */
    private static function direcciones(string $host, ?callable $resolver): array
    {
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return [$host];
        }

        if ($resolver !== null) {
            return $resolver($host);
        }

        $encontradas = [];

        foreach ([DNS_A, DNS_AAAA] as $tipo) {
            $registros = @dns_get_record($host, $tipo);

            if ($registros === false) {
                continue;
            }

            foreach ($registros as $r) {
                $ip = $r['ip'] ?? $r['ipv6'] ?? null;

                if (is_string($ip) && $ip !== '') {
                    // Indexado por la propia dirección: un nombre con A y AAAA
                    // repetidas no cuenta dos veces, y sale una lista limpia.
                    $encontradas[$ip] = $ip;
                }
            }
        }

        return array_values($encontradas);
    }

    private static function publica(string $ip): bool
    {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            foreach (self::PROHIBIDOS_V4 as [$red, $bits]) {
                if (self::enRango($ip, $red, $bits)) {
                    return false;
                }
            }

            return true;
        }

        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false) {
            return false;
        }

        $bin = @inet_pton($ip);

        if ($bin === false) {
            return false;
        }

        // ::1 (loopback) y :: (sin especificar)
        if ($bin === str_repeat("\0", 15)."\1" || $bin === str_repeat("\0", 16)) {
            return false;
        }

        $primero = ord($bin[0]);

        // fc00::/7 — únicas locales
        if (($primero & 0xFE) === 0xFC) {
            return false;
        }

        // fe80::/10 — enlace local
        if ($primero === 0xFE && (ord($bin[1]) & 0xC0) === 0x80) {
            return false;
        }

        // ::ffff:0:0/96 — una IPv4 disfrazada de IPv6 se juzga como IPv4.
        if (str_starts_with($bin, str_repeat("\0", 10)."\xFF\xFF")) {
            return self::publica(inet_ntop(substr($bin, 12)) ?: '0.0.0.0');
        }

        return true;
    }

    private static function enRango(string $ip, string $red, int $bits): bool
    {
        $a = ip2long($ip);
        $b = ip2long($red);

        if ($a === false || $b === false) {
            return false;
        }

        $mascara = $bits === 0 ? 0 : (-1 << (32 - $bits));

        return ($a & $mascara) === ($b & $mascara);
    }
}
