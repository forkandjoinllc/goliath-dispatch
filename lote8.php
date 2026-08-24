<?php

/*
| Lote 8: el domicilio de Goliath Dispatch LLC en el sitio público.
|
| Ejecutar con `php lote8.php` desde la RAÍZ del proyecto. Idempotente.
|
| Escribe cuatro ficheros nuevos y parchea siete. Cada parche avisa con
| NO ENCAJA en vez de estropear el fichero si no reconoce el texto.
*/

$dir = static function (string $ruta): void {
    $carpeta = dirname($ruta);
    if (! is_dir($carpeta)) {
        mkdir($carpeta, 0755, true);
    }
};

$nuevos = [];

$nuevos["config/company.php"] = <<<'ARCHIVO'
<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| La empresa que opera la plataforma
|--------------------------------------------------------------------------
|
| Estos son los datos de Goliath Dispatch LLC, no los de una empresa cliente.
| Se usan en el sitio público de la plataforma —goliathdispatch.com— y en los
| documentos legales.
|
| Los datos de cada empresa CLIENTE viven en `tenant_settings`, que ya tiene sus
| columnas de domicilio y contacto. Cuando el sitio se sirve bajo el dominio
| verificado de un cliente, lo que se enseña es el suyo: estampar el domicilio
| de Goliath en la página de un cliente sería decirle a los visitantes de ese
| cliente que la empresa está en Davie. Ver App\Support\Company.
|
| Están en configuración y no en base de datos porque no son un dato de negocio
| que cambie solo: cambian cuando la empresa se muda, y eso pasa por un
| despliegue de todas formas.
|
*/

return [
    'legal_name' => 'Goliath Dispatch LLC',

    'address' => [
        'line1' => '4474 Weston Rd',
        'line2' => 'Unit #2130',
        'city' => 'Davie',
        'state' => 'FL',
        'postal_code' => '33331',
        // Código ISO de dos letras: el NOMBRE del país se traduce en el
        // diccionario, porque el sitio es bilingüe y «United States» no se
        // escribe igual en las dos versiones.
        'country' => 'US',
    ],

    // Sin teléfono ni correo todavía. Se dejan fuera a propósito en vez de
    // poner un marcador: una dirección de correo inventada en una página de
    // contacto es peor que no tener ninguna.
    'phone' => null,
    'email' => null,
];
ARCHIVO;

$nuevos["app/Support/Company.php"] = <<<'ARCHIVO'
<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Los datos de contacto que enseña el sitio público.
 *
 * Qué empresa se enseña depende de bajo qué dominio se está sirviendo:
 *
 *  - Con empresa activa —el sitio va bajo el dominio verificado de un cliente—
 *    se enseñan los datos de ESE cliente, de `tenant_settings`.
 *  - Sin empresa activa —goliathdispatch.com— se enseñan los de la plataforma,
 *    de `config/company.php`.
 *
 * El orden importa y no es simétrico: si un cliente no ha rellenado su
 * domicilio, NO se cae al de Goliath. Se enseña menos. Poner la dirección del
 * operador en la página de su cliente le diría a los visitantes de ese cliente
 * que la empresa está en Davie, Florida, que es falso y además revela dónde
 * está el proveedor de alguien que quizá no quiere contarlo.
 */
final class Company
{
    /**
     * @return array<string, mixed>|null
     */
    public static function forSite(?string $tenantId): ?array
    {
        return $tenantId === null
            ? self::platform()
            : self::tenant($tenantId);
    }

