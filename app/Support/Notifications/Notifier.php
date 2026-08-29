<?php

declare(strict_types=1);

namespace App\Support\Notifications;

use App\Enums\Locale;
use App\Enums\Role;
use App\Authorization\RoleMatrix;
use App\Enums\Scope;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * El único sitio que escribe en `notifications`.
 *
 * Hasta este lote la aplicación no hacía NADA por su cuenta: `routes/console.php`
 * no tenía un solo comando, así que un documento caducaba y nadie se enteraba, y
 * `fmcsa_reverification_days` se guardaba sin revalidar a nadie. Las tres tablas
 * de avisos llevaban vacías desde el primer día — aunque el esquema estaba
 * escrito para esto: el índice único sobre `dedupe_key` lleva un comentario que
 * dice, literalmente, que existe para que el barrido diario no vuelva a avisar
 * cada mañana.
 *
 * Cuatro decisiones que sostienen esta clase:
 *
 *  - **Deduplicar es obligatorio, no una optimización.** Un barrido que corre
 *    todos los días vuelve a encontrar el mismo documento a punto de caducar
 *    todos los días. Sin `dedupe_key` la campana tendría treinta copias del
 *    mismo aviso al cabo de un mes y nadie volvería a mirarla. Se apoya en el
 *    índice único `(dedupe_key, user_id, channel)`: la base rechaza el
 *    duplicado, no lo comprueba el código antes —que es la carrera clásica de
 *    dos barridos solapados.
 *  - **El destinatario se decide por rol, con `RoleMatrix`.** Quien puede LEER
 *    documentos es quien debe enterarse de que caducan. Se pide alcance de
 *    empresa o más: el rol transportista tiene `invoice:read` con alcance
 *    Carrier, y avisarle de que «hay facturas vencidas» le contaría que existen
 *    las de los demás.
 *  - **El idioma es el DE QUIEN RECIBE.** Un aviso en inglés a alguien dado de
 *    alta en español es exactamente el fallo que este producto no se puede
 *    permitir. Por eso el mismo suceso se escribe una vez por persona y no una
 *    vez por evento.
 *  - **Escribir el aviso nunca puede tumbar lo que lo provocó.** Si el correo
 *    falla, el aviso dentro de la aplicación ya está guardado y el barrido
 *    sigue. Un fallo de entrega se anota en la fila, no se propaga.
 *
 * Lo que esta clase NO hace, a propósito: no lee `notification_templates`. Esa
 * tabla es la personalización por empresa y necesita su propio editor; poner un
 * lector sin que exista un escritor sería la misma media conexión que este
 * proyecto lleva varios lotes desenredando. Los textos salen del diccionario de
 * la aplicación, que sí está completo en los dos idiomas.
 */
final class Notifier
{
    /** Canales que este lote entrega de verdad. `sms` está declarado y suprimido. */
    private const CANALES = ['in_app', 'email'];

    /**
     * Avisa a todas las personas de una empresa que tengan cierto permiso.
     *
     * @param  array<string, string|int>  $params  sustituciones del texto
     * @return int  cuántos avisos NUEVOS se escribieron
     */
    public static function toPermissionHolders(
        string $tenantId,
        string $permission,
        string $eventKey,
        string $dedupeKey,
        array $params = [],
        ?string $actionUrl = null,
        ?string $subjectType = null,
        ?string $subjectId = null,
    ): int {
        $escritos = 0;

        foreach (self::recipients($tenantId, $permission) as $usuario) {
            $escritos += self::toUser(
                $tenantId,
                (string) $usuario->id,
                $eventKey,
                $dedupeKey,
                $params,
                $actionUrl,
                $subjectType,
                $subjectId,
            );
        }

        return $escritos;
    }

    /**
     * Avisa a una persona concreta.
     *
     * @param  array<string, string|int>  $params
     * @return int  1 si se escribió algo nuevo, 0 si ya estaba avisada
     */
    public static function toUser(
        string $tenantId,
        string $userId,
        string $eventKey,
        string $dedupeKey,
        array $params = [],
        ?string $actionUrl = null,
        ?string $subjectType = null,
        ?string $subjectId = null,
    ): int {
        $preferencias = self::preferences($tenantId, $userId, $eventKey);
        $idioma = self::localeOf($userId);
        $escritos = 0;

        foreach (self::CANALES as $canal) {
            if (! $preferencias[$canal]) {
                continue;
            }

            $fila = self::insert(
                $tenantId, $userId, $eventKey, $canal, $idioma,
                $dedupeKey, $params, $actionUrl, $subjectType, $subjectId,
            );

            if ($fila === null) {
                continue; // Ya estaba avisada por este canal.
            }

            $escritos++;

            if ($canal === 'email') {
                self::send($fila, $userId);
            }
        }

        return $escritos;
    }

    // ------------------------------------------------------------------ ayudas

