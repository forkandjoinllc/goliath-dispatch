<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * Con QUIÉN factoriza un transportista, y en qué calidad.
 *
 * ## Lo que este lote vino a sujetar
 *
 * **Una pregunta que se hacía y no se guardaba.** El alta pública tenía la
 * casilla «I factor my invoices» desde el principio y nunca preguntaba con
 * quién. La casa se quedaba con una fila que decía «sí» y no decía con quién,
 * que es la que luego nadie sabe explicar. En goliathdispatch.com era peor:
 * allí no se crea transportista y `leads` no tenía la columna, así que la
 * respuesta no se guardaba a medias — se tiraba entera.
 *
 * **Una segunda respuesta a la misma pregunta.** El plan de este lote decía
 * añadir `carriers.factoring_company_id`. Leyendo el código apareció que
 * `factoring_assignments` ya es la asignación, con vigencia, carta de cesión y
 * verificación, y que hay un comentario que dice que vive ahí y NO en una
 * columna de `carriers`. Dos sitios contestando «¿con quién factoriza?» acaban
 * contestando cosas distintas.
 *
 * **Un simulacro de vínculo verificado.** Si el alta pública creara la
 * asignación, la fila nacería afirmando una relación que nadie comprobó. La
 * verifica la casa —para eso `factoring_assignments` tiene
 * `verification_status`—, no el desconocido que rellena el formulario.
 *
 * **Identificadores internos en una página pública.** Un desplegable con los
 * UUID de `factoring_companies` los publica a cambio de nada: el nombre ya es
 * único por empresa y el servidor puede resolverlo él.
 */
function fuenteFactoring(string $ruta): string
{
    return Source::codigo(Source::root().'/'.$ruta);
}

/* ── Declarado no es asignado ───────────────────────────────────────────── */

it('el alta pública no crea la asignación', function (): void {
    /*
    | Una asignación es un vínculo que establece la casa y que puede llevar
    | carta de cesión y verificación. Crearla desde un formulario público haría
    | nacer la fila diciendo que existe algo que nadie comprobó.
    */
    $alta = fuenteFactoring('app/Http/Controllers/Marketing/CarrierSignupController.php');

    test()->assertStringNotContainsString('factoring_assignments', $alta);
    test()->assertStringNotContainsString('verification_status', $alta);
});

it('la asignación sigue siendo la única asignación', function (): void {
    // `carriers` no gana una columna que compita con `factoring_assignments`.
    // Las que gana se llaman «declared» y significan otra cosa.
    $esquema = fuenteFactoring('database/migrations/2026_10_21_100000_declared_factoring.php');

    test()->assertStringContainsString('factoring_declared_company_id', $esquema);
    test()->assertStringContainsString('factoring_declared_name', $esquema);

    // Y no hay ninguna columna que se llame como la de la asignación.
    foreach (['carriers', 'leads'] as $tabla) {
        test()->assertStringNotContainsString(
            "alter table `{$tabla}` add column factoring_company_id",
            $esquema,
        );
    }
});

/* ── Lo que la base impide de verdad ────────────────────────────────────── */

it('la base impide el nombre colgando de un «no»', function (): void {
    $esquema = fuenteFactoring('database/migrations/2026_10_21_100000_declared_factoring.php');

    // Si no factoriza no puede haber ni ficha ni nombre…
    test()->assertStringContainsString('chk_carriers_factoring_declared', $esquema);
    test()->assertStringContainsString('chk_leads_factoring', $esquema);

    // …y nunca las dos a la vez.
    test()->assertStringContainsString(
        'is null or `factoring_declared_name` is null',
        $esquema,
    );
    test()->assertStringContainsString(
        'is null or `factoring_company_name` is null',
        $esquema,
    );
});

it('la aislación entre empresas es de la base, no del controlador', function (): void {
    /*
    | Un identificador de la lista de OTRA empresa pasa cualquier validación de
    | formato. El ámbito global impide LEERLO, y no impediría escribirlo. La
    | clave foránea compuesta sí.
    */
    $esquema = fuenteFactoring('database/migrations/2026_10_21_100000_declared_factoring.php');

    foreach (['fk_carriers_factoring_declared_xt', 'fk_leads_factoring_company_xt'] as $clave) {
        test()->assertStringContainsString($clave, $esquema);
    }

    test()->assertSame(
        2,
        substr_count($esquema, 'references `factoring_companies` (`tenant_id`, `id`)'),
        'Las dos claves foráneas tienen que ser COMPUESTAS contra (tenant_id, id).',
    );
});

/* ── La página pública ──────────────────────────────────────────────────── */

it('a la página pública no viajan los identificadores de la tabla', function (): void {
    $publico = fuenteFactoring('app/Support/Marketing/PublicFactoring.php');

    // Nombres, no filas: `pluck('name')` y no `get(['id', 'name'])`.
    test()->assertStringContainsString("pluck('name')", $publico);
    test()->assertStringNotContainsString("'id', 'name'", $publico);
});

