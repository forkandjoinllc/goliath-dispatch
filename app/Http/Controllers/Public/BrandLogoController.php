<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Support\Branding\Brand;
use App\Support\Storage\DocumentStore;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

/**
 * El logo de una empresa, servido a quien sea.
 *
 * Sin sesión y sin firma, a propósito: un logo es lo que esa empresa ya tiene
 * puesto en su web y en la puerta de sus camiones. Lo que hace falta es que la
 * página pública de rastreo pueda pintarlo, y esa página la abre un cliente
 * desde un correo, sin cuenta.
 *
 * Una dirección firmada no serviría: caduca en minutos, y el correo que la lleva
 * puede abrirse días después. Una ruta con sesión, menos todavía.
 *
 * Lo único que se cuida es que esta dirección no diga nada más que el logo.
 * Contesta lo mismo —404— cuando la empresa no existe y cuando existe y no ha
 * subido ninguno: distinguirlo la convertiría en una forma de enumerar
 * empresas, y esa diferencia no le importa a nadie que tenga que ver un logo.
 */
final class BrandLogoController
{
    public function __invoke(string $tenant, DocumentStore $store): Response
    {
        $clave = Brand::logoKey($tenant);

        abort_if($clave === null, 404);
        abort_unless(str_starts_with($clave, 'documents/'), 404);
        abort_if(str_contains($clave, '..'), 404);
        abort_unless($store->exists($clave), 404);

        // Se cachea una hora. Un logo cambia como mucho una vez al año, y la
        // página pública la abre gente que recarga: sin esto, cada recarga es
        // otra lectura de disco por una imagen que no ha cambiado.
        return Storage::disk('local')
            ->response($clave, null, ['Cache-Control' => 'public, max-age=3600']);
    }
}
