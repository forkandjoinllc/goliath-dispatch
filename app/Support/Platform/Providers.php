<?php

declare(strict_types=1);

namespace App\Support\Platform;

use App\Services\Billing\BillingProvider;
use App\Services\Fmcsa\FmcsaDirectory;
use App\Support\Routing\RouteProvider;
use App\Support\Routing\StopDerivedRouteProvider;
use App\Support\Signatures\Seal;
use App\Support\Storage\DocumentStore;
use App\Support\Storage\LocalDocumentStore;
use Illuminate\Support\Facades\Config;

/**
 * Qué proveedor está atado a cada interfaz, y si es el real o el simulado.
 *
 * SE CALCULA, NO SE GUARDA. La pregunta «¿el FMCSA de esta instalación es el de
 * verdad?» la contesta el contenedor de dependencias, que es quien ató la clase
 * al arrancar. Una tabla con esa respuesta escrita podría decir «conectado»
 * mientras la variable de entorno ya no está, y esa es exactamente la mentira
 * que esta pantalla existe para no contar.
 *
 * POR QUÉ NO SE ESCRIBE EN `integration_connections`. Esa tabla tiene
 * `tenant_id` NOT NULL y una columna `credentials_encrypted`: es el almacén de
 * las integraciones que conecta CADA EMPRESA con sus propias credenciales —su
 * cuenta de telemática, su pasarela— y no el inventario de lo que la
 * instalación tiene configurado. Meter ahí filas de plataforma con un tenant
 * inventado habría llenado una tabla a costa de que dejara de significar lo que
 * significa. Sigue vacía, y sigue esperando la pantalla de integraciones por
 * empresa.
 */
final class Providers
{
    /**
     * Tres estados y no dos, porque «real o simulado» no describe todo lo que
     * hay:
     *
     *  - `live`      — el proveedor de verdad, configurado.
     *  - `mock`      — un sustituto que NO hace lo que dice hacer: el FMCSA
     *                  simulado no consulta a nadie, el correo `log` no manda
     *                  nada.
     *  - `fallback`  — funciona de verdad, pero no es lo que debería haber en
     *                  producción. El disco local guarda ficheros; el sello de
     *                  firma con clave derivada sella de verdad. Llamarlos
     *                  «simulados» sería mentir en la dirección contraria.
     *
     * `detail` es una variable de entorno que falta solo cuando `envVar` lo
     * dice. Sin esa distinción la pantalla escribía «Falta storage/logs».
     *
     * @return list<array{
     *     key: string, interface: string, bound: string,
     *     status: string, detail: string|null, envVar: bool,
     * }>
     */
    public static function inventory(): array
    {
        return [
            self::fmcsa(),
            self::almacenamiento(),
            self::rutas(),
            self::correo(),
            self::pagos(),
            self::sms(),
            self::selloDeFirma(),
        ];
    }

    /** @return array<string, mixed> */
    private static function fmcsa(): array
    {
        $directorio = app(FmcsaDirectory::class);

        return [
            'key' => 'fmcsa',
            'interface' => 'FmcsaDirectory',
            'bound' => class_basename($directorio),
            'status' => $directorio->isLive() ? 'live' : 'mock',
            'detail' => $directorio->isLive()
                ? (string) Config::get('services.fmcsa.base_url')
                : 'FMCSA_WEBKEY',
            'envVar' => ! $directorio->isLive(),
        ];
    }

    /** @return array<string, mixed> */
    private static function almacenamiento(): array
    {
        $store = app(DocumentStore::class);
        $local = $store instanceof LocalDocumentStore;

        return [
            'key' => 'storage',
            'interface' => 'DocumentStore',
            'bound' => class_basename($store),
            // El disco local NO es un simulacro: guarda ficheros de verdad. Lo
            // que no hace es sobrevivir a un segundo servidor ni traer copias
            // de seguridad, y por eso es `fallback` y no `live`.
            'status' => $local ? 'fallback' : 'live',
            'detail' => $local ? 'storage/app/private' : 'S3',
            'envVar' => false,
        ];
    }

