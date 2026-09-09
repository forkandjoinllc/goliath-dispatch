<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Support\Branding\Brand;
use App\Support\Branding\LogoImage;
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

        // Los BYTES, no lo que diga el nombre ni lo que adivine el servidor.
        //
        // Esta ruta servía con `Storage::response()`, que deduce el tipo del
        // fichero y manda `Content-Disposition: inline`. Con un SVG guardado
        // —lo que la validación admitía— eso es un DOCUMENTO que se ejecuta en
        // el origen de la aplicación, y este origen es uno solo para todas las
        // empresas.
        //
        // Se comprueba al SALIR y no solo al entrar porque en disco puede haber
        // logos de antes de este cambio. Así quedan cubiertos sin migración y
        // sin borrarle a nadie su fichero: simplemente dejan de servirse.
        $bytes = (string) Storage::disk('local')->get($clave);
        $mime = LogoImage::mime($bytes);

        // Mismo 404 que cuando no hay logo. Distinguir «no hay» de «hay uno que
        // no se puede servir» no le sirve a quien mira una página de rastreo, y
        // sí a quien esté probando qué acepta esta ruta.
        abort_if($mime === null, 404);

        return response($bytes, 200, LogoImage::headers($mime));
    }
}
