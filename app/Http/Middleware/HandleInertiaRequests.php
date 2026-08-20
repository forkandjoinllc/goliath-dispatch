<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Enums\Locale;
use App\Support\Dictionary;
use App\Support\Locales;
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
                (array) $request->attributes->get('dictionaryNamespaces', []),
            ),

            'auth' => [
                'user' => $request->user() === null ? null : [
                    'id' => $request->user()->id,
                    'firstName' => $request->user()->first_name,
                    'lastName' => $request->user()->last_name,
                    'email' => $request->user()->email,
                ],
            ],

            // Un único mensaje efímero. No se pasa la bolsa de sesión completa:
            // acabaría filtrando lo que otra petición dejó ahí.
            'flash' => [
                'success' => fn () => $request->session()->get('success'),
                'error' => fn () => $request->session()->get('error'),
            ],
        ];
    }
}
