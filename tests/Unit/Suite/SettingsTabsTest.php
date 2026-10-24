<?php

declare(strict_types=1);

use App\Http\Controllers\App\TenantSettingController;
use Tests\Support\Source;

/**
 * El menú horizontal de Ajustes, y el guardado por pestaña.
 *
 * ## Lo que este lote vino a sujetar
 *
 * **Un botón que dice guardar una sección y guarda seis.** Con un formulario
 * único repartido en pestañas, pulsar «Guardar» en Dinero mandaría también lo
 * que alguien hubiera escrito sin guardar en Contacto, sin tenerlo delante.
 *
 * **Un error de validación invisible.** Si el error cae en un campo que está en
 * otra pestaña, la pantalla dice que algo falló y no dice dónde. Quien guarda se
 * queda mirando una sección correcta.
 *
 * **Perder el sitio al guardar.** Con la pestaña en el estado del componente,
 * `back()` lo vuelve a montar y salta a la primera: quien guarda «Contacto»
 * aterriza en «Dinero» y lo que ve es una pantalla que no hizo nada.
 *
 * **Una pestaña con botón y sin destino.** La promesa más barata de hacer y la
 * más cara de descubrir.
 */
function fuenteAjustes(string $ruta): string
{
    return Source::codigo(Source::root().'/'.$ruta);
}

/* ── Cada pestaña se puede guardar ──────────────────────────────────────── */

it('cada pestaña tiene forma de guardarse', function (): void {
    /*
    | O tiene reglas en `secciones()` —y entonces la guarda `update()`— o tiene
    | su propio endpoint declarado. No hay tercera opción: una pestaña que no
    | esté en ninguna de las dos listas pinta un botón que no va a ningún sitio.
    */
    $reflexion = new ReflectionMethod(TenantSettingController::class, 'secciones');
    $reflexion->setAccessible(true);

    /** @var array<string, mixed> $secciones */
    $secciones = $reflexion->invoke(null);

    foreach (TenantSettingController::PESTANAS as $pestana) {
        $tieneReglas = array_key_exists($pestana, $secciones);
        $tieneRuta = array_key_exists($pestana, TenantSettingController::PESTANAS_PROPIAS);

        test()->assertTrue(
            $tieneReglas || $tieneRuta,
            "La pestaña «{$pestana}» no tiene ni reglas ni endpoint: su botón de guardar no guarda nada.",
        );
    }
});

it('las rutas propias de las dos pestañas aparte están declaradas', function (): void {
    /*
    | Declarar una ruta por nombre y que no exista es la misma promesa vacía,
    | solo que descubierta en producción. Se mira el fichero de rutas y no el
    | enrutador porque una guarda de esta carpeta no levanta la aplicación — y
    | que una guarda necesite levantarla es la señal de que ya no es una guarda.
    */
    $rutas = fuenteAjustes('routes/auth.php');

    foreach (TenantSettingController::PESTANAS_PROPIAS as $pestana => $ruta) {
        test()->assertStringContainsString(
            "->name('{$ruta}')",
            $rutas,
            "La pestaña «{$pestana}» apunta a la ruta «{$ruta}», que no está declarada.",
        );
    }
});

it('no hay reglas de una sección que no sea pestaña', function (): void {
    // Al revés también: una sección que se puede guardar y no se puede abrir es
    // un camino que solo conoce quien escriba la petición a mano.
    $reflexion = new ReflectionMethod(TenantSettingController::class, 'secciones');
    $reflexion->setAccessible(true);

    /** @var array<string, mixed> $secciones */
    $secciones = $reflexion->invoke(null);

    foreach (array_keys($secciones) as $seccion) {
        test()->assertContains((string) $seccion, TenantSettingController::PESTANAS);
    }
});

/* ── Un guardado no puede escribir lo de otra sección ───────────────────── */

