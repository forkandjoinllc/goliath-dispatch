<?php

declare(strict_types=1);

use App\Authorization\Actor;
use App\Authorization\AssignmentScope;
use App\Authorization\PermissionChecker;
use App\Enums\Locale;
use App\Enums\Role;
use App\Support\Navigation;

/*
| Vive en Unit/I18n y no junto a las demás pruebas de Navigation porque
| `lang_path()` necesita la aplicación arrancada, y Unit/I18n es el único sitio
| de Unit donde lo está (ver tests/Pest.php). Sigue sin tocar la base de datos.
|
| ADVERTENCIA: escrita sin poder ejecutarse (ver CarrierAccessTest).
*/

function navigationLabelKeys(Role $role): array
{
    $actor = new Actor(
        userId: 'user-1',
        email: 'u@example.test',
        firstName: 'U',
        lastName: 'Ser',
        locale: Locale::Es,
        timezone: 'America/Chicago',
        isPlatformSuperAdmin: $role === Role::PlatformSuperAdmin,
        tenantId: $role === Role::PlatformSuperAdmin ? null : 'tenant-1',
        role: $role,
        assignments: new AssignmentScope,
    );

    return collect(Navigation::for($actor, new PermissionChecker))
        ->flatMap(fn (array $g) => [...collect($g['items'])->pluck('labelKey'), $g['labelKey']])
        ->unique()
        ->values()
        ->all();
}

it('toda etiqueta del menú existe en los dos diccionarios', function () {
    // Una clave que falta no rompe nada: `t()` devuelve la clave y el menú le
    // enseña «nav.primary.health» a un cliente. Ese fallo ya ocurrió una vez, y
    // se descubrió mirando la pantalla, no ejecutando nada.
    $keys = collect(Role::cases())
        ->flatMap(fn (Role $role) => navigationLabelKeys($role))
        ->unique();

    expect($keys)->not->toBeEmpty();

    foreach (['en', 'es'] as $locale) {
        $dictionary = json_decode((string) file_get_contents(lang_path("{$locale}/nav.json")), true);

        foreach ($keys as $key) {
            $node = $dictionary;

            // Las claves llegan como «nav.primary.carriers»; dentro del fichero
            // nav.json el prefijo «nav.» no existe.
            foreach (explode('.', substr($key, 4)) as $segment) {
                $node = is_array($node) ? ($node[$segment] ?? null) : null;
            }

            expect($node)->toBeString("falta la clave {$key} en lang/{$locale}/nav.json");
        }
    }
});