    /**
     * @return array<string, mixed>
     */
    public static function platform(): array
    {
        /** @var array<string, mixed> $address */
        $address = (array) config('company.address', []);

        return [
            'legalName' => (string) config('company.legal_name'),
            'line1' => self::text($address['line1'] ?? null),
            'line2' => self::text($address['line2'] ?? null),
            'city' => self::text($address['city'] ?? null),
            'state' => self::text($address['state'] ?? null),
            'postalCode' => self::text($address['postal_code'] ?? null),
            'country' => self::text($address['country'] ?? null),
            'phone' => self::text(config('company.phone')),
            'email' => self::text(config('company.email')),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function tenant(string $tenantId): ?array
    {
        // Consulta en crudo y no por el modelo: esto corre en el sitio público,
        // donde puede no haber contexto de empresa resuelto todavía, y el scope
        // global lanzaría.
        $settings = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->first([
                'address_line1', 'address_line2', 'address_city', 'address_state',
                'address_postal_code', 'address_country', 'contact_phone', 'contact_email',
            ]);

        $name = DB::table('tenants')
            ->where('id', $tenantId)
            ->value('legal_name');

        if ($settings === null) {
            return null;
        }

        $bloque = [
            'legalName' => self::text($name),
            'line1' => self::text($settings->address_line1),
            'line2' => self::text($settings->address_line2),
            'city' => self::text($settings->address_city),
            'state' => self::text($settings->address_state),
            'postalCode' => self::text($settings->address_postal_code),
            'country' => self::text($settings->address_country),
            'phone' => self::text($settings->contact_phone),
            'email' => self::text($settings->contact_email),
        ];

        // Sin calle no hay domicilio que enseñar. Devolver el bloque a medias
        // pintaría un encabezado «Oficina» encima de una ciudad suelta.
        return $bloque['line1'] === null ? null : $bloque;
    }

    private static function text(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }
}
ARCHIVO;

$nuevos["resources/js/components/Marketing/AddressBlock.tsx"] = <<<'ARCHIVO'
import { usePage } from '@inertiajs/react'
import { useI18n } from '@/lib/i18n'
import type { CompanyContact } from '@/types/marketing'

/**
 * El domicilio de quien opera este sitio.
 *
 * Lo resuelve el servidor (ver App\Support\Company): bajo el dominio de una
 * empresa cliente son los datos de ESA empresa, y bajo goliathdispatch.com los
 * de la plataforma. Aquí no se decide nada — si llega null no se pinta nada, que
 * es lo correcto para un cliente que todavía no ha rellenado su domicilio.
 *
 * El nombre del país sale del diccionario y no de la fila: el sitio es bilingüe
 * y «United States» no se escribe igual en las dos versiones.
 */
export function AddressBlock({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { t } = useI18n()
  const { company } = usePage<{ company: CompanyContact | null }>().props

  if (company === null) {
    return null
  }

  const color = tone === 'dark' ? 'text-steel-100' : 'text-steel-700'

  const region = [company.city, company.state].filter(Boolean).join(', ')
  const line3 = [region, company.postalCode].filter(Boolean).join(' ')
  const country = company.country ? t(`marketing.company.countries.${company.country}`) : null

  return (
    <address className={`not-italic text-sm ${color}`}>
      {company.legalName ? <span className="block font-medium">{company.legalName}</span> : null}
      {company.line1 ? <span className="block">{company.line1}</span> : null}
      {company.line2 ? <span className="block">{company.line2}</span> : null}
      {line3 !== '' ? <span className="block">{line3}</span> : null}
      {country ? <span className="block">{country}</span> : null}

      {company.phone ? (
        <a href={`tel:${company.phone.replace(/[^+\d]/g, '')}`} className="mt-2 block hover:underline">
          {company.phone}
        </a>
      ) : null}
      {company.email ? (
        <a href={`mailto:${company.email}`} className="block hover:underline">
          {company.email}
        </a>
      ) : null}
    </address>
  )
}
ARCHIVO;

$nuevos["tests/Feature/Marketing/CompanyContactTest.php"] = <<<'ARCHIVO'
<?php

declare(strict_types=1);

use App\Enums\Locale;
use App\Support\Company;
use App\Support\Site;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(fn () => app(TenantContext::class)->forget());
afterEach(fn () => app(TenantContext::class)->forget());

/* ── El sitio de la plataforma ──────────────────────────────────────────── */

it('el sitio público lleva el domicilio de la plataforma', function (string $locale) {
    $this->get(Site::path(Locale::from($locale), 'contact'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('company.legalName', 'Goliath Dispatch LLC')
            ->where('company.line1', '4474 Weston Rd')
            ->where('company.line2', 'Unit #2130')
            ->where('company.city', 'Davie')
            ->where('company.state', 'FL')
            ->where('company.postalCode', '33331')
            ->where('company.country', 'US')
        );
})->with(['en', 'es']);

it('el domicilio viaja también a las páginas legales', function () {
    // Privacidad y Términos lo pintan al final: un texto legal que no dice
    // QUIÉN se obliga obliga a poca cosa.
    foreach (['privacy', 'terms'] as $route) {
        $this->get(Site::path(Locale::from('en'), $route))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page->where('company.line1', '4474 Weston Rd'));
    }
});

it('no inventa teléfono ni correo', function () {
    // Un correo de contacto inventado es peor que no tener ninguno: alguien
    // escribe y nadie lo lee.
    $this->get(Site::path(Locale::from('en'), 'contact'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('company.phone', null)
            ->where('company.email', null)
        );
});

/* ── El sitio de una empresa cliente ────────────────────────────────────── */

it('bajo el dominio de un cliente NO se enseña el domicilio de Goliath', function () {
    $scenario = Scenario::create();

    // El cliente no ha rellenado su domicilio. Caer al de la plataforma le
    // diría a SUS visitantes que la empresa está en Davie, Florida.
    expect(Company::forSite((string) $scenario->tenant->id))->toBeNull();
});

it('bajo el dominio de un cliente se enseña el domicilio del cliente', function () {
    $scenario = Scenario::create();

    DB::table('tenant_settings')
        ->where('tenant_id', $scenario->tenant->id)
        ->update([
            'address_line1' => '900 Industrial Pkwy',
            'address_city' => 'Laredo',
            'address_state' => 'TX',
            'address_postal_code' => '78045',
            'address_country' => 'US',
            'contact_phone' => '+19565550142',
        ]);

    $company = Company::forSite((string) $scenario->tenant->id);

    expect($company['line1'])->toBe('900 Industrial Pkwy')
        ->and($company['city'])->toBe('Laredo')
        ->and($company['phone'])->toBe('+19565550142')
        // El nombre sale de la propia empresa, no de la configuración.
        ->and($company['legalName'])->toBe($scenario->tenant->legal_name);
});

it('una ciudad suelta sin calle no cuenta como domicilio', function () {
    $scenario = Scenario::create();

    DB::table('tenant_settings')
        ->where('tenant_id', $scenario->tenant->id)
        ->update(['address_city' => 'Laredo', 'address_state' => 'TX']);

    // Devolver el bloque a medias pintaría un encabezado «Oficina» encima de
    // una ciudad suelta.
    expect(Company::forSite((string) $scenario->tenant->id))->toBeNull();
});

/* ── Los dos idiomas ────────────────────────────────────────────────────── */

it('el nombre del país está en los dos diccionarios', function () {
    // El país se traduce; la calle no. Si esta clave falta, la página enseña
    // «marketing.company.countries.US» en crudo.
    foreach (['en', 'es'] as $locale) {
        $dictionary = json_decode(
            (string) file_get_contents(lang_path("{$locale}/marketing.json")),
            true,
            512,
            JSON_THROW_ON_ERROR
        );

        expect($dictionary['company']['countries']['US'] ?? null)->not->toBeNull();
    }
});
ARCHIVO;


foreach ($nuevos as $ruta => $contenido) {
    $dir($ruta);
    file_put_contents($ruta, rtrim($contenido)."\n");
    echo "  escrito: {$ruta}\n";
}

/* ── Parches ─────────────────────────────────────────────────────────────── */

$parche = static function (string $ruta, string $viejo, string $nuevo, string $marca, string $etiqueta): void {
    $s = file_get_contents($ruta);

    if (str_contains($s, $marca)) {
        echo "  {$etiqueta}: ya estaba\n";

        return;
    }

    if (! str_contains($s, $viejo)) {
        echo "  {$etiqueta}: NO ENCAJA\n";

        return;
    }

    file_put_contents($ruta, str_replace($viejo, $nuevo, $s));
    echo "  {$etiqueta}: ok\n";
};

// 1. Compartir el bloque desde el middleware de Inertia.
$p = 'app/Http/Middleware/HandleInertiaRequests.php';
$s = file_get_contents($p);
if (str_contains($s, 'Company::forSite')) {
    echo "  middleware: ya estaba\n";
} elseif (! str_contains($s, "            // Un único mensaje efímero.")) {
    echo "  middleware: NO ENCAJA\n";
} else {
    $s = str_replace("use App\\Support\\AppShell;", "use App\\Support\\AppShell;\nuse App\\Support\\Company;", $s);
    $s = str_replace("use App\\Support\\Locales;", "use App\\Support\\Locales;\nuse App\\Support\\TenantContext;", $s);
    $s = str_replace(
        "            // Un único mensaje efímero.",
        "            // Los datos de contacto que toca enseñar bajo ESTE dominio: los de\n"
        ."            // la empresa cliente si el sitio va bajo el suyo, los de la\n"
        ."            // plataforma si no. Se comparte aquí y no en cada controlador\n"
        ."            // porque lo pinta el PIE, que envuelve todas las páginas públicas.\n"
        ."            //\n"
        ."            // Cierre: solo se consulta la base de datos si la página lo\n"
        ."            // serializa, y en el sitio de la plataforma ni eso.\n"
        ."            'company' => fn (): ?array => Company::forSite(app(TenantContext::class)->id()),\n\n"
        ."            // Un único mensaje efímero.",
        $s
    );
    file_put_contents($p, $s);
    echo "  middleware: ok\n";
}

// 2. El pie de página.
$parche(
    'resources/js/components/Marketing/Footer.tsx',
    "import { useI18n } from '@/lib/i18n'",
    "import { AddressBlock } from '@/components/Marketing/AddressBlock'\nimport { useI18n } from '@/lib/i18n'",
    'AddressBlock',
    'pie (import)'
);
$parche(
    'resources/js/components/Marketing/Footer.tsx',
    "            <p className=\"mt-4 max-w-xs text-sm text-steel-100\">{t('marketing.footer.tagline')}</p>\n          </div>",
    "            <p className=\"mt-4 max-w-xs text-sm text-steel-100\">{t('marketing.footer.tagline')}</p>\n\n"
    ."            {/* El domicilio va bajo el logo porque es donde lo busca quien lo\n"
    ."                busca: un cliente comprobando con quién está tratando, o una\n"
    ."                gestoría buscando a quién dirigir un papel. */}\n"
    ."            <div className=\"mt-6\">\n"
    ."              <h2 className=\"uppercase-heading text-xs text-steel-300\">\n"
    ."                {t('marketing.company.officeHeading')}\n"
    ."              </h2>\n"
    ."              <div className=\"mt-2\">\n"
    ."                <AddressBlock tone=\"dark\" />\n"
    ."              </div>\n"
    ."            </div>\n          </div>",
    'marketing.company.officeHeading',
    'pie (bloque)'
);

// 3. Los documentos legales.
$parche(
    'resources/js/components/Marketing/LegalDocument.tsx',
    "import { useI18n } from '@/lib/i18n'",
    "import { AddressBlock } from '@/components/Marketing/AddressBlock'\nimport { useI18n } from '@/lib/i18n'",
    'AddressBlock',
    'legales (import)'
);
$parche(
    'resources/js/components/Marketing/LegalDocument.tsx',
    "        ))}\n      </div>\n    </div>\n  )\n}",
    "        ))}\n      </div>\n\n"
    ."      {/* La entidad y su domicilio, al final del documento. Un texto legal que\n"
    ."          no dice QUIÉN se obliga obliga a poca cosa, y es lo primero que busca\n"
    ."          el abogado del cliente antes de firmar nada. */}\n"
    ."      <div className=\"mt-12 border-t border-steel-200 pt-6\">\n"
    ."        <h2 className=\"uppercase-heading text-xs text-steel-600\">\n"
    ."          {t('marketing.company.registeredOfficeHeading')}\n"
    ."        </h2>\n"
    ."        <div className=\"mt-3\">\n"
    ."          <AddressBlock />\n"
    ."        </div>\n"
    ."      </div>\n    </div>\n  )\n}",
    'registeredOfficeHeading',
    'legales (bloque)'
);

// 4. La página de contacto.
$parche(
    'resources/js/pages/Marketing/Contact.tsx',
    "import { LeadForm } from '@/components/Marketing/LeadForm'",
    "import { AddressBlock } from '@/components/Marketing/AddressBlock'\nimport { LeadForm } from '@/components/Marketing/LeadForm'",
    'AddressBlock',
    'contacto (import)'
);
$parche(
    'resources/js/pages/Marketing/Contact.tsx',
    "              <div\n                className=\"mt-3 flex h-40 items-center justify-center rounded border border-dashed border-steel-300 text-center text-xs text-steel-600\"\n                role=\"img\"\n                aria-label={t('marketing.contact.mapPlaceholderAlt')}\n              >\n                {t('marketing.contact.mapPlaceholderLabel')}\n              </div>",
    "              <div className=\"mt-3\">\n                <AddressBlock />\n              </div>",
    '<AddressBlock />',
    'contacto (domicilio)'
);
$parche(
    'resources/js/pages/Marketing/Contact.tsx',
    "              {/* Los horarios y la dirección salen de tenant_settings cuando el\n                  sitio se sirve bajo el dominio de una empresa. En el sitio de\n                  la plataforma no hay ninguno que mostrar, y se dice en vez de\n                  inventar una dirección. */}\n              <p className=\"mt-3 text-sm text-steel-700\">{t('marketing.contact.mapPlaceholderLabel')}</p>",
    "              {/* El horario sale de tenant_settings cuando el sitio se sirve\n                  bajo el dominio de una empresa. La plataforma todavía no\n                  publica ninguno, y se dice en vez de inventarlo. El domicilio\n                  sí está: lo resuelve App\\Support\\Company. */}\n              <p className=\"mt-3 text-sm text-steel-700\">{t('marketing.company.hoursNotPublished')}</p>",
    'hoursNotPublished',
    'contacto (horario)'
);

// 5. El tipo del bloque.
$p = 'resources/js/types/marketing.d.ts';
$s = file_get_contents($p);
if (str_contains($s, 'CompanyContact')) {
    echo "  tipos: ya estaba\n";
} else {
    file_put_contents($p, rtrim($s)."\n\nexport interface CompanyContact {\n"
        ."  legalName: string | null\n"
        ."  line1: string | null\n"
        ."  line2: string | null\n"
        ."  city: string | null\n"
        ."  state: string | null\n"
        ."  postalCode: string | null\n"
        ."  country: string | null\n"
        ."  phone: string | null\n"
        ."  email: string | null\n}\n");
    echo "  tipos: ok\n";
}

// 6. Los dos diccionarios.
$textos = [
    'en' => ['officeHeading' => 'Office', 'registeredOfficeHeading' => 'Registered office',
             'hoursNotPublished' => 'Business hours are not published yet.',
             'countries' => ['US' => 'United States of America']],
    'es' => ['officeHeading' => 'Oficina', 'registeredOfficeHeading' => 'Domicilio social',
             'hoursNotPublished' => 'Todavía no se publica el horario de atención.',
             'countries' => ['US' => 'Estados Unidos de América']],
];

foreach ($textos as $idioma => $bloque) {
    $p = "lang/{$idioma}/marketing.json";
    $d = json_decode((string) file_get_contents($p), true, 512, JSON_THROW_ON_ERROR);

    if (isset($d['company'])) {
        echo "  diccionario {$idioma}: ya estaba\n";

        continue;
    }

    $d['company'] = $bloque;

    // Las dos claves del mapa se quedan sin usar al poner el domicilio real.
    unset($d['contact']['mapPlaceholderAlt'], $d['contact']['mapPlaceholderLabel']);

    file_put_contents($p, json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)."\n");
    echo "  diccionario {$idioma}: ok\n";
}

echo "\nListo. Revisa con `git diff` y `git status` antes de commitear.\n";
