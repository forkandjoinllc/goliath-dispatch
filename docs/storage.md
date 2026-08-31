# El almacén de ficheros

Dónde viven los PDF, las fotos y las firmas, y cómo se mantiene sincronizado con
lo que la base de datos dice que existe.

## Lo que arregla

`DocumentStore` **no tenía método de borrar**. Ninguno. Seis sitios suben
ficheros y nada borraba jamás ninguno. El comentario de la interfaz decía por
qué, y la razón era buena:

> Borrar. Los documentos se retienen por política —siete años— y el borrado lo
> decide el trabajo de retención, no una pantalla.

La decisión era correcta y la consecuencia se quedó a medias: **ese trabajo se
construyó en el lote 52 y borraba la FILA, dejando el fichero.** El sistema decía
«purgado» y el PDF seguía en el disco.

Al tirar del hilo salieron tres cosas más, y las tres eran peores que la
primera.

### 1. Nadie tenía la lista de quién guarda ficheros

Siete tablas apuntan al almacén, repartidas por cinco ficheros de DDL:

| Tabla | Columna |
|---|---|
| `document_versions` | `storage_key` |
| `message_attachments` | `storage_key` |
| `equipment_media` | `storage_key` |
| `export_jobs` | `storage_key` |
| `signature_records` | `signature_storage_key` |
| `tenant_branding` | `logo_storage_key`, `logo_dark_storage_key`, `favicon_storage_key` |
| `users` | `avatar_storage_key` |

Sin esa lista no hay forma de contestar «voy a borrar estas filas, ¿qué ficheros
se llevan?». Ahora está en `StoredFiles::COLUMNS` y la comprueba
`tests/Unit/Suite/StoredFilesTest.php` contra el esquema, en las dos
direcciones.

### 2. El borrado en cascada se llevaba ficheros sin que nadie los viera

El peor de los cuatro, y no se ve leyendo el código:

```
documents          ← la purga borra esta fila
  └─ document_versions   ← MySQL la borra en cascada, y aquí vive el fichero
```

La clave del PDF vive en `document_versions`. Al borrar el documento, MySQL se
lleva la versión por su `on delete cascade` **sin que el código pase por ella**,
así que nadie leyó su `storage_key`. Y el resumen decía «ficheros: 0», que
parecía correcto porque la pasada siguiente sobre `document_versions` ya no
encontraba nada.

Pasa en tres sitios: `documents` → `document_versions`, `messages` →
`message_attachments`, `signature_requests` → `signature_records`.

`CascadedFiles` lo resuelve preguntándole a `information_schema` cuáles son esas
cascadas, no con una lista escrita a mano: una lista describe el esquema de hoy y
calla el de mañana, y la cuarta cascada dejaría huérfanos igual, en silencio.

### 3. Un bloqueo legal sobre el hijo no detenía la cascada del padre

El más grave de todos. Un bloqueo sobre `document_versions` marca sus filas y
**no marca los `documents` de los que cuelgan**. La purga miraba el `legal_hold`
del documento, veía cero, lo borraba — y MySQL se llevaba en cascada la versión
que alguien había bloqueado para un pleito.

El bloqueo protegía la fila y no protegía nada.

Ahora, antes de borrar un padre se pregunta si hay debajo algo bloqueado. Es más
conservador de lo estrictamente necesario —salva el documento entero por una sola
versión bloqueada— y esa es la dirección correcta en la que equivocarse.

## El orden del borrado

Las claves primero, la fila después, el fichero al final. No es preferencia, es
la única secuencia que no deja nada roto:

1. **Leer las claves**, incluidas las de todo lo que caerá en cascada. Después
   del DELETE no hay fila que preguntar.
2. **Borrar la fila.**
3. **Borrar el fichero**, y solo si el paso 2 salió bien.

Al revés —fichero primero— un fallo entre las dos dejaría filas apuntando a
ficheros que ya no están. Y eso es peor que un huérfano: un huérfano ocupa disco,
una fila rota es un botón de descargar que da error delante de un cliente.

## Huérfanos y filas rotas

Las dos direcciones de la misma desincronización.

**Fichero sin fila (huérfano).** Aparece solo: alguien sube un documento, el
fichero se guarda, y la transacción que iba a escribir la fila revienta.
`LoadFile::attach()` y `DocumentController::store()` guardan el fichero FUERA de
la transacción a propósito, para no bloquear las tablas mientras sube; el precio
de esa decisión correcta es exactamente este.

Solo cuenta como huérfano el que lleva **más de 24 horas** sin dueño. Un fichero
recién subido cuya fila todavía no se ha escrito no es un huérfano: es una subida
en curso, y borrarla rompería la pantalla de alguien que está mirando. El coste
de esperar un día es un fichero de más; el de no esperar es una subida rota sin
explicación posible.

Una fila **borrada suavemente sigue reclamando su fichero**, a propósito:
mientras alguien pueda restaurarla, el fichero no sobra. Se va cuando la
retención purga la fila.

**Fila sin fichero (rota).** No debería pasar nunca. No se arregla sola —no hay
de dónde sacar el fichero— así que solo se cuenta y se enseña. Lo que hace falta
saber es si el número es cero.

## Dónde se ve, y quién lo ejecuta

El estado del almacén está en `/retention`, junto a la política, porque es la
misma pregunta por el otro lado: la política dice cuánto se conservan los
REGISTROS, y esto dice si sus FICHEROS están donde deberían.

El barrido de huérfanos corre dentro de `retention:sweep`, y borra **detrás del
mismo interruptor** que la purga de registros (`RETENTION_PURGE_ENABLED`). No
tiene uno propio a propósito: son la misma decisión —«esta instalación puede
borrar ficheros para siempre»— y partirla en dos significaría que alguien puede
tener una encendida y la otra apagada sin haber decidido nada.

## Lo que sigue faltando

- **El adaptador de S3.** `LocalDocumentStore` es el único que hay. Su `keys()`
  carga el listado entero en memoria, lo que basta para una máquina y no para un
  bucket grande.
- **`lastModified()` no está en la interfaz.** S3 trae la fecha en el listado y
  no querría una llamada por fichero. `OrphanSweep` la usa si el adaptador la
  tiene y da el fichero por viejo si no.
- **No hay cuota por empresa.** Nada impide que un cliente suba doscientos
  gigabytes.

## Dónde está

| | |
|---|---|
| Interfaz | `app/Support/Storage/DocumentStore.php` |
| Adaptador local | `app/Support/Storage/LocalDocumentStore.php` |
| Inventario | `app/Support/Storage/StoredFiles.php` |
| Cascadas | `app/Support/Storage/CascadedFiles.php` |
| Huérfanos | `app/Support/Storage/OrphanSweep.php` |
| Pruebas | `tests/Feature/Retention/{PurgedFilesTest,OrphanSweepTest}.php`, `tests/Unit/Suite/StoredFilesTest.php` |
