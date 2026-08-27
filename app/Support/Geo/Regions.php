<?php

declare(strict_types=1);

namespace App\Support\Geo;

/**
 * Los países en los que esta plataforma despacha, y sus subdivisiones.
 *
 * Tres países y no doscientos: Estados Unidos, Canadá y México. Es el corredor
 * del TLCAN y es donde opera un despacho de camiones norteamericano. Añadir el
 * resto del mundo aquí sería una lista más larga y ni un despacho más.
 *
 * ESTA CLASE ES LA FUENTE DE VERDAD. Su gemelo en el navegador está en
 * resources/js/lib/regions.ts, y hay una prueba que revienta si los dos dejan
 * de coincidir: la lista se duplica porque el desplegable no puede esperar a
 * una petición, no porque haya dos verdades.
 *
 * Los códigos son ISO 3166-2 sin el prefijo de país. Ojo con esto: los de
 * México tienen TRES letras (NLE, CMX, JAL), no dos. Por eso las columnas de
 * estado del esquema son varchar(3) desde la migración 2026_08_27_100000, y por
 * eso no vale inventarse abreviaturas mexicanas de dos letras — nadie las
 * reconocería en un permiso ni en una matrícula.
 *
 * Los nombres van en su forma local, que es como aparecen en un permiso y como
 * los dice quien conduce. No se traducen: «Texas» es Texas en los dos idiomas,
 * y traducir «Nuevo León» a «New Lion» sería peor que no traducir nada.
 */
final class Regions
{
    /** Lo que trae marcado el formulario mientras nadie diga otra cosa. */
    public const DEFAULT_COUNTRY = 'US';

    /** @var array<string, string> */
    private const COUNTRIES = [
        'US' => 'United States',
        'MX' => 'Mexico',
        'CA' => 'Canada',
    ];

    /** @var array<string, array<string, string>> */
    private const SUBDIVISIONS = [
        'US' => [
            'AL' => 'Alabama',
            'AK' => 'Alaska',
            'AZ' => 'Arizona',
            'AR' => 'Arkansas',
            'CA' => 'California',
            'CO' => 'Colorado',
            'CT' => 'Connecticut',
            'DE' => 'Delaware',
            'DC' => 'District of Columbia',
            'FL' => 'Florida',
            'GA' => 'Georgia',
            'HI' => 'Hawaii',
            'ID' => 'Idaho',
            'IL' => 'Illinois',
            'IN' => 'Indiana',
            'IA' => 'Iowa',
            'KS' => 'Kansas',
            'KY' => 'Kentucky',
            'LA' => 'Louisiana',
            'ME' => 'Maine',
            'MD' => 'Maryland',
            'MA' => 'Massachusetts',
            'MI' => 'Michigan',
            'MN' => 'Minnesota',
            'MS' => 'Mississippi',
            'MO' => 'Missouri',
            'MT' => 'Montana',
            'NE' => 'Nebraska',
            'NV' => 'Nevada',
            'NH' => 'New Hampshire',
            'NJ' => 'New Jersey',
            'NM' => 'New Mexico',
            'NY' => 'New York',
            'NC' => 'North Carolina',
            'ND' => 'North Dakota',
            'OH' => 'Ohio',
            'OK' => 'Oklahoma',
            'OR' => 'Oregon',
            'PA' => 'Pennsylvania',
            'PR' => 'Puerto Rico',
            'RI' => 'Rhode Island',
            'SC' => 'South Carolina',
            'SD' => 'South Dakota',
            'TN' => 'Tennessee',
            'TX' => 'Texas',
            'UT' => 'Utah',
            'VT' => 'Vermont',
            'VA' => 'Virginia',
            'WA' => 'Washington',
            'WV' => 'West Virginia',
            'WI' => 'Wisconsin',
            'WY' => 'Wyoming',
        ],
        'CA' => [
            'AB' => 'Alberta',
            'BC' => 'British Columbia',
            'MB' => 'Manitoba',
            'NB' => 'New Brunswick',
            'NL' => 'Newfoundland and Labrador',
            'NS' => 'Nova Scotia',
            'NT' => 'Northwest Territories',
            'NU' => 'Nunavut',
            'ON' => 'Ontario',
            'PE' => 'Prince Edward Island',
            'QC' => 'Quebec',
            'SK' => 'Saskatchewan',
            'YT' => 'Yukon',
        ],
        'MX' => [
            'AGU' => 'Aguascalientes',
            'BCN' => 'Baja California',
            'BCS' => 'Baja California Sur',
            'CAM' => 'Campeche',
            'CHP' => 'Chiapas',
            'CHH' => 'Chihuahua',
            'CMX' => 'Ciudad de Mexico',
            'COA' => 'Coahuila',
            'COL' => 'Colima',
            'DUR' => 'Durango',
            'GUA' => 'Guanajuato',
            'GRO' => 'Guerrero',
            'HID' => 'Hidalgo',
            'JAL' => 'Jalisco',
            'MEX' => 'Estado de Mexico',
            'MIC' => 'Michoacan',
            'MOR' => 'Morelos',
            'NAY' => 'Nayarit',
            'NLE' => 'Nuevo Leon',
            'OAX' => 'Oaxaca',
            'PUE' => 'Puebla',
            'QUE' => 'Queretaro',
            'ROO' => 'Quintana Roo',
            'SLP' => 'San Luis Potosi',
            'SIN' => 'Sinaloa',
            'SON' => 'Sonora',
            'TAB' => 'Tabasco',
            'TAM' => 'Tamaulipas',
            'TLA' => 'Tlaxcala',
            'VER' => 'Veracruz',
            'YUC' => 'Yucatan',
            'ZAC' => 'Zacatecas',
        ],
    ];