    /** @return array<string, mixed> */
    private static function rutas(): array
    {
        $proveedor = app(RouteProvider::class);
        $simulado = $proveedor instanceof StopDerivedRouteProvider;

        return [
            'key' => 'routing',
            'interface' => 'RouteProvider',
            'bound' => class_basename($proveedor),
            'status' => $simulado ? 'mock' : 'live',
            'detail' => $simulado ? null : $proveedor->name(),
            'envVar' => false,
        ];
    }

    /** @return array<string, mixed> */
    private static function correo(): array
    {
        $mailer = (string) Config::get('mail.default');

        // `log` y `array` no mandan nada a nadie. `smtp` sin host tampoco, y
        // decir que sí sería peor que decir que no.
        $manda = ! in_array($mailer, ['log', 'array'], true)
            && trim((string) Config::get('mail.mailers.'.$mailer.'.host', '')) !== '';

        return [
            'key' => 'email',
            'interface' => 'Mail',
            'bound' => $mailer,
            'status' => $manda ? 'live' : 'mock',
            // El detalle es un destino, no una variable de entorno: escribir
            // «Falta storage/logs» era decir que falta un directorio que está.
            'detail' => $manda
                ? (string) Config::get('mail.mailers.'.$mailer.'.host')
                : ($mailer === 'log' ? 'storage/logs' : $mailer),
            'envVar' => false,
        ];
    }

    /** @return array<string, mixed> */
    private static function pagos(): array
    {
        // Antes esto miraba `services.stripe.secret` y decía «sin configurar».
        // Ahora hay una interfaz atada de verdad, así que se pregunta a la
        // aplicación qué adaptador corre — igual que con FMCSA. La diferencia
        // importa: la configuración dice qué se PIDIÓ, y el contenedor dice qué
        // se está USANDO, que es lo que alguien viene a comprobar.
        $proveedor = app(BillingProvider::class);

        // Hacen falta LAS DOS. Con solo la secreta, el adaptador real cobraría y
        // no se enteraría nunca de que le pagaron: los sucesos llegan por el
        // webhook y sin su secreto no se pueden verificar. Se nombra la que
        // falta, no una genérica.
        $secreta = trim((string) Config::get('services.stripe.secret', ''));
        $webhook = trim((string) Config::get('services.stripe.webhook_secret', ''));

        $falta = $secreta === '' ? 'STRIPE_SECRET' : ($webhook === '' ? 'STRIPE_WEBHOOK_SECRET' : null);

        return [
            'key' => 'payments',
            'interface' => 'BillingProvider',
            'bound' => class_basename($proveedor),
            'status' => $proveedor->isLive() ? 'live' : 'mock',
            'detail' => $falta,
            'envVar' => $falta !== null,
        ];
    }

    /** @return array<string, mixed> */
    private static function sms(): array
    {
        $sid = trim((string) Config::get('services.twilio.sid', ''));

        return [
            'key' => 'sms',
            'interface' => 'Twilio',
            'bound' => $sid === '' ? 'sin configurar' : 'twilio',
            'status' => $sid === '' ? 'mock' : 'live',
            'detail' => $sid === '' ? 'TWILIO_SID' : null,
            'envVar' => $sid === '',
        ];
    }

    /**
     * El sello de firma no es un proveedor externo, pero pertenece a esta lista
     * por el mismo motivo: es una configuración del servidor que, si falta,
     * funciona igual y cuesta caro más tarde. Rotar APP_KEY sin un pepper propio
     * invalida todos los sellos anteriores.
     *
     * @return array<string, mixed>
     */
    private static function selloDeFirma(): array
    {
        $derivada = Seal::usingDerivedKey();

        return [
            'key' => 'signatureSeal',
            'interface' => 'Seal',
            'bound' => $derivada ? 'derivada de APP_KEY' : 'SIGNATURE_HASH_PEPPER',
            // `fallback` y no `mock`: el sello se hace de verdad y las firmas
            // son verificables. Lo que pasa es que rotar APP_KEY las
            // invalidaría todas. Llamarlo «simulado» diría que no sella.
            'status' => $derivada ? 'fallback' : 'live',
            'detail' => $derivada ? 'SIGNATURE_HASH_PEPPER' : null,
            'envVar' => $derivada,
        ];
    }
}
