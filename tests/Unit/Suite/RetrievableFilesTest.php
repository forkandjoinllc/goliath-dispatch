<?php

declare(strict_types=1);

use App\Support\Storage\StoredFiles;
use Tests\Support\Source;

use function PHPUnit\Framework\assertArrayHasKey;
use function PHPUnit\Framework\assertSame;
use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertStringNotContainsString;

/**
 * Todo fichero que se guarda se puede volver a sacar.
 *
 * ## El defecto
 *
 * `message_attachments` llevaba desde el primer día con su fichero, su nombre,
 * su tamaño y su `sha256`, y **no había ninguna ruta para bajárselo**. La
 * pantalla del hilo pintaba «comprobante.pdf · 240 KB» como texto, sin enlace,
 * porque no había a dónde enlazar. Ni quien lo recibía ni quien lo había subido
 * podían abrirlo jamás.
 *
 * Es la peor forma de la promesa falsa: una lista de adjuntos PARECE una lista
 * de adjuntos. Nadie mira un nombre de fichero y un peso y concluye que no se
 * puede bajar; concluye que pulsa mal.
 *
 * ## Y la segunda, que encontró este guardián
 *
 * Al escribirlo apareció `equipment_media`: ruta para SUBIR una foto, ruta para
 * BORRARLA, ninguna para verla. Y ahí duele más, porque los cuatro ángulos son
 * la puerta de `Equipment\Eligibility` —sin ellos la unidad no se asigna— y la
 * página pública lo promete. Una foto que nadie puede mirar no documenta el
 * camión: documenta que alguien subió un fichero de ese tamaño.
 *
 * ## Qué vigila
 *
 * `StoredFiles::COLUMNS` es el inventario de lo que esta aplicación guarda en
 * disco. Cada entrada tiene que tener una forma declarada de recuperarse, o un
 * motivo declarado de por qué no. Lo tercero —no estar— es lo que dejó a dos
 * tablas sin salida durante meses.
 */
function raizFicheros(): string
{
    return Source::root();
}

/**
 * Tabla => cómo se recupera su fichero, o por qué no se recupera.
 *
 * La segunda posición es la aguja que tiene que aparecer en `routes/`: una
 * declaración que no se comprueba contra las rutas es una lista de buenas
 * intenciones.
 *
 * @var array<string, array{0: string, 1: ?string}>
 */
const SE_RECUPERA = [
    'document_versions' => [
        'La ficha del documento tiene su botón de descarga, con permiso `document:download` y su fila en `document_access_logs`.',
        "->name('documents.download')",
    ],
    'message_attachments' => [
        'Desde este lote: el nombre del adjunto es un enlace a `messages.attachments.show`, cruzado con su hilo.',
        "->name('messages.attachments.show')",
    ],
    'equipment_media' => [
        'Desde este lote: el ángulo es un enlace a `equipment.media.show`, cruzado con su unidad.',
        "->name('equipment.media.show')",
    ],
    'signature_records' => [
        'El certificado de auditoría se baja por `signatures.certificate`, que además anota el evento de la ceremonia.',
        "->name('signatures.certificate')",
    ],
    'tenant_branding' => [
        'El logotipo lo sirve la ruta pública de marca, que es justo lo que tiene que ser: una imagen que se pinta en una página que ve cualquiera.',
        "->name('public.brand.logo')",
    ],
    'export_jobs' => [
        'NADIE ESCRIBE ESTA COLUMNA. `ReportController::export()` transmite el CSV en la misma respuesta y no guarda nada: la tabla y su `storage_key` existen para una exportación asíncrona que no se ha construido. No hace falta ruta para sacar un fichero que no se guarda; hará falta el día que se guarde, y entonces esta entrada obliga a escribirla.',
        null,
    ],
    'users' => [
        'NADIE ESCRIBE ESTA COLUMNA. `users.avatar_storage_key` está en el esquema y ningún camino de la aplicación sube un avatar. Mismo caso que las exportaciones.',
        null,
    ],
];

it('cada tabla del inventario de ficheros está declarada', function (): void {
    // La comprobación que importa: una tabla NUEVA con ficheros aparece aquí
    // antes de que alguien pueda guardar en ella algo que no se pueda sacar.
    $delInventario = array_keys(StoredFiles::COLUMNS);
    $declaradas = array_keys(SE_RECUPERA);

    sort($delInventario);
    sort($declaradas);

    assertSame($delInventario, $declaradas, implode("\n", [
        'StoredFiles::COLUMNS y la lista de este guardián no coinciden.',
        'En el inventario: '.implode(', ', $delInventario),
        'Declaradas:       '.implode(', ', $declaradas),
    ]));
});