it('la sección es obligatoria y acotada', function (): void {
    /*
    | Sin sección no se sabe qué columnas se quieren escribir, y adivinarlo
    | —por ejemplo guardando todo— convertiría un error del cliente en una
    | escritura silenciosa de campos que nadie tenía delante.
    */
    $fuente = fuenteAjustes('app/Http/Controllers/App/TenantSettingController.php');

    test()->assertStringContainsString(
        "'section' => ['required', Rule::in(array_keys(\$secciones))],",
        $fuente,
    );
});

it('cada sección se valida con SUS reglas y no con todas', function (): void {
    $fuente = fuenteAjustes('app/Http/Controllers/App/TenantSettingController.php');

    test()->assertStringContainsString('$data = $request->validate($secciones[$seccion]);', $fuente);
});

it('ninguna columna está en dos secciones', function (): void {
    /*
    | Si lo estuviera, guardar una pestaña escribiría un campo que la otra
    | también gobierna, y el último que guardara ganaría sin que ninguna de las
    | dos pantallas lo dijera.
    */
    $reflexion = new ReflectionMethod(TenantSettingController::class, 'secciones');
    $reflexion->setAccessible(true);

    /** @var array<string, array<string, mixed>> $secciones */
    $secciones = $reflexion->invoke(null);

    $vistas = [];

    foreach ($secciones as $nombre => $campos) {
        foreach (array_keys($campos) as $campo) {
            test()->assertArrayNotHasKey(
                $campo,
                $vistas,
                "«{$campo}» está en «{$nombre}» y también en «".($vistas[$campo] ?? '?').'».',
            );
            $vistas[$campo] = $nombre;
        }
    }
});

it('la comprobación del estado solo corre en su sección', function (): void {
    // En las demás no hay país ni estado que comprobar, y leerlos daría siempre
    // el valor por omisión contra un estado que no se mandó.
    $fuente = fuenteAjustes('app/Http/Controllers/App/TenantSettingController.php');

    test()->assertStringContainsString("if (\$seccion === 'contact') {", $fuente);
});

it('cada formulario de la pantalla manda SOLO sus campos', function (): void {
    /*
    | Un `useForm` por sección, con las claves de esa sección. Con un formulario
    | único, pulsar «Guardar» en una pestaña mandaría lo escrito en las otras.
    */
    $pantalla = fuenteAjustes('resources/js/pages/App/Settings/Index.tsx');

    foreach (['money', 'numbering', 'ops', 'contact'] as $seccion) {
        test()->assertStringContainsString(
            "section: '{$seccion}',",
            $pantalla,
            "La sección «{$seccion}» no declara su propio formulario.",
        );
    }

    test()->assertSame(
        4,
        substr_count($pantalla, "form.patch('/settings'"),
        'Hay cuatro secciones que guardan por `update()`: ni una más ni una menos.',
    );
});

/* ── La pestaña no se pierde ────────────────────────────────────────────── */

it('la pestaña vive en la URL, no en el estado del componente', function (): void {
    $tabs = fuenteAjustes('resources/js/components/Ui/Tabs.tsx');

    test()->assertStringContainsString('url.searchParams.set(param, id)', $tabs);
    // Y NO hay un useState guardando la pestaña: ese es el defecto.
    test()->assertStringNotContainsString('useState', $tabs);
});

it('cambiar de pestaña no tira lo escrito ni salta al principio', function (): void {
    // Cambiar de pestaña no es navegar a otra pantalla.
    $tabs = fuenteAjustes('resources/js/components/Ui/Tabs.tsx');

    test()->assertStringContainsString('preserveState: true', $tabs);
    test()->assertStringContainsString('preserveScroll: true', $tabs);
});

it('la pestaña pedida se valida en el SERVIDOR', function (): void {
    /*
    | Comprobarla en el cliente dejaría que `?tab=loquesea` pintara una pantalla
    | sin ninguna sección abierta: ni la pedida, que no existe, ni la primera,
    | que nadie eligió.
    */
    $fuente = fuenteAjustes('app/Http/Controllers/App/TenantSettingController.php');

    test()->assertStringContainsString(
        "in_array((string) \$request->query('tab'), self::PESTANAS, true)",
        $fuente,
    );
    test()->assertStringContainsString(': self::PESTANAS[0],', $fuente);
});