it('ni los contactos ni las instrucciones de pago de la factoring', function (): void {
    // La ficha de una empresa de factoring lleva correo, teléfono y
    // `funding_instructions`. Eso no sale a una página pública por ningún
    // motivo, y la única forma de asegurarlo es no seleccionarlo nunca.
    $publico = fuenteFactoring('app/Support/Marketing/PublicFactoring.php');

    foreach (['funding_instructions', 'contact_name', 'email', 'phone'] as $columna) {
        test()->assertStringNotContainsString(
            "'{$columna}'",
            $publico,
            "La lista pública no puede seleccionar `{$columna}`.",
        );
    }
});

it('la lista pública solo lleva las activas y las no borradas', function (): void {
    /*
    | CADA consulta, no «el fichero en algún sitio».
    |
    | La primera versión de esta guarda buscaba `where('active', true)` en todo
    | el fichero. Hay DOS consultas aquí —la que ofrece la lista y la que
    | resuelve un nombre— y con esa comprobación se podía quitar el filtro de
    | una de las dos: la cadena seguía apareciendo por la otra y la guarda
    | seguía en verde. Medía algo de al lado de lo que decía medir. Es la quinta
    | vez en seis lotes que aparece esta forma de fallo; ver docs/testing.md.
    */
    $publico = fuenteFactoring('app/Support/Marketing/PublicFactoring.php');

    foreach (['public static function names', 'public static function resolve'] as $firma) {
        $desde = strpos($publico, $firma);
        test()->assertNotFalse($desde, "No se encuentra {$firma}.");

        $cuerpo = substr($publico, (int) $desde, (int) (strpos($publico, "\n    }", (int) $desde) - $desde));

        test()->assertStringContainsString('whereNull(\'deleted_at\')', $cuerpo, "{$firma} no descarta las borradas.");
        test()->assertStringContainsString('where(\'active\', true)', $cuerpo, "{$firma} no descarta las inactivas.");
        test()->assertStringContainsString('tenant_id', $cuerpo, "{$firma} no acota por empresa.");
    }
});

it('sin empresa no hay lista que ofrecer', function (): void {
    /*
    | En goliathdispatch.com no hay casa de despacho, así que no hay lista. Un
    | desplegable vacío sería un filtro que no puede encontrar nada —el mismo
    | defecto del lote 43— y la pantalla enseña la casilla de texto.
    */
    $publico = fuenteFactoring('app/Support/Marketing/PublicFactoring.php');

    test()->assertStringContainsString('if (! $context->hasTenant()) {', $publico);

    $pantalla = fuenteFactoring('resources/js/components/Marketing/FactoringChoice.tsx');

    test()->assertStringContainsString('const hayLista = opciones.length > 0', $pantalla);
    test()->assertStringContainsString('! hayLista || otra', $pantalla);
});

it('el desplegable y «Other» mandan el mismo campo', function (): void {
    /*
    | Dos campos —uno con el identificador elegido y otro con el nombre
    | escrito— permitirían mandar los dos y dejar al servidor decidiendo cuál
    | de las dos respuestas se cree. Con uno solo ese estado no existe.
    */
    $pantalla = fuenteFactoring('resources/js/components/Marketing/FactoringChoice.tsx');

    test()->assertSame(
        1,
        substr_count($pantalla, 'onNombre: (valor: string) => void'),
        'Un solo campo de salida: el nombre.',
    );
    test()->assertStringNotContainsString('factoring_company_id', $pantalla);
});

it('desmarcar la casilla limpia el nombre', function (): void {
    // Dejarlo escrito mandaría un nombre colgando de un «no», y el CHECK lo
    // rechazaría DESPUÉS de que la persona hubiera pulsado enviar.
    $pantalla = fuenteFactoring('resources/js/components/Marketing/FactoringChoice.tsx');

    test()->assertStringContainsString("if (! valor) {\n            onNombre('')", $pantalla);
});

/* ── Lo que la pantalla del panel dice ──────────────────────────────────── */

it('la ficha ya no contesta «Sí» a «con quién»', function (): void {
    /*
    | «Factoring: Sí» no responde a la pregunta, y la respuesta estaba en la
    | base: la asignación llevaba lotes existiendo y la ficha no la leía.
    */
    $ficha = fuenteFactoring('resources/js/pages/App/Carriers/Show.tsx');

    test()->assertStringContainsString('carrier.factoring.assignedName', $ficha);
    test()->assertStringContainsString('carrier.factoring.declaredName', $ficha);
    test()->assertStringContainsString('carriers.detail.factoringUnknown', $ficha);
});

it('la ficha distingue declarada de asignada', function (): void {
    // Significan cosas distintas para quien va a cobrar: una la estableció la
    // casa, la otra la dijo el transportista y nadie la comprobó.
    $ficha = fuenteFactoring('resources/js/pages/App/Carriers/Show.tsx');

    test()->assertStringContainsString('carriers.detail.factoringDeclared', $ficha);
    test()->assertStringContainsString('carriers.detail.factoringDeclaredNoRecord', $ficha);
});

