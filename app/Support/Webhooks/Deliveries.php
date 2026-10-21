<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

use App\Models\Lead;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * El webhook del alta de transportista: anotar, entregar y poder contarlo.
 *
 * ## Se ANOTA al enviar el formulario, y se ENTREGA después
 *
 * `record()` escribe una fila en `webhook_deliveries` y no toca la red.
 * `attempt()` es quien sale a buscarla, y lo llama el barrido `webhooks:deliver`.
 *
 * Esa separación es lo que hace que el alta no dependa del webhook: entre
 * perder el contacto de un transportista y perder una llamada a un sistema de
 * terceros no hay duda de cuál duele menos. El alta ya hacía esto mismo con el
 * aviso interno (`Arrival::announce`, fuera de la transacción).
 *
 * ## Por qué un barrido y NO una cola
 *
 * Este proyecto no tiene cola: no hay `app/Jobs`, no hay un solo `ShouldQueue`,
 * y en Forge no corre ningún worker. Montar la entrega sobre una cola habría
 * dejado el webhook «disparándose» sin que nada lo entregara, que es
 * exactamente el fallo que este lote viene a evitar.
 *
 * Lo que sí existe es el planificador: `routes/console.php` ya corre
 * `notifications:sweep` y `retention:sweep` con el cron de Forge. El webhook va
 * por ahí. Y como un planificador parado es indistinguible de «no ha pasado
 * nada», la pantalla de ajustes DICE cuándo fue el último barrido — igual que
 * ya hace con la revalidación de FMCSA.
 *
 * ## Lo que NO viaja en la carga
 *
 * Ni el identificador interno de la empresa, ni nada de otros prospectos. Va lo
 * que esa persona escribió en ese formulario y el identificador de SU registro,
 * que es lo que el receptor necesita para no duplicarlo.
 */
final class Deliveries
{
    public const EVENTO_ALTA = 'carrier.signup.submitted';

    /** Espera entre intentos, en minutos. Un intento por posición. */
    private const ESPERAS = [1, 5, 15, 60, 360, 1440];

    /** Una entrega en vuelo que lleve más de esto se da por caída y se rescata. */
    private const RESCATE_MINUTOS = 15;

    private const TIEMPO_LIMITE = 10;

