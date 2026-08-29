<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Enums\Locale;
use App\Support\AppShell;
use App\Support\Company;
use App\Support\Dictionary;
use App\Support\Locales;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    protected $rootView = 'app';

    /**
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        /** @var Locale $locale */
        $locale = $request->attributes->get('locale', Locales::default());

        return [
            ...parent::share($request),

            'locale' => $locale->value,
            'localeTag' => Locales::tag($locale),
            'locales' => collect(Locales::all())
                ->map(fn (string $l): array => [
                    'code' => $l,
                    'label' => Locales::LABELS[$l],
                    'tag' => Locales::TAGS[$l],
                ])->all(),

            // Solo los espacios que la página pidió. Ver App\Support\Dictionary
            // para por qué no se manda el diccionario entero.
            'dictionary' => fn (): array => Dictionary::for(
                $locale,
                [
                    ...(array) $request->attributes->get('dictionaryNamespaces', []),
                    // Los espacios del armazón autenticado solo viajan si hay
                    // sesión: el sitio público no tiene campana y no debe pagar
                    // por su diccionario.
                    ...($request->user() === null ? [] : Dictionary::AUTHENTICATED),
                ],
            ),

            'auth' => [
                'user' => $request->user() === null ? null : [
                    'id' => $request->user()->id,
                    'firstName' => $request->user()->first_name,
                    'lastName' => $request->user()->last_name,
                    'email' => $request->user()->email,
                ],
            ],

            // El armazón autenticado: menú filtrado por permisos, empresa
            // activa y empresas a las que se puede cambiar.
            //
            // Es un cierre para que no cueste nada en el sitio público: Inertia
            // solo lo evalúa al serializar, y devuelve null en cuanto ve que no
            // hay usuario. Se comparte aquí, y no en cada controlador, porque el
            // armazón envuelve todas las páginas: si dependiera del controlador,
            // un olvido produciría una página sin menú y sin error.
            'shell' => fn (): ?array => app(AppShell::class)->payload(),

            // Los datos de contacto que toca enseñar bajo ESTE dominio: los de
            // la empresa cliente si el sitio va bajo el suyo, los de la
            // plataforma si no. Se comparte aquí y no en cada controlador
            // porque lo pinta el PIE, que envuelve todas las páginas públicas.
            //
            // Cierre: solo se consulta la base de datos si la página lo
            // serializa, y en el sitio de la plataforma ni eso.
            'company' => fn (): ?array => Company::forSite(app(TenantContext::class)->id()),

            // Un único mensaje efímero. No se pasa la bolsa de sesión completa:
            // acabaría filtrando lo que otra petición dejó ahí.
            'flash' => [
                'success' => fn () => $request->session()->get('success'),
                'error' => fn () => $request->session()->get('error'),
            ],
        ];
    }
}
