<?php

declare(strict_types=1);

namespace App\Actions\Auth;

use App\Enums\UserStatus;
use App\Models\LoginAttempt;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

/**
 * La comprobación de credenciales.
 *
 * Se sustituye la de Fortify porque la tabla `users` portada trae política de
 * bloqueo, estado de cuenta y un correo normalizado, y nada de eso lo conoce el
 * `attempt()` por defecto.
 *
 * El orden de las comprobaciones importa y es este:
 *
 *  1. **Bloqueo por intentos fallidos**, ANTES de verificar la contraseña. Si se
 *     verificase primero, el tiempo que tarda bcrypt diría a un atacante si la
 *     cuenta existe y si su contraseña era correcta, aunque la respuesta fuese
 *     la misma. Comprobar el bloqueo primero corta eso.
 *  2. **La contraseña**, siempre con `Hash::check` incluso si el usuario no
 *     existe, contra un hash de relleno, para que el tiempo de respuesta no
 *     revele la existencia de la cuenta.
 *  3. **El estado de la cuenta**, después de la contraseña. Al contrario: decir
 *     "tu cuenta está suspendida" a quien NO conoce la contraseña sería filtrar
 *     que la cuenta existe.
 *
 * Todo intento, con éxito o sin él, deja fila en `login_attempts`. El motivo del
 * fallo se guarda ahí, nunca se devuelve al cliente.
 */
final class AttemptLogin
{
    /**
     * Hash de relleno para igualar el tiempo cuando el usuario no existe. Es un
     * bcrypt real de una cadena aleatoria: verificar contra él cuesta lo mismo
     * que verificar contra el de un usuario de verdad.
     */
    private const DUMMY_HASH = '$2y$12$QdBfsnRLwI.W3OpLEXgYZubuC/kqMLjGsM8d5N/n6n30Kx0qeSJtS';

    private const MAX_ATTEMPTS = 5;

    private const LOCK_MINUTES = 15;

    public function __invoke(Request $request): ?User
    {
        $email = mb_strtolower(trim((string) $request->input('email')));
        $password = (string) $request->input('password');

        $user = User::where('email_normalized', $email)->first();

        if ($user !== null && $user->isLocked()) {
            $this->record($request, $email, false, 'account_locked');

            return null;
        }

        // Se verifica SIEMPRE, exista el usuario o no, y exista contraseña o no
        // (un usuario invitado o de SSO la tiene en NULL). Salir antes aquí
        // devolvería en microsegundos en vez de en los ~200 ms que cuesta un
        // bcrypt, y esa diferencia dice si la cuenta existe.
        $hash = $user !== null && $user->password !== null
            ? $user->password
            : self::DUMMY_HASH;

        // Sin cortocircuito: Hash::check corre siempre, incluso con la
        // contraseña vacía. Un `$password !== '' &&` delante ahorraría 200 ms
        // justo en el caso que un atacante puede provocar a voluntad, que es
        // exactamente la señal que este relleno existe para borrar.
        $matches = Hash::check($password, $hash);

        if ($user === null || ! $matches) {
            if ($user !== null) {
                $this->registerFailure($user);
            }
            $this->record($request, $email, false, $user === null ? 'unknown_email' : 'bad_password');

            return null;
        }

        if ($user->status !== UserStatus::Active) {
            $this->record($request, $email, false, 'status_'.$user->status->value);

            return null;
        }

        $user->forceFill([
            'failed_login_attempts' => 0,
            'locked_until' => null,
            'last_login_at' => now(),
            'last_login_ip' => $request->ip(),
        ])->save();

        $this->record($request, $email, true, null);

        return $user;
    }

    private function registerFailure(User $user): void
    {
        $attempts = $user->failed_login_attempts + 1;

        $user->forceFill([
            'failed_login_attempts' => $attempts,
            'locked_until' => $attempts >= self::MAX_ATTEMPTS
                ? now()->addMinutes(self::LOCK_MINUTES)
                : $user->locked_until,
        ])->save();
    }

    private function record(Request $request, string $email, bool $successful, ?string $reason): void
    {
        // `login_attempts` no tiene tenant_id: en el momento del login todavía no
        // se sabe en qué empresa va a actuar el usuario, y la tabla sirve
        // precisamente para investigar intentos contra correos que quizá no
        // existan en ninguna.
        LoginAttempt::create([
            'email_normalized' => $email,
            'ip_address' => $request->ip(),
            'successful' => $successful,
            'failure_reason' => $reason,
            'user_agent' => mb_substr((string) $request->userAgent(), 0, 1000),
        ]);
    }
}
