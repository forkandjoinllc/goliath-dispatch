<?php

declare(strict_types=1);

use App\Authorization\Actor;
use App\Enums\Locale;
use App\Enums\Role;
use App\Support\Documents\DocumentAudience;
use App\Support\Documents\DocumentOwners;
use App\Support\Notifications\Events;
use Tests\Support\Source;

use function PHPUnit\Framework\assertSame;
use function PHPUnit\Framework\assertStringContainsString;

/**
 * «Se le avisará N días antes» — y ahora se le avisa.
 *
 * ## El defecto
 *
 * El formulario de subida prometía, debajo de la fecha de vencimiento:
 *
 * > Se le avisará {days} días antes, y la puerta de despacho bloquea en cuanto
 * > vence.
 *
 * El aviso sale de `Notifier::toPermissionHolders('document:read', …)`, y
 * `recipients()` solo mete a los roles con alcance `Tenant` o más:
 * administrador y contabilidad. `document:upload` lo tienen ADEMÁS el
 * despachador, el transportista y el conductor. Los tres leían esa frase.
 *
 * El caso caro es el conductor con su tarjeta médica: lee que se le avisará,
 * deja de vigilar la fecha, y se entera el día que la puerta de cumplimiento le
 * cierra la carga.
 *
 * ## Y el lote anterior lo dejó escrito al revés
 *
 * El comentario que acompaña a ese texto —puesto por el lote que arregló la
 * SEGUNDA mitad de la frase— dice: «La primera mitad era verdad siempre». No lo
 * era. Ese comentario es parte de lo que este fichero vigila.
 *
 * ## Lo que vigila
 *
 * Que los nueve dueños estén clasificados, que la promesa de la pantalla se
 * calcule con las reglas del emisor y no con una copia, que el barrido avise a
 * los dos lados, y que la deuda del despachador siga declarada y respetada por
 * la pantalla.
 *
 * Lo que MIDE es `tests/Feature/Notifications/ExpiryAudienceTest.php`.
 */
function raizCaducidad(): string
{
    return Source::root();
}

it('los nueve dueños están clasificados, y en un solo lado', function (): void {
    $declarados = [
        ...array_keys(DocumentAudience::AVISADOS),
        ...array_keys(DocumentAudience::SOLO_LA_OFICINA),
    ];

    $todos = DocumentOwners::all();

    sort($declarados);
    sort($todos);

    // Un dueño nuevo sin clasificar se iría por el camino de «solo la oficina»
    // sin que nadie lo decidiera, que es exactamente lo que le pasó a los
    // cuatro que sí tienen a quién avisar.
    assertSame($todos, $declarados, 'hay un dueño de documento sin clasificar');

    assertSame([], array_intersect_key(DocumentAudience::AVISADOS, DocumentAudience::SOLO_LA_OFICINA));

    // Los avisados son exactamente los que una persona elige en el formulario,
    // que son los mismos que `DocumentScope::carrierOf()` sabe resolver. Si
    // dejan de coincidir, o se promete un aviso que no se puede mandar, o se
    // deja de mandar uno que se promete.
    $elegibles = DocumentOwners::selectable();
    $avisados = array_keys(DocumentAudience::AVISADOS);
    sort($elegibles);
    sort($avisados);

    assertSame($elegibles, $avisados);

    // Y la función que consulta el registro contesta lo que el registro dice.
    // Sin esto, las listas podrían estar perfectas y `tieneAvisados()` devolver
    // `true` a secas: el papel de una carga saldría a buscar dueño y lo que lo
    // salvaría sería que no lo encuentra, que es una garantía por accidente.
    foreach (array_keys(DocumentAudience::AVISADOS) as $dueño) {
        expect(DocumentAudience::tieneAvisados($dueño))->toBeTrue("«{$dueño}» está en AVISADOS y no avisa");
    }

    foreach (array_keys(DocumentAudience::SOLO_LA_OFICINA) as $dueño) {
        expect(DocumentAudience::tieneAvisados($dueño))->toBeFalse("«{$dueño}» es de la oficina y sale a buscar dueño");
    }
});

it('el puente entre documento y transportista se lee igual en los dos sentidos', function (): void {
    // `DocumentScope` dice en su comentario que «hay un guardián que compara las
    // dos direcciones porque una tabla que se lee en dos sentidos se
    // desincroniza sin que nadie lo note».
    //
    // NO LO HABÍA. Lo escribí al añadir `carrierOf()` y nunca lo escribí de
    // verdad, y hasta este lote daba igual: `carrierOf()` solo servía para
    // avisar de un rechazo. Ahora decide a qué transportista se le manda el
    // vencimiento de la licencia de un conductor, así que un error aquí es
    // contarle a un transportista lo del vecino.
    $fuente = Source::sinComentarios(raizCaducidad().'/app/Support/Documents/DocumentScope.php');

    $corte = strpos($fuente, 'public static function carrierOf');
    $lectura = substr($fuente, 0, (int) $corte);
    $vuelta = substr($fuente, (int) $corte);

    foreach (['carrier', 'driver', 'truck', 'trailer'] as $tipo) {
        assertStringContainsString("'{$tipo}'", $lectura, "la consulta no cubre «{$tipo}»");
        assertStringContainsString("'{$tipo}'", $vuelta, "la vuelta no cubre «{$tipo}»");
    }

    // Y las tres ramas de la vuelta filtran por el documento que se les pasa.
    // Un sabotaje que quitó el `where('driver_id', …)` devolvía el PRIMER
    // transportista de la tabla, y todas mis pruebas siguieron verdes.
    assertStringContainsString("->where('driver_id', \$id)", $vuelta);
    assertStringContainsString("->where('id', \$id)", $vuelta);
});

