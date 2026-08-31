# Salud de la plataforma

`/platform/health`. Qué corre solo, qué está atado a cada interfaz, y qué está a
medias.

## El problema que resuelve

Un cron muerto **no produce ningún error**. Produce silencio — exactamente el
mismo silencio que un día sin documentos por caducar. `routes/console.php` lleva
desde el lote de avisos con este comentario:

> Para que esto corra de verdad en el servidor hace falta UNA línea de cron, que
> Forge añade sola al marcar el planificador. Sin ella este fichero no se
> ejecuta nunca **y no lo dice nadie**.

Eso seguía siendo verdad en producción. Ahora lo dice alguien.

## Cómo se sabe que una tarea corrió

Cada ejecución escribe una fila en `job_queue` con `job_type = 'schedule:<tarea>'`
y `tenant_id` nulo: `started_at`, `completed_at`, el estado y un `payload` con lo
que contó. Si la tarea revienta, queda `failed` con el mensaje **y la excepción
se vuelve a lanzar** — tragarla dejaría una fila que dice «falló» y un comando
que devuelve éxito.

**Un simulacro (`--dry-run`) NO deja rastro.** Si lo dejara, la pantalla diría
que el barrido corrió anoche cuando lo que corrió fue alguien probando desde una
terminal, y el aviso desaparecería justo cuando sigue haciendo falta.

**Por qué `job_queue` y no una tabla nueva.** Sus columnas describen exactamente
esto y su CHECK ya admite `succeeded`/`failed`. Es una tabla de cola y aquí se
escribe trabajo ya hecho, sí — pero un trabajador de cola escribiría estas
mismas columnas al terminar; la única diferencia es que el despachador es el
planificador y no hay fase `queued`. Las filas con el prefijo `schedule:` se
excluyen de los contadores de la cola, porque si contaran, «tareas correctas»
crecería cada mañana y el número dejaría de significar nada.

**La lista de tareas esperadas es explícita** (`HealthController::TAREAS`) y no
se deduce de lo que corrió: una lista deducida dejaría fuera precisamente la
tarea que no corrió nunca, que es la que hay que enseñar.

## Los tres estados de un proveedor

No son dos, porque «real o simulado» no describe todo lo que hay:

| Estado | Qué significa | Ejemplos hoy |
|---|---|---|
| `live` | El proveedor de verdad, configurado | — |
| `mock` | Un sustituto que **no hace lo que dice**: no consulta, no manda | FMCSA, rutas, correo `log`, Stripe, Twilio |
| `fallback` | Funciona de verdad, pero no es lo de producción | Disco local, sello con clave derivada |

La distinción importa. El disco local **guarda ficheros**; el sello con clave
derivada **sella de verdad** y las firmas son verificables. Llamarlos
«simulados» mentiría en la dirección contraria — diría que no hacen su trabajo,
cuando lo que pasa es que no sobreviven a un segundo servidor y a una rotación
de `APP_KEY` respectivamente.

**Se calcula al abrir la pantalla, no se guarda.** La pregunta «¿el FMCSA de
esta instalación es el de verdad?» la contesta el contenedor, que es quien ató
la clase al arrancar. Una tabla con esa respuesta escrita podría decir
«conectado» con la variable de entorno ya quitada.

**Por qué NO se escribe en `integration_connections`.** Esa tabla tiene
`tenant_id` NOT NULL y una columna `credentials_encrypted`: es el almacén de las
integraciones que conecta cada empresa con sus propias credenciales, no el
inventario de lo que la instalación tiene configurado. Meter ahí filas de
plataforma con un tenant inventado habría llenado una tabla a costa de que
dejara de significar lo que significa. Sigue vacía.

## `document_expirations`

Existe desde el primer día con un índice único `(document_id, kind, expiration_date)`
— «un aviso por documento, por tipo y por vencimiento» — y llevaba vacía
mientras el barrido recalculaba lo mismo cada mañana.

Ahora la escribe el barrido, y el índice es quien deduplica (no una comprobación
previa: dos barridos solapados verían los dos que no hay nada).

Se **resuelven** solas dos cosas:

- Al materializar el aviso de una caducidad nueva, los de fechas anteriores del
  mismo documento. Renovar un certificado le da una fecha nueva y el aviso de la
  vieja deja de aplicar en ese instante.
- Los de documentos borrados o a los que se les quitó la caducidad. Se hace al
  principio de cada barrido y no en el borrado del documento, porque el borrado
  puede venir por muchas puertas y ninguna debería tener que acordarse.

**Un defecto que salió al construir esto:** `DemoDataSeeder` escribía en esa
tabla con `kind => 'document'`, que no es ninguno de los dos valores que el
esquema documenta (`warning` / `expired`). O sea que la tabla no estaba del todo
muerta: estaba siendo llenada con un valor que nada iba a reconocer. Se quitó
del sembrador; ahora la llena el barrido, que es quien sabe si un documento está
por vencer o ya venció.

## Lo que hay que hacer en el servidor

En Forge, marcar el planificador en la pestaña Scheduler. O a mano:

```
* * * * * cd /home/forge/goliathdispatch.com && php artisan schedule:run >> /dev/null 2>&1
```

Y poner `SIGNATURE_HASH_PEPPER` (ver `docs/signatures.md`). La pantalla enseña
las dos cosas hasta que estén.

## Lo que falta

- **Los webhooks de Stripe.** El diccionario portado tiene la sección entera
  (`health.webhooksTitle` y sus cifras) y `stripe_events` sigue vacía.
- **El uso de almacenamiento.** `health.storageTitle` está en el diccionario;
  sumar bytes de `document_versions` es fácil, pero medir el disco de verdad
  necesita hablar con el sistema de ficheros o con S3.
- **La pantalla de integraciones por empresa**, que es lo que llenaría
  `integration_connections`.