/* ── Un error no se esconde en una pestaña cerrada ──────────────────────── */

it('la pestaña con errores se marca', function (): void {
    $pantalla = fuenteAjustes('resources/js/pages/App/Settings/Index.tsx');

    test()->assertStringContainsString('invalid:', $pantalla);
    test()->assertStringContainsString('conErrores.includes(campo)', $pantalla);

    $tabs = fuenteAjustes('resources/js/components/Ui/Tabs.tsx');
    test()->assertStringContainsString('t.invalid ?', $tabs);
});

it('los errores se leen de la página y no del formulario de turno', function (): void {
    /*
    | La respuesta con errores llega a la PÁGINA, y para entonces el formulario
    | que la provocó puede no estar montado —quien guardó y cambió de pestaña—.
    | Leerlos del `useForm` dejaría ese error sin verse en ningún sitio.
    */
    $pantalla = fuenteAjustes('resources/js/pages/App/Settings/Index.tsx');

    test()->assertStringContainsString('const { errors } = usePage<', $pantalla);
});

it('cada campo de cada sección está en el mapa de errores de su pestaña', function (): void {
    /*
    | Si un campo no estuviera, un error suyo no marcaría ninguna pestaña y
    | volvería a ser invisible — que es justo lo que esta pantalla vino a
    | arreglar. El mapa se compara contra las reglas del SERVIDOR, que son la
    | fuente de verdad de qué campo pertenece a qué sección.
    */
    $reflexion = new ReflectionMethod(TenantSettingController::class, 'secciones');
    $reflexion->setAccessible(true);

    /** @var array<string, array<string, mixed>> $secciones */
    $secciones = $reflexion->invoke(null);

    $pantalla = fuenteAjustes('resources/js/pages/App/Settings/Index.tsx');

    $mapa = substr(
        $pantalla,
        (int) strpos($pantalla, 'const DE_LA_PESTANA'),
        (int) (strpos($pantalla, 'return (') - strpos($pantalla, 'const DE_LA_PESTANA')),
    );

    foreach ($secciones as $nombre => $campos) {
        foreach (array_keys($campos) as $campo) {
            test()->assertStringContainsString(
                "'{$campo}'",
                $mapa,
                "«{$campo}» (sección {$nombre}) no está en el mapa de errores de la pantalla.",
            );
        }
    }
});

/* ── La piel ────────────────────────────────────────────────────────────── */

it('la piel no se trae la paleta de Stripe', function (): void {
    /*
    | Se copia la FORMA —superficies claras, bordes de un píxel, radios
    | pequeños, densidad— y no el color. La paleta es la misma que llevan el
    | sitio público, los correos al cliente y la página de rastreo: un panel
    | morado y un correo naranja son dos empresas distintas para quien los
    | recibe. `BrandColorsTest` lo sujeta para todo el proyecto; esto lo deja
    | dicho donde se lee.
    */
    foreach (['Surface', 'Field', 'Button', 'Tabs'] as $fichero) {
        $fuente = fuenteAjustes("resources/js/components/Ui/{$fichero}.tsx");

        foreach (['indigo', 'violet', 'purple', 'slate-', 'gray-', 'zinc-'] as $ajena) {
            test()->assertStringNotContainsString(
                $ajena,
                $fuente,
                "{$fichero}.tsx usa «{$ajena}», que no es de la marca.",
            );
        }
    }
});

it('un valor de solo lectura no se pinta como campo desactivado', function (): void {
    // Un campo gris invita a pulsarlo y a preguntarse por qué no responde.
    $campos = fuenteAjustes('resources/js/components/Ui/Field.tsx');

    test()->assertStringContainsString('export function ReadOnly(', $campos);

    $pantalla = fuenteAjustes('resources/js/pages/App/Settings/Index.tsx');
    test()->assertStringContainsString('<ReadOnly', $pantalla);
});