    /**
     * Anota la entrega pendiente. No toca la red.
     *
     * Devuelve el identificador de la fila, o null si esta empresa no tiene el
     * webhook encendido — que es el caso normal y no es un fallo.
     *
     * @param  array<string, mixed>  $datos  lo validado del formulario
     */
    public static function record(string $tenantId, Lead $lead, array $datos): ?string
    {
        $ajustes = self::settings($tenantId);

        if (! $ajustes['enabled'] || $ajustes['url'] === null) {
            return null;
        }

        $id = (string) Str::uuid();

        DB::table('webhook_deliveries')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'event' => self::EVENTO_ALTA,
            'subject_type' => 'lead',
            'subject_id' => (string) $lead->id,
            // Congelada: si mañana cambian el destino, esta entrega sigue yendo
            // a donde se creó y el registro dice la verdad sobre a dónde fue.
            'url' => $ajustes['url'],
            'payload' => json_encode(self::payload($lead, $datos), JSON_UNESCAPED_UNICODE),
            'status' => 'pending',
            'next_attempt_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }

    /**
     * La carga: lo del alta y nada más.
     *
     * @param  array<string, mixed>  $datos
     * @return array<string, mixed>
     */
    public static function payload(Lead $lead, array $datos): array
    {
        return [
            'event' => self::EVENTO_ALTA,
            'occurredAt' => CarbonImmutable::now()->toIso8601String(),
            'lead' => [
                'id' => (string) $lead->id,
                'locale' => (string) $lead->locale?->value,
            ],
            'carrier' => [
                'legalName' => $datos['legal_name'] ?? null,
                'dba' => $datos['dba'] ?? null,
                'dotNumber' => $datos['dot_number'] ?? null,
                'mcNumber' => $datos['mc_number'] ?? null,
                'website' => $datos['website'] ?? null,
                'contactFirstName' => $datos['contact_first_name'] ?? null,
                'contactLastName' => $datos['contact_last_name'] ?? null,
                'email' => $datos['email'] ?? null,
                'phone' => $datos['phone'] ?? null,
                'address' => [
                    'line1' => $datos['physical_line1'] ?? null,
                    'line2' => $datos['physical_line2'] ?? null,
                    'city' => $datos['physical_city'] ?? null,
                    'state' => $datos['physical_state'] ?? null,
                    'postalCode' => $datos['physical_postal_code'] ?? null,
                    'country' => 'US',
                ],
                'preferredLocale' => $datos['preferred_locale'] ?? null,
                'usesFactoring' => (bool) ($datos['uses_factoring'] ?? false),
                'factoringCompany' => $datos['factoring_company_name'] ?? null,
            ],
        ];
    }

    /**
     * Intenta UNA entrega. Devuelve el estado en que queda la fila.
     */
    public static function attempt(object $fila): string
    {
        $ajustes = self::settings((string) $fila->tenant_id);
        $cuerpo = (string) $fila->payload;

        if ($ajustes['secret'] === null) {
            return self::fallo($fila, null, null, 'no_secret', definitivo: true);
        }

        $destino = SafeUrl::check((string) $fila->url);

        if (! $destino['ok']) {
            // Un destino que no se puede visitar no mejora reintentando: o lo
            // arregla una persona en los ajustes, o no hay nada que hacer.
            return self::fallo($fila, null, null, 'url_'.$destino['reason'], definitivo: true);
        }

        $t = (int) (microtime(true) * 1000);

        try {
            $respuesta = Http::withHeaders([
                'Content-Type' => 'application/json',
                Signature::HEADER => Signature::for((string) $ajustes['secret'], $cuerpo, $t),
                'X-Goliath-Event' => (string) $fila->event,
                'X-Goliath-Delivery' => (string) $fila->id,
                'X-Goliath-Attempt' => (string) ((int) $fila->attempts + 1),
                'User-Agent' => 'GoliathDispatch-Webhook/1',
            ])
                ->withOptions([
                    // Sin redirecciones: un 302 a 169.254.169.254 se saltaría
                    // entera la validación de destino.
                    'allow_redirects' => false,
                    // Y se CONGELA la dirección ya comprobada, para que entre
                    // validar y conectar nadie pueda cambiar a qué resuelve el
                    // nombre. Ver SafeUrl, defensa 4.
                    'curl' => [
                        CURLOPT_RESOLVE => [
                            $destino['host'].':'.$destino['port'].':'.$destino['ip'],
                        ],
                    ],
                ])
                ->timeout(self::TIEMPO_LIMITE)
                ->withBody($cuerpo, 'application/json')
                ->post((string) $fila->url);
        } catch (Throwable $e) {
            Log::warning('webhook: fallo de red', ['delivery' => (string) $fila->id]);

            return self::fallo($fila, null, null, mb_substr($e->getMessage(), 0, 500));
        }

        if ($respuesta->successful()) {
            DB::table('webhook_deliveries')->where('id', $fila->id)->update([
                'status' => 'delivered',
                'attempts' => (int) $fila->attempts + 1,
                'last_attempt_at' => now(),
                'delivered_at' => now(),
                'next_attempt_at' => null,
                'response_status' => $respuesta->status(),
                'response_body' => mb_substr($respuesta->body(), 0, 500),
                'error' => null,
                'updated_at' => now(),
            ]);

            return 'delivered';
        }

        return self::fallo(
            $fila,
            $respuesta->status(),
            mb_substr($respuesta->body(), 0, 500),
            null,
            // 4xx que no sea 408 ni 429 no mejora reintentando: el receptor
            // dice que la petición está mal, y mañana estará igual de mal.
            definitivo: $respuesta->status() >= 400
                && $respuesta->status() < 500
                && ! in_array($respuesta->status(), [408, 429], true),
        );
    }

    private static function fallo(
        object $fila,
        ?int $estado,
        ?string $cuerpo,
        ?string $error,
        bool $definitivo = false,
    ): string {
        $intentos = (int) $fila->attempts + 1;
        $agotado = $definitivo || $intentos >= (int) $fila->max_attempts;

        $espera = self::ESPERAS[min($intentos, count(self::ESPERAS)) - 1];

        DB::table('webhook_deliveries')->where('id', $fila->id)->update([
            'status' => $agotado ? 'abandoned' : 'pending',
            'attempts' => $intentos,
            'last_attempt_at' => now(),
            'next_attempt_at' => $agotado ? null : now()->addMinutes($espera),
            'response_status' => $estado,
            'response_body' => $cuerpo,
            'error' => $error,
            'updated_at' => now(),
        ]);

        return $agotado ? 'abandoned' : 'pending';
    }

    /**
     * Las entregas que tocan ahora, reclamadas para que dos barridos a la vez
     * no manden la misma dos veces.
     *
     * @return list<object>
     */
    public static function claimDue(int $limite = 25): array
    {
        self::rescueStuck();

        $ids = DB::table('webhook_deliveries')
            ->where('status', 'pending')
            ->whereNotNull('next_attempt_at')
            ->where('next_attempt_at', '<=', now())
            ->orderBy('next_attempt_at')
            ->limit($limite)
            ->pluck('id')
            ->all();

        if ($ids === []) {
            return [];
        }

        DB::table('webhook_deliveries')
            ->whereIn('id', $ids)
            ->where('status', 'pending')
            ->update(['status' => 'sending', 'last_attempt_at' => now(), 'updated_at' => now()]);

        return DB::table('webhook_deliveries')->whereIn('id', $ids)->get()->all();
    }

    /**
     * Devuelve a la cola lo que se quedó «enviando» porque el proceso se cayó.
     *
     * Sin esto, una entrega perdida se queda perdida y la pantalla enseña que
     * sigue trabajando. Un estado intermedio sin rescate es una fuga lenta.
     */
    public static function rescueStuck(): int
    {
        return DB::table('webhook_deliveries')
            ->where('status', 'sending')
            ->where('last_attempt_at', '<', now()->subMinutes(self::RESCATE_MINUTOS))
            ->update(['status' => 'pending', 'next_attempt_at' => now(), 'updated_at' => now()]);
    }

    /**
     * La configuración de esta empresa, con el secreto descifrado.
     *
     * @return array{enabled: bool, url: string|null, secret: string|null, last4: string|null}
     */
    public static function settings(string $tenantId): array
    {
        $f = DB::table('tenant_settings')->where('tenant_id', $tenantId)->first([
            'carrier_signup_webhook_url',
            'carrier_signup_webhook_secret_encrypted',
            'carrier_signup_webhook_secret_last4',
            'carrier_signup_webhook_enabled',
        ]);

        if ($f === null) {
            return ['enabled' => false, 'url' => null, 'secret' => null, 'last4' => null];
        }

        $secreto = null;

        if ($f->carrier_signup_webhook_secret_encrypted !== null) {
            try {
                $secreto = Crypt::decryptString((string) $f->carrier_signup_webhook_secret_encrypted);
            } catch (Throwable) {
                // Una clave de aplicación rotada deja el secreto ilegible. Se
                // devuelve null y la entrega falla diciendo por qué, en vez de
                // mandar carga firmada con basura.
                $secreto = null;
            }
        }

        return [
            'enabled' => (bool) $f->carrier_signup_webhook_enabled,
            'url' => $f->carrier_signup_webhook_url === null ? null : (string) $f->carrier_signup_webhook_url,
            'secret' => $secreto,
            'last4' => $f->carrier_signup_webhook_secret_last4 === null
                ? null : (string) $f->carrier_signup_webhook_secret_last4,
        ];
    }
}
