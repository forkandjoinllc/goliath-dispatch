# El fichero que se guardaba y no se podía sacar

## El defecto

`Posting::attach()` guarda el fichero de un adjunto de mensaje, escribe su fila
con la clave de almacenamiento, el nombre original, el tipo, el tamaño y su
`sha256`. `Inbox::attachments()` lo lee. La pantalla del hilo lo pinta:

```
comprobante.pdf  240 KB
```

Como **texto**. No existía ninguna ruta para bajárselo — ni esa ni ninguna otra
forma de llegar al fichero. Se subía un comprobante a la conversación con el
transportista, el otro leía el nombre y el peso, y ni él ni quien lo había
subido podían abrirlo jamás. El fichero se quedaba en el almacén ocupando sitio
y reclamado por una fila, así que ni siquiera salía en el recuento de huérfanos.

Es la peor forma de la promesa falsa: **una lista de adjuntos parece una lista
de adjuntos**. Nadie mira un nombre de fichero y un peso y concluye que no se
puede bajar; concluye que pulsa mal, o que falla el navegador.

Y la aplicación tenía tres maneras de servir un fichero —`documents.download`,
`documents.file`, los papeles de una carga— y esta pantalla no usaba ninguna.

## La segunda, que encontró el guardián

`StoredFiles::COLUMNS` es el inventario de lo que esta aplicación guarda en
disco. Al escribir el guardián que exige una salida para cada entrada, apareció
`equipment_media`: ruta para **subir** una foto, ruta para **borrarla**, ninguna
para verla.

Y ahí duele más, porque los cuatro ángulos son la puerta de
`Equipment\Eligibility` —sin ellos la unidad no se asigna— y la página pública
lo promete: «cada unidad documenta sus cuatro lados antes de poder asignarse».
Una foto que nadie puede mirar no documenta el camión: documenta que alguien
subió un fichero de ese tamaño.

## La tercera, que encontró el recorrido

Con las dos rutas puestas, el navegador bajó el fichero y llegó así:

```
content-disposition: attachment; filename=b29a564e-73e0-4b7c-8046-5607fc3e758c.pdf
```

La clave de almacenamiento es un UUID a propósito —el nombre que escribe una
persona no puede ser un nombre de fichero— y **al devolverlo tampoco se usaba
como dato**. Quien se bajaba tres seguros tenía tres nombres que no decían nada.

El nombre estaba guardado en las dos tablas: `message_attachments.filename` y
`document_versions.original_filename`, esta última con un comentario que dice
literalmente «el nombre original es un DATO, no un nombre de fichero». Lo era. Y
no se usaba.

Afectaba a **todas** las descargas de la aplicación, no solo a las nuevas.

Y la otra mitad: una foto se **mira**. Servirla como adjunto baja un fichero en
vez de enseñarla, así que «ver la foto» descargaba `d6c51895-….jpg`. Ahora va
`inline` y se llama por su ángulo: `front.jpg`.

## Cómo se sirve

`DocumentStore::temporaryUrl($clave, $minutos, filename:, inline:)`. Los dos
viajan **dentro de la firma**, así que nadie puede cambiar con qué nombre se
sirve un fichero ajeno — una prueba manipula el parámetro y comprueba el 403.

`DocumentFileController` recorta el nombre a lo que puede ser un nombre de
fichero. No por el navegador —`download()` ya escapa la cabecera— sino porque lo
escribió una persona y las barras no pintan nada en una carpeta de descargas.

`PermitController` firmaba la ruta a mano y por eso se quedó fuera cuando la
pieza aprendió a poner el nombre. Ahora pasa por ella, y un guardián prohíbe
volver a firmarla a mano.

## Quién puede

| | Permiso | Cruce |
|---|---|---|
| adjunto | `message:read`, y `MessageScope` sólo da el hilo si estás dentro | el adjunto se busca cruzado con su mensaje **y** el hilo |
| foto | `equipment:read`, el mismo que abre la ficha donde se anuncia | la foto se busca cruzada con su tipo **y** su unidad |

El cruce no es adorno: sin él, el id de un adjunto de otra conversación
emparejado con un hilo que sí se puede leer bajaría el fichero. La comprobación
estaría hecha sobre una cosa y el fichero sería de otra. Las dos pruebas que lo
fijan usan un actor que puede leer **las dos** cosas — con un hilo ajeno no
medirían nada, porque el 404 llegaría antes del cruce.

Mirar una foto pide `equipment:read` y **no** `equipment:media:upload`: pedir el
permiso de subirla para mirarla dejaría fuera justo a quien tiene que comprobar
que los cuatro lados están. Contabilidad es el rol que lo demuestra en la prueba
—tiene lectura y no subida—; con el despachador no se medía nada, porque tiene
los dos, y un sabotaje se quedó en verde.

## Lo que sigue sin viajar

La `storage_key`. La ruta lleva el id y el servidor resuelve la clave; mandarla
sería darle la dirección del fichero a quien quizá no puede abrirlo.

## El registro

`document.downloaded` con `entityType = 'message_attachment'`. La acción dice lo
que pasó y el tipo dice sobre qué; inventar una acción nueva pedía tocar el
CHECK de `audit_events.action`, o sea una migración, por una distinción que el
tipo de entidad ya hace.

**No** se escribe en `document_access_logs`, y no por olvido: esa tabla apunta
con clave foránea a `documents`, y un adjunto no es una fila de `documents`.
Meterlo ahí exigiría relajar la clave o convertir cada adjunto en un documento,
y las dos cosas son un lote aparte.

## El inventario, declarado

| Tabla | Cómo se saca su fichero |
|---|---|
| `document_versions` | `documents.download` |
| `message_attachments` | `messages.attachments.show` · nuevo |
| `equipment_media` | `equipment.media.show` · nuevo |
| `signature_records` | `signatures.certificate` |
| `tenant_branding` | `public.brand.logo` |
| `export_jobs` | **nadie escribe esa columna** |
| `users` (avatar) | **nadie escribe esa columna** |

Las dos últimas son columnas del esquema para cosas que no se han construido. Se
declaran igual, con su motivo, y el guardián comprueba **las dos direcciones**:
que la ruta declarada exista de verdad, y que lo declarado «sin ruta porque nadie
lo escribe» siga sin escribirse. El día que alguien guarde una exportación, esa
declaración deja de ser cierta y la suite lo dice.

## Un acoplamiento que conviene tener fijado

`DocumentFileController` sólo sirve claves que empiezan por `documents/`
—defensa en profundidad—. `DocumentStore::put()` usa ese prefijo;
`putBytes()` admite otro. Guardar un adjunto con `putBytes(..., prefix: 'otra')`
no daría ningún error y el enlace contestaría 404 sin que nada lo explicara. Lo
descubrió el sembrador de pruebas, que usa `pruebas/…`, y ahora hay un guardián.

## Guardianes

- `tests/Unit/Suite/RetrievableFilesTest.php` — diez comprobaciones sobre el
  inventario, las rutas, el prefijo, el nombre y los dos enlaces.
- `tests/Feature/Messaging/AttachmentDownloadTest.php` — nueve.
- `tests/Feature/Fleet/MediaViewTest.php` — seis.
- `tests/Feature/Documents/DocumentTest.php`, con el nombre de la descarga.

Veinte sabotajes verificados uno a uno.
