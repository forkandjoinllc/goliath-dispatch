<?php

declare(strict_types=1);

namespace App\Http\Controllers\Marketing;

use App\Enums\Locale;
use App\Support\Forms\FormToken;
use App\Support\InertiaPage;
use App\Support\Locales;
use App\Support\Marketing\Site;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Sirve las once páginas públicas.
 *
 * Un solo controlador para todas porque todas hacen lo mismo: resolver el idioma,
 * cargar el espacio `marketing` del diccionario y renderizar el componente que
 * corresponde. La diferencia entre ellas está en el contenido, y el contenido
 * está en lang/{en,es}/marketing.json — no en PHP.
 */
final class PageController
{
    use InertiaPage;

    /** Espacios del diccionario que necesita cualquier página pública. */
    private const NAMESPACES = ['marketing', 'validation'];

    public function __invoke(Request $request, string $route = 'home'): Response
    {
        abort_unless(in_array($route, Site::ROUTES, true), 404);

        /** @var Locale $locale */
        $locale = $request->attributes->get('locale', Locales::default());

        $this->usesDictionary($request, self::NAMESPACES);

        $key = Site::dictionaryKey($route);

        return Inertia::render('Marketing/'.ucfirst($key), [
            'route' => $route,
            'seo' => $this->seo($route, $locale),
            'nav' => [
                'primary' => Site::links($locale, Site::PRIMARY_NAV),
                'footerProduct' => Site::links($locale, Site::FOOTER_PRODUCT),
                'footerCompany' => Site::links($locale, Site::FOOTER_COMPANY),
                'footerLegal' => Site::links($locale, Site::FOOTER_LEGAL),
                'home' => Site::path($locale),
            ],
            // El conmutador necesita saber a qué URL ir sin volver a preguntar al
            // servidor, y esa URL es la MISMA página en el otro idioma. Calcularlo
            // en el cliente a partir de window.location partiría en cuanto una
            // ruta llevase parámetros.
            'alternate' => [
                'locale' => Locales::alternate($locale)->value,
                'label' => Locales::LABELS[Locales::alternate($locale)->value],
                'href' => Site::path(Locales::alternate($locale), $route),
            ],
            'year' => (int) now()->format('Y'),

            // El sello del formulario se emite AQUÍ, al renderizar, y no en el
            // cliente. Ver App\Support\Forms\FormToken para por qué un
            // `Date.now()` del navegador no comprueba nada.
            'formToken' => $this->formTokenFor($route),
        ]);
    }

    /** El nombre del formulario que vive en cada página, si lleva alguno. */
    private const FORMS = [
        'contact' => 'lead',
        'for-clients' => 'quote',
        'carrier-signup' => 'carrier_signup',
    ];

    private function formTokenFor(string $route): ?string
    {
        $form = self::FORMS[$route] ?? null;

        return $form === null ? null : FormToken::issue($form);
    }

    /**
     * @return array{title: string, description: string, canonical: string, alternates: array<string, string>, ogImage: string}
     */
    private function seo(string $route, Locale $locale): array
    {
        $key = Site::dictionaryKey($route);

        return [
            'title' => (string) __("marketing.seo.{$key}.title"),
            'description' => (string) __("marketing.seo.{$key}.description"),
            'canonical' => Site::url(Site::path($locale, $route)),
            'alternates' => Site::languageAlternates($route),
            'ogImage' => Site::url('/brand/og-image.png'),
        ];
    }
}