it('cada dueño dice por qué se le avisa o por qué no', function (): void {
    foreach ([...DocumentAudience::AVISADOS, ...DocumentAudience::SOLO_LA_OFICINA] as $dueño => $motivo) {
        expect(strlen($motivo))->toBeGreaterThan(40, "el dueño «{$dueño}» no dice por qué");
    }

    foreach (DocumentAudience::SIN_AVISO_HOY as $quien => $motivo) {
        // Una deuda sin motivo es un descuido con mejor letra.
        expect(strlen($motivo))->toBeGreaterThan(80, "la deuda «{$quien}» no explica nada");
    }
});

it('el suceso del vencimiento declara los tres públicos', function (): void {
    foreach (['document.expiring', 'document.expired'] as $suceso) {
        $publicos = Events::publicos($suceso);

        // La oficina sigue enterándose: quien lleva el cumplimiento de la
        // empresa no puede perder este aviso porque ahora lo reciba el dueño.
        expect($publicos)->toContain(Events::OFICINA);
        expect($publicos)->toContain(Events::TRANSPORTISTA);
        expect($publicos)->toContain(Events::PROPIO);
    }
});

it('el barrido avisa a los dos lados y no solo a la oficina', function (): void {
    $fuente = Source::compacta(raizCaducidad().'/app/Console/Commands/SweepNotifications.php');

    // La consulta tiene que TRAER al dueño: sin `owner_type` no se puede saber
    // a quién más avisar, y esa columna no estaba en el `get()`.
    expect($fuente)->toContain("'expiration_date','owner_type','owner_id','tenant_id'");

    // Las dos vías, con el registro decidiendo.
    expect($fuente)->toContain('DocumentAudience::tieneAvisados($tipo)');
    expect($fuente)->toContain('DocumentScope::carrierOf($documento)');
    expect($fuente)->toContain('DocumentAudience::personaDe($documento)');
    expect($fuente)->toContain('Notifier::toCarrier(');
    expect($fuente)->toContain('Notifier::toOwner(');

    // Y la oficina sigue recibiendo el suyo: el aviso del dueño se AÑADE.
    expect($fuente)->toContain('Notifier::toPermissionHolders(');
});

it('la clave de deduplicación es la misma para los dos lados', function (): void {
    $fuente = Source::compacta(raizCaducidad().'/app/Console/Commands/SweepNotifications.php');

    // Dos claves distintas para el mismo hecho dejarían que el mismo barrido
    // avisara dos veces a una persona que estuviera en los dos lados. El índice
    // único es (clave, usuario, canal): compartirla no pisa el aviso de nadie y
    // sí impide el duplicado.
    expect(substr_count($fuente, "(\$caducado?'document.expired:':'document.expiring:')"))->toBe(2);
});

it('la pantalla promete lo que el emisor cumple, y no lo deduce del rol', function (): void {
    $controlador = Source::compacta(raizCaducidad().'/app/Http/Controllers/App/DocumentController.php');
    $pantalla = (string) file_get_contents(raizCaducidad().'/resources/js/pages/App/Documents/Form.tsx');

    expect($controlador)->toContain('DocumentAudience::avisaAlActor($actor,$tipo)');

    // La pantalla pregunta por la lista que le mandaron. Deducirlo del rol en
    // React sería la copia parecida de siempre, y además el rol no está en las
    // propiedades de esta página.
    assertStringContainsString('notifiedOwners.includes(ownerType)', $pantalla);

    // Y la condición ENTERA: `avisan` suelto seguiría estando con el ternario
    // apagado.
    assertStringContainsString('{avisan', $pantalla);

    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(raizCaducidad()."/lang/{$idioma}/documents.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        foreach (['expirationHintOffice', 'expirationHintOfficeBlocks'] as $clave) {
            expect($d['form'][$clave] ?? null)->toBeString("falta «{$clave}» en {$idioma}");
        }
    }
});

it('al despachador no se le promete lo que no se le manda', function (): void {
    $despachador = new Actor(
        userId: 'u',
        email: 'd@prueba.test',
        firstName: 'D',
        lastName: 'P',
        locale: Locale::Es,
        timezone: 'America/Chicago',
        isPlatformSuperAdmin: false,
        tenantId: 't',
        role: Role::Dispatcher,
    );

    // La deuda está declarada; lo que no puede es estar declarada Y prometida.
    expect(DocumentAudience::SIN_AVISO_HOY)->toHaveKey('dispatcher');

    foreach (DocumentOwners::selectable() as $tipo) {
        expect(DocumentAudience::avisaAlActor($despachador, $tipo))->toBeFalse(
            "al despachador se le promete el aviso de «{$tipo}» y no se le manda",
        );
    }
});

it('el comentario que decía que la primera mitad era verdad ya no lo dice', function (): void {
    $pantalla = (string) file_get_contents(raizCaducidad().'/resources/js/pages/App/Documents/Form.tsx');

    // Lo escribió el lote que arregló la segunda mitad de la frase. Era falso, y
    // un comentario falso en el sitio exacto donde vive el defecto es lo que
    // hace que el siguiente lector no mire.
    expect($pantalla)->not->toContain('La primera mitad era verdad siempre');
    expect($pantalla)->toContain('NO LO ERA');
});