    /**
     * Los países, en el orden en que se pintan.
     *
     * @return list<array{code: string, name: string}>
     */
    public static function countries(): array
    {
        $salida = [];

        foreach (self::COUNTRIES as $code => $name) {
            $salida[] = ['code' => $code, 'name' => $name];
        }

        return $salida;
    }

    /**
     * Las subdivisiones de un país, alfabéticamente por nombre.
     *
     * @return list<array{code: string, name: string}>
     */
    public static function subdivisions(string $country): array
    {
        $salida = [];

        foreach (self::SUBDIVISIONS[strtoupper($country)] ?? [] as $code => $name) {
            $salida[] = ['code' => $code, 'name' => $name];
        }

        return $salida;
    }

    /** @return list<string> */
    public static function countryCodes(): array
    {
        return array_keys(self::COUNTRIES);
    }

    /** @return list<string> */
    public static function subdivisionCodes(string $country): array
    {
        return array_keys(self::SUBDIVISIONS[strtoupper($country)] ?? []);
    }

    /** Todos los códigos de subdivisión de los tres países, sin repetir. */
    /** @return list<string> */
    public static function allSubdivisionCodes(): array
    {
        $todos = [];

        foreach (self::SUBDIVISIONS as $mapa) {
            foreach (array_keys($mapa) as $code) {
                $todos[$code] = true;
            }
        }

        return array_keys($todos);
    }

    public static function isCountry(?string $country): bool
    {
        return $country !== null && isset(self::COUNTRIES[strtoupper($country)]);
    }

    /**
     * ¿Esa subdivisión es de ese país?
     *
     * Vacío es válido: la dirección puede estar incompleta y el esquema deja
     * NULL. Lo que no puede pasar es que un cliente de Ontario acabe con el
     * estado «TX» porque alguien cambió el país después de elegir el estado.
     */
    public static function isSubdivisionOf(?string $country, ?string $subdivision): bool
    {
        if ($subdivision === null || trim($subdivision) === '') {
            return true;
        }

        if (! self::isCountry($country)) {
            return false;
        }

        return isset(self::SUBDIVISIONS[strtoupper((string) $country)][strtoupper($subdivision)]);
    }

    /** El nombre de una subdivisión, o null si el código no es de ese país. */
    public static function subdivisionName(?string $country, ?string $subdivision): ?string
    {
        if ($country === null || $subdivision === null) {
            return null;
        }

        return self::SUBDIVISIONS[strtoupper($country)][strtoupper($subdivision)] ?? null;
    }
}