it('preseleccionar lo declarado no pasa en silencio', function (): void {
    /*
    | Guardar la ficha con la empresa preseleccionada convierte una declaración
    | en una asignación. Es lo que hace útil el alta, y es un acto de la casa:
    | el formulario lo dice en vez de dejar que ocurra sin avisar.
    */
    $formulario = fuenteFactoring('resources/js/pages/App/Carriers/Form.tsx');

    test()->assertStringContainsString('factoringCompanyId ?? factoringDeclared.id', $formulario);
    test()->assertStringContainsString('carriers.form.factoringDeclaredPreselected', $formulario);
    test()->assertStringContainsString('carriers.form.factoringDeclaredNoRecord', $formulario);
});

it('un nombre sin ficha no se enseña como si la tuviera', function (): void {
    // Es la lección del arrendador del lote 41: el texto se conserva, y la
    // pantalla dice cuándo no hay ficha detrás.
    $prospecto = fuenteFactoring('resources/js/pages/App/Leads/Show.tsx');

    test()->assertStringContainsString('lead.factoringHasRecord', $prospecto);
    test()->assertStringContainsString('leads.show.factoringNoRecord', $prospecto);
});

it('el prospecto no inventa una respuesta que nadie dio', function (): void {
    /*
    | Un prospecto del formulario de contacto nunca vio la pregunta del
    | factoring. Pintarle «Factoring: No» sería ponerle en la boca una
    | respuesta que no dio.
    */
    $prospecto = fuenteFactoring('resources/js/pages/App/Leads/Show.tsx');

    test()->assertStringContainsString('{lead.usesFactoring ? (', $prospecto);
});

/* ── Los rótulos existen en los dos idiomas ─────────────────────────────── */

it('cada rótulo nuevo está en inglés y en español', function (): void {
    $claves = [
        'carriers' => [
            'form.factoringDeclaredPreselected',
            'form.factoringDeclaredNoRecord',
            'detail.factoringDeclared',
            'detail.factoringDeclaredNoRecord',
            'detail.factoringUnknown',
        ],
        'leads' => [
            'show.factoring',
            'show.factoringUnknown',
            'show.factoringNoRecord',
        ],
        'marketing' => [
            'carrierSignup.factoring.which',
            'carrierSignup.factoring.choose',
            'carrierSignup.factoring.other',
            'carrierSignup.factoring.hint',
            'carrierSignup.factoring.otherName',
            'carrierSignup.factoring.otherHint',
        ],
    ];

    foreach (['en', 'es'] as $idioma) {
        foreach ($claves as $espacio => $rutas) {
            /** @var array<string, mixed> $dic */
            $dic = json_decode(
                (string) file_get_contents(Source::root()."/lang/{$idioma}/{$espacio}.json"),
                true,
            );

            foreach ($rutas as $ruta) {
                test()->assertNotNull(
                    data_get($dic, $ruta),
                    "Falta {$espacio}.{$ruta} en {$idioma}.",
                );
            }
        }
    }
});

it('el aviso de lo declarado nombra la empresa', function (): void {
    /*
    | «El transportista declaró otra empresa» sin decir cuál obliga a abrir el
    | alta para saberlo. El rótulo lleva {name} en los dos idiomas.
    */
    foreach (['en', 'es'] as $idioma) {
        /** @var array<string, mixed> $dic */
        $dic = json_decode(
            (string) file_get_contents(Source::root()."/lang/{$idioma}/carriers.json"),
            true,
        );

        foreach (['factoringDeclaredPreselected', 'factoringDeclaredNoRecord'] as $clave) {
            test()->assertStringContainsString(
                '{name}',
                (string) data_get($dic, "form.{$clave}"),
                "form.{$clave} en {$idioma} tiene que nombrar la empresa.",
            );
        }
    }
});

/* ── La regla del formulario ─────────────────────────────────────────────── */

it('decir que se factoriza obliga a decir con quién', function (): void {
    $peticion = fuenteFactoring('app/Http/Requests/Marketing/StoreCarrierSignupRequest.php');

    test()->assertStringContainsString("'required_if_accepted:uses_factoring'", $peticion);
    test()->assertStringContainsString("'prohibited_if_declined:uses_factoring'", $peticion);
});

it('el nombre se recorta antes de validarlo', function (): void {
    // « ACME » y «ACME» son la misma empresa, y sin recortar la primera no
    // coincide con la ficha y acaba guardada como texto suelto.
    $peticion = fuenteFactoring('app/Http/Requests/Marketing/StoreCarrierSignupRequest.php');

    test()->assertStringContainsString(
        "trim((string) \$this->input('factoring_company_name'))",
        $peticion,
    );
});
