<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Enums\Locale;
use App\Enums\Role;
use App\Enums\SubscriptionStatus;
use App\Enums\TenantStatus;
use App\Enums\UserStatus;
use App\Models\SaasPlan;
use App\Models\Tenant;
use App\Models\TenantBranding;
use App\Models\TenantSetting;
use App\Models\TenantSubscription;
use App\Models\User;
use App\Models\UserTenantMembership;
use App\Support\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Una empresa de demostración con un usuario por cada rol.
 *
 * Para qué existe: hasta que esté la pantalla de invitaciones, no hay forma de
 * crear un Dispatcher o un Accounting. El alta pública crea una empresa con UN
 * administrador, y nada más. Sin esto no se puede ver cómo se comporta cada rol.
 *
 * NO se ejecuta desde DatabaseSeeder. Hay que pedirlo a la cara:
 *
 *     php artisan db:seed --class=Database\\Seeders\\DemoUsersSeeder
 *
 * Está separado porque DatabaseSeeder corre en cada despliegue y esto NO debe
 * correr en cada despliegue: son cuentas con contraseña conocida.
 *
 * Los usuarios nacen `active` y con el correo verificado a propósito. El flujo
 * real de verificación existe y funciona, pero hoy `MAIL_MAILER=log` manda el
 * enlace a un fichero: exigirlo aquí volvería inaccesibles unas cuentas cuyo
 * único fin es poder entrar.
 *
 * Nada de datos personales reales: nombres inventados y un dominio .test, que
 * por RFC 6761 no resuelve nunca.
 */
class DemoUsersSeeder extends Seeder
{
    /** Cambiadla al invocar si hace falta: DEMO_PASSWORD=... php artisan db:seed ... */
    private const PASSWORD = 'GoliathDemo2026!';

    private const TENANT_SLUG = 'demo-dispatch';

    /** @var list<array{role: Role, first: string, last: string, locale: Locale}> */
    private const PEOPLE = [
        ['role' => Role::Admin, 'first' => 'Alicia', 'last' => 'Moreno', 'locale' => Locale::Es],
        ['role' => Role::Accounting, 'first' => 'Beatriz', 'last' => 'Cortés', 'locale' => Locale::Es],
        ['role' => Role::Dispatcher, 'first' => 'Carlos', 'last' => 'Peña', 'locale' => Locale::Es],
        ['role' => Role::Carrier, 'first' => 'Dana', 'last' => 'Whitfield', 'locale' => Locale::En],
        ['role' => Role::Driver, 'first' => 'Eduardo', 'last' => 'Salas', 'locale' => Locale::Es],
    ];

    public function run(): void
    {
        $password = (string) (env('DEMO_PASSWORD') ?: self::PASSWORD);
        $context = app(TenantContext::class);

        DB::transaction(function () use ($password, $context): void {
            $tenant = $context->withoutTenant(
                fn () => Tenant::withTrashed()->where('slug', self::TENANT_SLUG)->first()
            ) ?? Tenant::create([
                'slug' => self::TENANT_SLUG,
                'legal_name' => 'Demo Dispatch LLC',
                'display_name' => 'Demo Dispatch',
                'status' => TenantStatus::Trialing,
                'default_locale' => Locale::Es,
                'default_timezone' => 'America/Chicago',
                'provisioned_at' => now(),
            ]);

            $context->runAs($tenant->id, function () use ($tenant, $password): void {
                // firstOrCreate en todo: el seeder debe poder reejecutarse sin
                // duplicar ni reventar contra los índices únicos.
                TenantSetting::firstOrCreate(['tenant_id' => $tenant->id]);
                TenantBranding::firstOrCreate(['tenant_id' => $tenant->id]);

                $plan = SaasPlan::where('code', 'growth')->first() ?? SaasPlan::first();

                if ($plan !== null) {
                    TenantSubscription::firstOrCreate(
                        ['tenant_id' => $tenant->id],
                        [
                            'plan_id' => $plan->id,
                            'status' => SubscriptionStatus::Trialing,
                            'trial_ends_at' => now()->addDays($plan->trial_days),
                            'current_period_start' => now(),
                            'current_period_end' => now()->addDays($plan->trial_days),
                        ],
                    );
                }

                foreach (self::PEOPLE as $person) {
                    $email = $person['role']->value.'@demo.test';

                    $user = User::withTrashed()->where('email_normalized', $email)->first();

                    if ($user === null) {
                        $user = new User;
                        $user->email = $email;
                    }

                    $user->forceFill([
                        'password' => $password,
                        'first_name' => $person['first'],
                        'last_name' => $person['last'],
                        'locale' => $person['locale'],
                        'timezone' => 'America/Chicago',
                        'status' => UserStatus::Active,
                        'email_verified_at' => now(),
                        'failed_login_attempts' => 0,
                        'locked_until' => null,
                        'deleted_at' => null,
                    ])->save();

                    UserTenantMembership::firstOrCreate(
                        ['tenant_id' => $tenant->id, 'user_id' => $user->id, 'role' => $person['role']],
                        [
                            'status' => 'active',
                            'is_primary_contact' => $person['role'] === Role::Admin,
                            'accepted_at' => now(),
                        ],
                    );
                }
            });

            // El Super Admin de plataforma NO pertenece a ninguna empresa: su
            // ámbito es la plataforma entera y se marca con una bandera en el
            // usuario, no con una pertenencia. Ver docs/mysql-port.md.
            $context->withoutTenant(function () use ($password): void {
                $email = 'platform@demo.test';
                $user = User::withTrashed()->where('email_normalized', $email)->first();

                if ($user === null) {
                    $user = new User;
                    $user->email = $email;
                }

                $user->forceFill([
                    'password' => $password,
                    'first_name' => 'Fernanda',
                    'last_name' => 'Ríos',
                    'locale' => Locale::Es,
                    'timezone' => 'America/New_York',
                    'status' => UserStatus::Active,
                    'email_verified_at' => now(),
                    'is_platform_super_admin' => true,
                    'deleted_at' => null,
                ])->save();
            });
        });

        $this->command->info('Empresa de demostración: Demo Dispatch ('.self::TENANT_SLUG.')');
        $this->command->newLine();
        $this->command->table(
            ['Rol', 'Correo', 'Contraseña'],
            [
                ['Platform Super Admin', 'platform@demo.test', $password],
                ...array_map(
                    fn (array $p): array => [
                        ucfirst(str_replace('_', ' ', $p['role']->value)),
                        $p['role']->value.'@demo.test',
                        $password,
                    ],
                    self::PEOPLE,
                ),
            ],
        );
        $this->command->warn('Cuentas de demostración con contraseña conocida. No dejar en un entorno público de verdad.');
    }
}
