<?php

declare(strict_types=1);

namespace App\Support\Invitations;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use stdClass;

/**
 * Los vales de invitación, sobre la tabla `verification_tokens`.
 *
 * No hay tabla nueva: el esquema ya preveía esto — `verification_tokens` tiene
 * `purpose`, y uno de los tres valores documentados en su comentario es
 * `invitation`. Crear una `tenant_invitations` al lado habría duplicado la
 * caducidad, el consumo y el hash, que son exactamente las tres cosas difíciles.
 *
 * SE GUARDA EL HASH, NUNCA EL VALE. Quien lea la base de datos —una copia de
 * seguridad, un volcado de soporte— no puede aceptar invitaciones ajenas con lo
 * que ve. La columna es `char(64) ascii_bin`, que es un sha256 en hexadecimal, y
 * la comparación va por igualdad exacta del hash: no hace falta recorrer filas.
 */
final class Invitations
{
    /** Una semana. Larga para que quepan unas vacaciones, corta para que caduque. */
    private const DIAS_DE_VIDA = 7;

    public const PURPOSE = 'invitation';

    /**
     * Emite un vale y devuelve el texto plano, que es lo ÚNICO que sale de aquí
     * y solo viaja al correo de la persona invitada.
     *
     * @param  array<string, mixed>  $payload
     */
    public static function issue(string $tenantId, string $userId, string $email, array $payload = []): string
    {
        $plano = Str::random(48);
        $ahora = CarbonImmutable::now();

        // Los vales anteriores de esta misma persona en esta misma empresa se
        // dan por consumidos. Reenviar una invitación tiene que INVALIDAR la
        // anterior: si no, un enlace que se mandó a la dirección equivocada
        // seguiría funcionando durante una semana.
        self::revokeFor($tenantId, $userId);

        DB::table('verification_tokens')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'purpose' => self::PURPOSE,
            'token_hash' => hash('sha256', $plano),
            'email' => $email,
            'payload' => json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
            'expires_at' => $ahora->addDays(self::DIAS_DE_VIDA),
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return $plano;
    }

    /**
     * Encuentra el vale vivo que corresponde a este texto, o null.
     *
     * Vivo quiere decir las tres cosas: del propósito correcto, sin consumir y
     * sin caducar. Un vale caducado y uno inventado devuelven lo mismo a
     * propósito — decir «caducó» a quien prueba cadenas al azar le confirma que
     * acertó una.
     */
    public static function find(string $plano): ?stdClass
    {
        if (trim($plano) === '') {
            return null;
        }

        /** @var stdClass|null $fila */
        $fila = DB::table('verification_tokens')
            ->where('token_hash', hash('sha256', $plano))
            ->where('purpose', self::PURPOSE)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', CarbonImmutable::now())
            ->first();

        return $fila;
    }

    public static function consume(string $id): void
    {
        $ahora = CarbonImmutable::now();

        DB::table('verification_tokens')
            ->where('id', $id)
            ->whereNull('consumed_at')
            ->update(['consumed_at' => $ahora, 'updated_at' => $ahora]);
    }

    /**
     * Invalida los vales vivos de una persona en una empresa.
     *
     * Se marcan consumidos en vez de borrarlos: la fila es el rastro de que se
     * invitó a alguien y cuándo, y eso se mira cuando alguien pregunta cómo
     * entró una cuenta.
     */
    public static function revokeFor(string $tenantId, string $userId): void
    {
        $ahora = CarbonImmutable::now();

        DB::table('verification_tokens')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('purpose', self::PURPOSE)
            ->whereNull('consumed_at')
            ->update(['consumed_at' => $ahora, 'updated_at' => $ahora]);
    }
}