it('el error desplaza a la pista en vez de sumarse', function (): void {
    // Las dos juntas obligan a leer dos líneas pequeñas para averiguar cuál
    // dice qué hacer ahora, y la que importa es siempre la del error.
    $campos = fuenteAjustes('resources/js/components/Ui/Field.tsx');

    test()->assertStringContainsString(') : hint ? (', $campos);
});

it('el campo con error lo dice también para un lector de pantalla', function (): void {
    /*
    | CADA entrada, no «el fichero en algún sitio».
    |
    | Aquí hay cuatro componentes que pueden romper esta regla por separado. Una
    | guarda que buscara `aria-invalid` en todo el fichero se queda verde
    | aunque se le quite a uno: la cadena sigue apareciendo por los otros. Es la
    | séptima vez que aparece esta forma de fallo; por eso existe
    | `Source::cuerpo()`, que es la herramienta que la cumple en vez de la
    | lección que la recuerda.
    |
    | Un mensaje rojo debajo del campo es el error para quien lo ve. Para quien
    | usa un lector de pantalla no existe si el campo no lo apunta.
    */
    $campos = fuenteAjustes('resources/js/components/Ui/Field.tsx');

    foreach (['export function TextInput(', 'export function SelectInput('] as $firma) {
        $cuerpo = Source::cuerpo($campos, $firma);

        test()->assertStringContainsString(
            'aria-invalid={error ? true : undefined}',
            $cuerpo,
            "{$firma} no marca el campo como inválido.",
        );
    }

    // Y el mensaje tiene que anunciarse, en los dos sitios que lo pintan.
    foreach (['export function Field(', 'export function Checkbox('] as $firma) {
        test()->assertStringContainsString(
            'role="alert"',
            Source::cuerpo($campos, $firma),
            "{$firma} pinta el error sin anunciarlo.",
        );
    }
});

it('el menú de pestañas es un tablist de verdad', function (): void {
    /*
    | Un menú de pestañas hecho con `div`s es un control que lo parece y no lo
    | es para quien navega con teclado o con lector de pantalla.
    */
    $tabs = fuenteAjustes('resources/js/components/Ui/Tabs.tsx');

    test()->assertStringContainsString('role="tablist"', $tabs);
    test()->assertStringContainsString('role="tab"', $tabs);
    test()->assertStringContainsString('role="tabpanel"', $tabs);
    test()->assertStringContainsString('aria-selected={seleccionada}', $tabs);
    test()->assertStringContainsString('ArrowRight', $tabs);
});

it('el menú se alcanza entero en una pantalla estrecha', function (): void {
    // Un menú cuyas entradas no se pueden alcanzar promete una navegación que
    // no da.
    $tabs = fuenteAjustes('resources/js/components/Ui/Tabs.tsx');

    test()->assertStringContainsString('overflow-x-auto', $tabs);
});

it('quien no puede guardar lo ve dicho, y no un botón que no responde', function (): void {
    $pantalla = fuenteAjustes('resources/js/pages/App/Settings/Index.tsx');

    test()->assertStringContainsString('settings.index.readOnly', $pantalla);
});

it('cada rótulo nuevo está en los dos idiomas', function (): void {
    $claves = ['index.readOnly'];

    foreach (TenantSettingController::PESTANAS as $pestana) {
        $claves[] = "tabs.{$pestana}";
    }

    foreach (['money', 'numbering', 'ops', 'contact'] as $seccion) {
        $claves[] = "{$seccion}.saveNote";
    }

    $claves[] = 'numbering.nextLoad';
    $claves[] = 'numbering.nextInvoice';
    $claves[] = 'numbering.countersHint';

    foreach (['en', 'es'] as $idioma) {
        /** @var array<string, mixed> $dic */
        $dic = json_decode(
            (string) file_get_contents(Source::root()."/lang/{$idioma}/settings.json"),
            true,
        );

        foreach ($claves as $clave) {
            test()->assertNotNull(
                data_get($dic, $clave),
                "Falta settings.{$clave} en {$idioma}.",
            );
        }
    }
});