it('la forma declarada de recuperar el fichero existe de verdad', function (): void {
    $rutas = Source::sinComentarios(raizFicheros().'/routes/auth.php')
        .Source::sinComentarios(raizFicheros().'/routes/web.php');

    foreach (SE_RECUPERA as $tabla => [$motivo, $aguja]) {
        if ($aguja === null) {
            continue;
        }

        assertStringContainsString(
            $aguja,
            $rutas,
            "«{$tabla}» dice recuperarse por una ruta que no existe: {$aguja}",
        );
    }
});

it('cada declaración explica lo suficiente', function (): void {
    foreach (SE_RECUPERA as $tabla => [$motivo, $aguja]) {
        expect(strlen($motivo))->toBeGreaterThan(70, "«{$tabla}» no explica cómo se recupera su fichero.");
    }
});

it('lo que se declara sin ruta es porque nadie lo escribe', function (): void {
    // La otra dirección, y la que evita que esta lista se convierta en un sitio
    // donde aparcar deuda: si mañana alguien empieza a guardar exportaciones o
    // avatares, la declaración deja de ser cierta y hay que darle una ruta.
    $app = '';

    $ficheros = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(raizFicheros().'/app', FilesystemIterator::SKIP_DOTS),
    );

    foreach ($ficheros as $fichero) {
        if ($fichero->getExtension() === 'php') {
            $app .= Source::compacta($fichero->getPathname());
        }
    }

    // El modelo no cuenta: declarar `$table` y `$fillable` no es guardar nada.
    $modelos = ['export_jobs' => 'ExportJob', 'users' => 'User'];

    foreach (SE_RECUPERA as $tabla => [$motivo, $aguja]) {
        if ($aguja !== null) {
            continue;
        }

        // Nadie ESCRIBE en esa tabla por consulta directa…
        foreach (["DB::table('{$tabla}')->insert", "DB::table('{$tabla}')->update", "DB::table('{$tabla}')->upsert"] as $escritura) {
            expect(str_contains($app, $escritura))->toBeFalse(
                "«{$tabla}» ya recibe escrituras: hace falta una forma de sacar su fichero.",
            );
        }

        // …ni por el almacén, que es la otra manera de que aparezca un fichero.
        $modelo = $modelos[$tabla] ?? null;

        if ($modelo !== null) {
            foreach (StoredFiles::COLUMNS[$tabla] as $columna) {
                expect(str_contains($app, "->{$columna}="))->toBeFalse(
                    "«{$tabla}.{$columna}» ya se escribe por el modelo: hace falta una forma de sacar ese fichero.",
                );
            }
        }
    }
});

it('las dos rutas nuevas cruzan el fichero con su dueño', function (): void {
    // Sin el cruce, el id de un adjunto de otra conversación —o de una foto de
    // otro camión— emparejado con algo que sí se puede abrir serviría el
    // fichero: la comprobación estaría hecha sobre una cosa y el fichero sería
    // de otra.
    $mensajes = Source::compacta(raizFicheros().'/app/Http/Controllers/App/MessageController.php');
    $equipos = Source::compacta(raizFicheros().'/app/Http/Controllers/App/EquipmentController.php');

    assertStringContainsString("->where('m.conversation_id',\$hilo->id)", $mensajes);
    assertStringContainsString("->where('equipment_id',\$model->id)", $equipos);
    assertStringContainsString("->where('equipment_type',\$this->singular(\$type))", $equipos);
});

it('la clave del almacén no viaja a ninguna de las dos pantallas', function (): void {
    // Lo que se manda es el id; la clave la resuelve el servidor. Es la lección
    // del lote de «mandado y escondido», y aquí valdría el doble: la clave ES
    // la dirección del fichero.
    foreach (['app/Support/Messaging/Inbox.php', 'app/Support/Equipment/Media.php'] as $pieza) {
        $fuente = Source::compacta(raizFicheros().'/'.$pieza);

        expect(str_contains($fuente, "'storageKey'=>"))->toBeFalse("«{$pieza}» manda la clave del almacén a la pantalla.");
        assertStringContainsString("'href'=>", $fuente);
    }
});

