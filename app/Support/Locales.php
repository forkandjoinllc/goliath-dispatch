<?php

declare(strict_types=1);

namespace App\Support;

use App\Enums\Locale;

/**
 * Todo lo que se sabe sobre idiomas, en un sitio.
 *
 * Portado de src/i18n/config.ts. El sistema es bilingüe de verdad, no
 * "inglés con traducciones": las dos versiones se despliegan a la vez, se
 * indexan por separado y el conductor que solo habla español no es un caso
 * excepcional sino la mitad del público.
 */
final class Locales
{
    public const COOKIE = 'goliath_locale';

    public const COOKIE_DAYS = 365;

    /** Etiquetas BCP-47 para el atributo `lang` y para el formateo de Intl. */
    public const TAGS = [
        'en' => 'en-US',
        'es' => 'es-US',
    ];

    /** El nombre de cada idioma EN ese idioma, nunca traducido. */
    public const LABELS = [
        'en' => 'English',
        'es' => 'Español',
    ];

    /** @return list<string> */
    public static function all(): array
    {
        return array_map(fn (Locale $l): string => $l->value, Locale::cases());
    }

    public static function default(): Locale
    {
        return Locale::En;
    }

    public static function isSupported(?string $value): bool
    {
        return $value !== null && in_array($value, self::all(), true);
    }

    /** Acepta 'es', 'es-MX', 'ES'… y devuelve siempre un idioma soportado. */
    public static function normalize(?string $value): Locale
    {
        if ($value === null || $value === '') {
            return self::default();
        }

        $exact = mb_strtolower($value);
        if (self::isSupported($exact)) {
            return Locale::from($exact);
        }

        $base = mb_strtolower(explode('-', $exact)[0]);

        return self::isSupported($base) ? Locale::from($base) : self::default();
    }

    /**
     * Negocia el idioma a partir de la cabecera Accept-Language.
     *
     * Se ordena por el factor `q` porque un navegador puede pedir
     * `en;q=0.5, es;q=0.9`: el orden de aparición no es la preferencia. Ignorarlo
     * serviría inglés a alguien que pidió español.
     */
    public static function negotiate(?string $acceptLanguage): Locale
    {
        if ($acceptLanguage === null || trim($acceptLanguage) === '') {
            return self::default();
        }

        $ranked = [];
        foreach (explode(',', $acceptLanguage) as $part) {
            $segments = explode(';q=', trim($part));
            $tag = trim($segments[0]);
            if ($tag === '' || $tag === '*') {
                continue;
            }
            $ranked[] = ['tag' => $tag, 'q' => isset($segments[1]) ? (float) $segments[1] : 1.0];
        }

        usort($ranked, fn (array $a, array $b): int => $b['q'] <=> $a['q']);

        foreach ($ranked as $entry) {
            $candidate = mb_strtolower($entry['tag']);
            if (self::isSupported($candidate)) {
                return Locale::from($candidate);
            }
            $base = mb_strtolower(explode('-', $candidate)[0]);
            if (self::isSupported($base)) {
                return Locale::from($base);
            }
        }

        return self::default();
    }

    public static function tag(Locale $locale): string
    {
        return self::TAGS[$locale->value];
    }

    /** El otro idioma, para el conmutador. Con dos, es siempre uno. */
    public static function alternate(Locale $locale): Locale
    {
        return $locale === Locale::En ? Locale::Es : Locale::En;
    }
}