    /**
     * Escribe la fila, o devuelve null si ya existía.
     *
     * El duplicado lo rechaza el ÍNDICE, no una comprobación previa: dos
     * barridos solapados que consultaran antes de insertar verían los dos que
     * no hay nada y escribirían los dos.
     *
     * @param  array<string, string|int>  $params
     * @return array<string, mixed>|null
     */
    private static function insert(
        string $tenantId,
        string $userId,
        string $eventKey,
        string $canal,
        Locale $idioma,
        string $dedupeKey,
        array $params,
        ?string $actionUrl,
        ?string $subjectType,
        ?string $subjectId,
    ): ?array {
        $ahora = CarbonImmutable::now();

        $fila = [
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'event_key' => $eventKey,
            'channel' => $canal,
            'status' => $canal === 'in_app' ? 'delivered' : 'queued',
            'locale' => $idioma->value,
            'title' => self::texto("notifications.events.{$eventKey}.title", $idioma, $params),
            'body' => self::texto("notifications.events.{$eventKey}.body", $idioma, $params),
            'action_url' => $actionUrl,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId,
            'dedupe_key' => $dedupeKey,
            'sent_at' => $canal === 'in_app' ? $ahora : null,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ];

        // `insertOrIgnore` y no `insert` en un try: el choque contra el índice
        // único es el camino NORMAL de un barrido diario, no una excepción.
        $insertadas = DB::table('notifications')->insertOrIgnore($fila);

        return $insertadas === 1 ? $fila : null;
    }

    /**
     * Manda el correo. Un fallo se anota y no se propaga.
     *
     * Sin credenciales de correo, `MAIL_MAILER=log` escribe el mensaje en el
     * registro en vez de mandarlo. Es el adaptador simulado de este servicio: la
     * aplicación arranca y se puede enseñar entera sin una sola clave de
     * tercero.
     *
     * Un detalle que confunde si no se sabe: el transporte `log` escribe a nivel
     * DEBUG, y en producción `LOG_LEVEL=warning`. Con esa combinación el correo
     * «se manda» —la fila queda en `sent`— y no aparece en el registro. No está
     * roto: para verlo hay que bajar `LOG_LEVEL` a `debug`.
     *
     * @param  array<string, mixed>  $fila
     */
    private static function send(array $fila, string $userId): void
    {
        $correo = app(TenantContext::class)->withoutTenant(
            fn () => DB::table('users')->where('id', $userId)->value('email'),
        );

        if ($correo === null) {
            return;
        }

        try {
            Mail::mailer(config('mail.default'))->raw(
                (string) $fila['body'],
                static function ($mensaje) use ($correo, $fila): void {
                    $mensaje->to((string) $correo)->subject((string) $fila['title']);
                },
            );

            DB::table('notifications')->where('id', $fila['id'])->update([
                'status' => 'sent',
                'sent_at' => CarbonImmutable::now(),
                'updated_at' => CarbonImmutable::now(),
            ]);
        } catch (\Throwable $e) {
            // Que no salga el correo no puede tumbar el barrido ni perder el
            // aviso: el de dentro de la aplicación ya está guardado.
            DB::table('notifications')->where('id', $fila['id'])->update([
                'status' => 'failed',
                'failure_reason' => Str::limit($e->getMessage(), 500),
                'updated_at' => CarbonImmutable::now(),
            ]);

            Log::warning('No se pudo enviar un aviso por correo', [
                'notification' => $fila['id'],
                'excepcion' => $e::class,
            ]);
        }
    }

    /**
     * Quién debe enterarse: los miembros activos cuyo ROL concede el permiso con
     * alcance de empresa o más.
     *
     * Se resuelve con `RoleMatrix` y no construyendo un Actor por persona: son
     * avisos, no autorización, y montar el Actor de cada miembro en cada barrido
     * costaría varias consultas por usuario y por noche. La contrapartida, y
     * conviene tenerla escrita: las EXCEPCIONES por usuario no cuentan aquí. A
     * quien se le concedió `document:read` a mano no le llegará el aviso — verá
     * la pantalla, pero no el aviso.
     *
     * @return \Illuminate\Support\Collection<int, object>
     */
    private static function recipients(string $tenantId, string $permission)
    {
        $roles = [];

        foreach (Role::cases() as $rol) {
            $alcance = RoleMatrix::for($rol)[$permission] ?? null;

            if ($alcance instanceof Scope && $alcance->atLeast(Scope::Tenant)) {
                $roles[] = $rol->value;
            }
        }

        if ($roles === []) {
            return collect();
        }

        $ids = DB::table('user_tenant_memberships')
            ->where('tenant_id', $tenantId)
            ->whereIn('role', $roles)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->pluck('user_id')
            ->unique()
            ->all();

        if ($ids === []) {
            return collect();
        }

        return app(TenantContext::class)->withoutTenant(
            fn () => DB::table('users')->whereIn('id', $ids)->get(['id']),
        );
    }

    /**
     * Las preferencias de una persona para un suceso.
     *
     * Sin fila, valen los valores por defecto de la tabla: dentro de la
     * aplicación sí, correo sí, SMS no. Es lo correcto para un producto de
     * cumplimiento — quien no ha tocado nada quiere enterarse de que un
     * documento caduca.
     *
     * @return array{in_app: bool, email: bool}
     */
    private static function preferences(string $tenantId, string $userId, string $eventKey): array
    {
        $fila = DB::table('notification_preferences')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('event_key', $eventKey)
            ->whereNull('deleted_at')
            ->first(['in_app', 'email']);

        return [
            'in_app' => $fila === null ? true : (bool) $fila->in_app,
            'email' => $fila === null ? true : (bool) $fila->email,
        ];
    }

    private static function localeOf(string $userId): Locale
    {
        $valor = app(TenantContext::class)->withoutTenant(
            fn () => DB::table('users')->where('id', $userId)->value('locale'),
        );

        return $valor === null ? Locale::En : Locale::from((string) $valor);
    }

    /**
     * @param  array<string, string|int>  $params
     */
    private static function texto(string $clave, Locale $idioma, array $params): string
    {
        return (string) __($clave, $params, $idioma->value);
    }
}