it('los ficheros que hay que servir se guardan bajo el prefijo que el servidor acepta', function (): void {
    // `DocumentFileController` solo sirve claves que empiezan por `documents/`
    // —defensa en profundidad, para que una URL firmada mal generada no saque
    // nada de fuera de ahí—. `DocumentStore::put()` usa ese prefijo;
    // `putBytes()` admite otro.
    //
    // O sea: guardar un adjunto o una foto con `putBytes(..., prefix: 'otra')`
    // no daría ningún error, y el enlace de descarga contestaría 404 sin que
    // nada lo explicara. Lo descubrió el sembrador de pruebas, que usa
    // `pruebas/...` y hacía fallar la descarga.
    $portero = Source::compacta(raizFicheros().'/app/Http/Controllers/App/DocumentFileController.php');

    assertStringContainsString("str_starts_with(\$storageKey,'documents/')", $portero);

    foreach (['app/Support/Messaging/Posting.php', 'app/Support/Equipment/Media.php'] as $pieza) {
        $fuente = Source::compacta(raizFicheros().'/'.$pieza);

        assertStringContainsString('$store->put(', $fuente, "«{$pieza}» dejó de usar el prefijo por omisión.");
        expect(str_contains($fuente, 'putBytes('))->toBeFalse("«{$pieza}» guarda con un prefijo propio: su enlace de descarga dará 404.");
    }
});

it('las dos pantallas pintan un enlace de verdad', function (): void {
    // Lo que faltaba no era el dato: era el `<a href>`. Una prueba de
    // característica mide que la ruta LLEGA a la pantalla, y se queda en verde
    // aunque la pantalla la reciba y no la use — que es exactamente el estado
    // del que venimos, con el nombre del fichero pintado como texto.
    foreach ([
        ['resources/js/pages/App/Messages/Show.tsx', 'a.href'],
        ['resources/js/pages/App/Equipment/Show.tsx', 'f.href'],
    ] as [$ruta, $campo]) {
        $pantalla = (string) file_get_contents(raizFicheros().'/'.$ruta);
        $pantalla = (string) preg_replace('#/\*.*?\*/#s', '', $pantalla);
        $pantalla = (string) preg_replace('#^\s*//.*$#m', '', $pantalla);
        $compacta = (string) preg_replace('/\s+/', '', $pantalla);

        assertStringContainsString(
            '<ahref={'.$campo.'}',
            $compacta,
            "«{$ruta}» recibe la ruta y no la enlaza: el fichero sigue sin poderse abrir.",
        );
    }
});

it('el fichero vuelve con el nombre que tenía', function (): void {
    // La clave de almacenamiento es un UUID, y sin nombre el navegador guarda
    // eso. El nombre estaba guardado en las tres tablas que sirven ficheros
    // —`filename`, `original_filename`— y ninguna lo usaba al devolverlos.
    //
    // Se comprueba en el ORIGEN —que la firma lo lleve— y no solo en el
    // destino: una prueba sobre la cabecera se queda en verde si alguien deja
    // de pasar el nombre en uno de los cuatro sitios.
    $pieza = Source::compacta(raizFicheros().'/app/Support/Storage/LocalDocumentStore.php');

    assertStringContainsString("'name'=>\$filename===null?null:base64_encode(\$filename)", $pieza);
    assertStringContainsString("'inline'=>\$inline?'1':null", $pieza);

    foreach ([
        'app/Http/Controllers/App/MessageController.php',
        'app/Http/Controllers/App/EquipmentController.php',
        'app/Http/Controllers/App/DocumentController.php',
        'app/Http/Controllers/App/PermitController.php',
    ] as $ruta) {
        $fuente = Source::compacta(raizFicheros().'/'.$ruta);

        assertStringContainsString(
            'filename:',
            $fuente,
            "«{$ruta}» sirve un fichero sin decir con qué nombre: saldrá con el UUID de la clave.",
        );
    }

    // Y nadie vuelve a firmar la ruta a mano, que es como `PermitController` se
    // quedó fuera cuando la pieza aprendió a poner el nombre.
    $permisos = Source::compacta(raizFicheros().'/app/Http/Controllers/App/PermitController.php');

    assertStringNotContainsString("URL::temporarySignedRoute('documents.file'", $permisos);
});

it('las dos rutas dicen cuando el fichero no está', function (): void {
    // La pantalla de retención lleva contando «filas que nombran un fichero que
    // no está» y diciendo que «cada una es un botón de descarga que va a
    // fallar». Desde este lote esos botones existen de verdad.
    $mensajes = Source::compacta(raizFicheros().'/app/Http/Controllers/App/MessageController.php');
    $equipos = Source::compacta(raizFicheros().'/app/Http/Controllers/App/EquipmentController.php');

    assertStringContainsString("__('messages.errors.attachmentMissing')", $mensajes);
    assertStringContainsString("__('equipment.media.fileMissing')", $equipos);

    foreach (['es', 'en'] as $idioma) {
        $m = json_decode((string) file_get_contents(raizFicheros()."/lang/{$idioma}/messages.json"), true);
        $e = json_decode((string) file_get_contents(raizFicheros()."/lang/{$idioma}/equipment.json"), true);

        assertArrayHasKey('attachmentMissing', $m['errors'], "falta el texto en {$idioma}");
        assertArrayHasKey('fileMissing', $e['media'], "falta el texto en {$idioma}");
    }
});
