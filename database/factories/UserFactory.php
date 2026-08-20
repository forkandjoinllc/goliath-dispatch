<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Enums\Locale;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 *
 * Venía del esqueleto de Laravel y escribía una columna `name` que esta base de
 * datos no tiene: el esquema guarda `first_name` y `last_name` por separado,
 * porque los documentos y los correos los necesitan sueltos. Nadie la usaba
 * todavía, así que el fallo estaba esperando a la primera prueba que la
 * llamara.
 */
class UserFactory extends Factory
{
    protected $model = User::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            // Dominio .test: por RFC 6761 no resuelve nunca, así que ninguna
            // prueba puede mandarle correo a nadie de verdad por accidente.
            'email' => 'u-'.Str::lower(Str::random(10)).'@ejemplo.test',
            'email_verified_at' => now(),
            // Sin hashear a mano: el mutador del modelo lo hace. Hacerlo aquí
            // además lo hashearía dos veces y ninguna contraseña casaría.
            'password' => 'contraseña-de-prueba-1',
            // Nombres deterministas y no fake(): fake() viene de fakerphp, que
            // es dependencia de DESARROLLO. Con ella ausente la factory revienta
            // con «undefined function», y no aporta nada aquí — a una prueba de
            // autorización le da igual cómo se llame el usuario. Los nombres
            // realistas están donde sí importan: el sembrador de demostración.
            'first_name' => 'Usuario',
            'last_name' => Str::upper(Str::random(6)),
            'status' => UserStatus::Active,
            'locale' => Locale::Es,
            'timezone' => 'America/Chicago',
        ];
    }

    /** Sin verificar el correo, para las pruebas del flujo de verificación. */
    public function unverified(): static
    {
        return $this->state(fn (): array => ['email_verified_at' => null]);
    }

    /** El Super Admin de plataforma no pertenece a ninguna empresa: es una bandera. */
    public function platformSuperAdmin(): static
    {
        return $this->state(fn (): array => ['is_platform_super_admin' => true]);
    }
}
