# Pruebas

## Cómo se ejecutan

```bash
composer install                 # con dependencias de desarrollo
DB_DATABASE=goliath_l_test php artisan migrate --force  # la primera vez
composer test                     # o: ./vendor/bin/pest
```

La base de pruebas es **MySQL, no SQLite**. El esquema son quince ficheros de
DDL de MySQL en crudo: columnas generadas STORED, CHECK, triggers con SIGNAL y
claves foráneas compuestas. SQLite no ejecuta nada de eso, así que una suite
sobre SQLite probaría un esquema que no es el que se despliega. Ver
`docs/mysql-port.md`.

Tampoco se usa `RefreshDatabase`. Construir las 99 tablas cuesta unos seis
segundos —246 claves foráneas, 47 triggers, 89 CHECK— y hacerlo por cada clase
convertiría la suite en algo que nadie ejecuta. Se construye una vez por proceso
y cada prueba que escribe se envuelve en `DatabaseTransactions`.

## Estado: la suite entera, en verde

**29 de agosto de 2026**, contra MySQL 8.0.46 real:

```
OK (1254 tests, 7626 assertions)
```

(Cifra del 3 de septiembre, tras el lote de los papeles del permiso.
Los párrafos siguientes describen el estado del 29 por la mañana, que es cuando
la suite pasó de no arrancar a estar entera en verde.)

Se llegó aquí en dos pasos el mismo día. Primero la suite ni siquiera arrancaba
—llevaba varios lotes así sin que se notara— y al conseguir ejecutarla salieron
28 problemas. Al arreglarlos, **la mayoría eran de la aplicación, no de las
pruebas**, y varios de ellos en el dinero.

### Tres fatales que impedían ejecutar NADA

No eran fallos de pruebas: eran errores que mataban el proceso, en algunos casos
sin imprimir un solo mensaje.

1. **Dos funciones auxiliares repetidas.** Pest carga todos los ficheros de
   prueba en el mismo espacio global. `carrierPayload()` estaba en
   `CarrierAccessTest` y en `CarrierContactsTest`; `cargaEntregada()` en
   `InvoiceTest` y en `ExpenseTest`; `driverPayload()` en `DriverAccessTest` y en
   `DriverQualificationTest`. Ejecutar un fichero suelto funcionaba. Ejecutar la
   suite entera era un `Cannot redeclare function` y cero pruebas.

2. **`App\Models\LoadRequirement` no se podía ni autocargar.** Su relación se
   llamaba `load()`, y `Eloquent\Model` ya declara `load($relations)`.
   Redeclararla con otra firma es un fatal al cargar la clase. Cualquier código
   que tocara ese modelo reventaba el proceso — y `SchemaAgreementTest`, que
   recorre los 95 modelos, lo tocaba siempre.

3. **`App\Notifications\UserInvitation` redeclaraba `$locale`.**
   `Illuminate\Notifications\Notification` ya tiene esa propiedad; volver a
   declararla como `readonly` es otro fatal de carga. Bajo Pest, ese fatal mata
   el proceso **sin imprimir nada**: el síntoma era la suite parándose en seco a
   mitad, en silencio.

La lección de los tres es la misma y merece conservarse: **un fichero de pruebas
que pasa en solitario no dice nada sobre la suite**. Estos tres solo aparecen al
ejecutarlo todo junto.

### Los primeros cinco defectos de la aplicación, no de las pruebas

Al contrario que en el arranque de agosto —donde 118 de 119 fallos eran de las
pruebas—, esta vez la mayoría eran del código:

| Dónde | Qué |
|---|---|
| `ExpenseController::decide()` | Comparaba `$model->status` (casteado a enum) con la cadena `'submitted'`. Siempre falso: **aprobar, rechazar y reembolsar fallaban todos**, siempre, con «transición inválida». |
| `ExpenseController::row()` | `(string)` sobre dos columnas casteadas a enum. Un `Error` en ejecución: la pantalla de gastos reventaba en cuanto había un gasto que enseñar. |
| `InvoiceController` (dos sitios) | Lo mismo con `InvoiceStatus`. |
| `UserController` y `AssignmentController` | Leían una columna `carriers.dba_name` que **no existe** — se llama `dba`. Las dos pantallas daban 500. |
| `AssignmentController::store()` | Guardaba `start_date` con la hora actual, y `ActorFactory` compara contra la medianoche de hoy: una asignación hecha por la tarde no concedía nada hasta el día siguiente. |

`(string)` sobre un enum es el patrón que más veces apareció. Hay unos treinta
sitios más con esa forma, pero **casi todos son correctos**: operan sobre filas
de `DB::table()`, que son cadenas de verdad. Solo es un fallo cuando el objeto es
un modelo de Eloquent con esa columna en `casts()`. Cambiarlos en bloque
rompería los otros — y de hecho pasó al intentarlo: `CarrierSettlement` **no**
castea `status` a enum aunque `Invoice` sí. Dos modelos del mismo dominio que no
se parecen tanto como aparentan.

### Y los que salieron al arreglar los 28 restantes

Además de los cinco de la primera pasada (comparaciones de enum en gastos y
facturas, la columna `carriers.dba_name` inexistente y la fecha de inicio de las
asignaciones), la segunda pasada destapó estos, todos reales:

| Dónde | Qué |
|---|---|
| `InvoiceController::send()` | `if ($model->status !== 'draft')` sobre un enum: **siempre cierto**. No se podía enviar ninguna factura, nunca. |
| `InvoiceController::pay()` | `in_array($model->status, [...], true)` sobre un enum: **siempre falso**. Se podían anotar cobros contra una factura en borrador o anulada. |
| `InvoiceController::pay()` | Exigía `invoice:pay`, que solo tiene el rol **transportista**. Ni el administrador ni contabilidad podían registrar un cobro — y el transportista sí podía dar por pagada su propia factura. Ahora exige `payment:record`. |
| `CarrierController` (validación) | `contacts.0.email => required` con índice explícito: Laravel lo exige **aunque `contacts` no venga en la petición**. Quien mandara solo los cuatro campos sueltos recibía un error imposible de contentar. Ahora es `required_with:contacts`. |
| `CarrierController::primaryFromColumns()` | `(string)` sobre `preferred_locale`, casteado a enum. 500 en el alta sin `contacts` — que era el camino que la validación anterior bloqueaba, así que los dos fallos se tapaban mutuamente. |

El resto eran pruebas caducadas: un fixture que insertaba `documents.status`
cuando la columna es `review_status`, otro que olvidaba el `status` obligatorio
del alta de cliente, un `use App\Support\Site` cuando la clase es
`App\Support\Marketing\Site`, dos `base_path()` en una prueba de `tests/Unit`
—que no arranca la aplicación y por tanto no tiene raíz—, un caso de aptitud de
conductor que esperaba «no cumple» cuando lo correcto es «no consta» sin
licencia registrada, y una prueba de duplicados entre empresas que buscaba un
DOT que el propio actor también tenía.

### Dos defectos que solo se ven abriendo el navegador

Se repiten aquí porque los dos pasaron TODAS las pruebas y los encontró abrir la
pantalla:

1. **Cuatro listas paginadas sin paginador.** Facturas, cobros, gastos y
   liquidaciones paginaban de veinticinco o treinta en el servidor y no pintaban
   un solo enlace de página. El servidor contestaba perfectamente a `?page=2`;
   nadie tenía por dónde pedirlo. Lo cubre ahora
   `tests/Unit/Ui/PagerContractTest.php`, que cruza «este método pagina» con
   «esta pantalla pinta el paginador».

2. **Claves de diccionario con punto dentro.** Los valores de `AuditAction` son
   `financial.changed`, `auth.login`… y la pantalla compone la clave:
   `t("audit.action.{$accion}")`. El buscador del cliente parte las claves por
   puntos para bajar por el árbol, así que un diccionario plano
   `{"financial.changed": "…"}` no se encuentra nunca y la tabla pinta la clave
   en crudo. Lo cubre `tests/Unit/I18n/EnumLabelsTest.php`, que busca **igual
   que el cliente**: replicar ahí `lookup()` es deliberado, porque una prueba
   que buscara de otra manera pasaría en verde con diccionarios que el navegador
   no sabe leer.

La regla general que dejan los dos: **una prueba verde no dice que la pantalla
se vea**. Lo que no se renderiza no falla.

### Los diccionarios portados son documentación, y nadie los estaba leyendo

El puerto trajo un diccionario por dominio **en singular** —`document.json`,
`load.json`, `notification.json`, `tracking.json`, `oversize.json`,
`signature.json`…— con el vocabulario completo de la aplicación original en los
dos idiomas. Ningún controlador los declara: la convención de esta casa es que,
al construir un dominio, se escribe uno nuevo **en plural** (`documents.json`,
`loads.json`) con lo que esa pantalla necesita.

Esa convención está bien. Lo que sale caro es no mirar el portado antes de
escribir el nuevo. Al construir los avisos se escribió `notifications.json`
desde cero mientras `notification.json` ya traía el catálogo entero de sucesos,
**incluido `document.expired` como suceso APARTE de `document.expiring`** — que
es justo el matiz que faltaba y que dejó un aviso diciendo «renuévelo antes de
que venza» sobre un documento ya caducado.

Los portados que quedan son, en la práctica, media especificación de los
dominios sin construir: `tracking` trae 191 claves, `oversize` 172, `signature`
161, `finance` 383. **Quien construya esos dominios los lee primero.**

`tests/Unit/I18n/PortedDictionariesTest.php` no impide duplicar —a veces es lo
correcto— sino que lo hace visible: un diccionario nuevo cuyo portado existe
tiene que aparecer en `PORTADOS_REVISADOS` diciendo qué se tomó de él.

### Plurales: la decisión es explícita o la prueba falla

Durante seis lotes se leyó «1 facturas», «1 cargas» y «1 años». La regla, ahora,
es una sola y la aplican las dos mitades —`App\Support\Plural::key()` en PHP y
`t()` en `resources/js/lib/i18n.tsx`—: con `n` igual a 1 se usa la clave hermana
`<clave>One`; con cualquier otro número, el cero incluido, la base.

Se eligió el sufijo y no la barra de Laravel (`una|varias`) porque el
diccionario es JSON compartido entre servidor y cliente, y porque una clave
hermana la ve la prueba de paridad entre idiomas igual que cualquier otra: un
plural sin traducir se detecta solo.

`tests/Unit/I18n/PluralTest.php` obliga a decidir sobre CADA clave con `{n}`: o
tiene hermana singular, o está en `INVARIABLES` con el motivo escrito. Una clave
nueva no puede colarse sin que alguien elija. Además exige que la forma singular
diga algo distinto de la plural —una hermana copiada del plural pasaría la
primera comprobación sin arreglar nada— y que la lista de invariables no
conserve claves que ya no existen.

De paso salieron seis claves de recuento muertas: el paginador compartido las
dejó sin uso y nadie las quitó. Una clave que no se usa no se traduce, no se
revisa y engaña al siguiente que la lee.

### Clases de color sin token: se pintan sin color y nadie avisa

En Tailwind v4 las utilidades de color se generan a partir de las variables del
bloque `@theme`. Una clase que pide un escalón inexistente —`bg-danger-600`
cuando `danger` solo definía 50, 500 y 700— **no se genera**: la clase se queda
en el HTML, el navegador la ignora y el elemento se pinta sin ese color. No hay
error, ni en compilación ni en consola, ni prueba que falle.

Así estuvieron cuatro botones destructivos —rechazar un gasto, anular una
factura, disputar un cobro, anular una liquidación— pidiendo fondo rojo y sin
fondo ninguno: texto blanco sobre blanco. Lo encontró mirar el CSS compilado.

`tests/Unit/Ui/BrandColorsTest.php` lo cierra por los dos lados: toda clase de
una familia de la marca tiene que tener su token, y no se usan las paletas de
Tailwind por defecto —mezclar `amber-100` con `warning-100` deja dos amarillos
casi iguales decididos en dos sitios, y el día que cambie el de la marca solo
cambia la mitad de la interfaz.

### La base de pruebas y las migraciones nuevas

`TestCase::ensureSchema()` **no migra**, y conviene saber por qué antes de
«arreglarlo».

Ese método corre desde `setUp`, es decir DENTRO de la transacción que abre
`DatabaseTransactions`. MySQL hace **commit implícito** en cuanto ve DDL, así que
migrar ahí confirma a mitad la transacción de la primera prueba y sus datos
—una empresa, un cliente, un usuario por rol— quedan grabados en la base para
siempre. Las pruebas siguientes empiezan a contar de más y fallan por sitios que
no tienen nada que ver: pasó al añadir las acciones de auditoría de los
prospectos, y se manifestó como cinco fallos en `CustomerAccessTest`, que no
tenía nada que ver con el lote.

Antes la comprobación era «si hay menos de 90 tablas, migra», que construía el
esquema la primera vez y no volvía a mirar nunca: una migración nueva no llegaba
a la base de pruebas y la suite seguía **en verde contra un esquema viejo**. Los
dos extremos son malos, así que ahora la comprobación se para y dice el comando
que falta:

```
DB_DATABASE=goliath_l_test php artisan migrate --force
```

Si al ejecutar la suite aparece «La base de pruebas no está al día», el mensaje
trae ese comando ya con el nombre de la base que toca.

**`--env=testing` no sirve**, aunque lo pareciera: no hay `.env.testing` en el
repositorio, así que Laravel se queda con `.env` y migra la base de DESARROLLO.
La de pruebas se queda igual de vacía y quien lo ejecutó se queda convencido de
que ya está. El nombre de la base de pruebas vive en `phpunit.xml`, no en un
fichero de entorno, y por eso hay que pasarlo por delante. Y si alguna vez la base de pruebas queda con datos residuales —porque
alguien migró dentro de una transacción—, se limpia borrando las filas; no hace
falta reconstruir el esquema.

### Cómo montar el entorno de ejecución

Packagist está bloqueado en el contenedor donde se escribe este código, pero
GitHub no. Con `composer.lock` delante, `composer install --prefer-source` clona
cada paquete de su repositorio en vez de bajar el zip de la API. La única
excepción es `phpstan/phpstan`, que en el lock **no tiene `source`**, solo
`dist`, y esa descarga sí pasa por `api.github.com`. Para ejecutar Pest no hace
falta, así que se instala sin él (y sin `larastan`, que lo requiere).

Además:

- MySQL necesita `set global log_bin_trust_function_creators = 1` antes de
  migrar, o los triggers `SIGNAL` fallan con `ERROR 1419`.
- `storage/framework/{views,cache,sessions}` y `bootstrap/cache` tienen que
  existir. Si se trae el código sin ellos, toda página Inertia da 500 con
  «Please provide a valid cache path», que no menciona el directorio que falta.
- Para servir la demo hace falta `SESSION_DRIVER=database`: la empresa activa
  vive en la columna `sessions.active_tenant_id`, así que con sesiones en
  fichero se entra bien y todas las pantallas contestan «Sin empresa activa».
- Hay que ejecutar `npm run build` antes de la suite: sin
  `public/build/manifest.json`, toda prueba que renderice una página Inertia da
  500 y la suite parece rota de arriba abajo. Fueron unos 160 fallos de golpe.

### Las 19 migraciones, desde cero

También el 29 de agosto: `php artisan migrate` sobre una base vacía, las
diecinueve en verde, incluidas las dos que tumbaron despliegues en Forge.

### Lo que se comprueba antes de entregar cada lote

| Qué | Cómo |
|---|---|
| Sintaxis PHP | `php -l` sobre cada fichero tocado |
| Tipos de TypeScript | `tsc --noEmit` sobre **todo** el frontend |
| Paridad de diccionarios | EN y ES comparados clave a clave |
| Claves usadas y no traducidas | Extraídas del TSX y del PHP y cruzadas con el diccionario |
| El DDL de cada migración | Ejecutado contra un MySQL 8 real |
| Que la migración se pueda reanudar | Desde cero, sobre lo ya aplicado, y desde estados a medias |
| **La suite** | `./vendor/bin/pest`, entera |

### Lo que la suite verde no ve

Tres de los cuatro fallos del lote de seguimiento los encontró el navegador con
las veintiuna pruebas del módulo ya en verde. Vale la pena nombrarlos porque los
tres son de la misma familia: **la prueba montaba sus propios datos y por eso
nunca pisaba el camino que recorre la aplicación de verdad.**

- **La ciudad de la parada.** La prueba escribía `city` directamente en
  `load_stops`. Las cargas creadas desde el panel guardan `customer_location_id`
  y dejan `city` en NULL: la dirección buena vive en `customer_locations`. Sin
  el `leftJoin`, la página pública —cuyo único trabajo es decir de dónde a dónde
  va la carga— salía sin ciudades. `LoadController::stops()` ya hacía el join
  bien; el módulo nuevo no lo copió.
- **El enlace que no se podía copiar.** El controlador dejaba el token en el
  flash y la pantalla lo leía de la bolsa `flash` compartida, que a propósito
  solo lleva `success` y `error`. Resultado: el panel decía «cópielo ahora, no
  se mostrará de nuevo» y no había nada que copiar. La prueba comprobaba que el
  enlace se creaba, no que llegara a la pantalla. Ahora viaja como prop propia,
  igual que `signupEmail` en `SignupController`, y hay una prueba que mira el
  prop y otra que comprueba que a la recarga siguiente ya no está.
- **«Visto 0 vez/veces».** El plural de barra que la regla del lote anterior
  existe para eliminar. Ninguna prueba mira el texto renderizado.

La conclusión operativa no es «escribir más pruebas»: es que **una prueba que
inserta sus propias filas prueba el controlador, no el sistema.** Cuando el dato
puede llegar por dos caminos, la prueba tiene que usar el que usa la aplicación.

### Lo mismo otra vez, en el lote de firmas

Treinta pruebas en verde y el navegador encontró dos fallos más. Los dos son
otra vez de la misma familia, y ya van tres lotes seguidos:

- **La página de firma no enseñaba el documento.** La bolsa `flash` compartida
  se arma con closures que devuelven `session()->get('success')`, y eso es NULL
  —no ausente— cuando no hay mensaje. La pantalla comprobaba `!== undefined`, que
  con NULL da verdadero: TODO el que abría su enlace veía la pantalla de
  «firmado» con el título vacío, y el acuerdo no aparecía por ninguna parte. Los
  props del servidor eran correctos; la pantalla estaba rota.
- **Tras firmar, el enlace decía «no encontrado».** Se borraba el token al
  firmar, y la redirección posterior caía en el rechazo genérico. El estado
  `already_signed` existía en el diccionario portado desde el principio,
  esperando a que alguien no borrara el token.

Del primero salió la única prueba de este módulo que mira el HTML renderizado y
no los props. Es la lección repetida: **una prueba que comprueba lo que el
servidor manda no comprueba lo que la persona ve.**

Y un tercero, este autoinfligido y contra la propia suite: la primera versión de
la prueba de la cadena de auditoría hacía `drop trigger` para poder borrar un
evento. Eso es DDL, MySQL confirma la transacción abierta al ejecutarlo, y los
datos de esa prueba quedaron escritos para siempre en la base de pruebas —
rompiendo cinco pruebas de `CustomerAccessTest` que no tenían nada que ver. Es
exactamente la trampa que ya está contada más arriba, y la volví a pisar. La
prueba ahora INSERTA un evento con un eslabón que no cuadra, que recorre el
mismo camino de código sin tocar el esquema.

### El fallo que solo aparece a veces

Al reconstruir el entorno de trabajo y volver a pasar la suite, una prueba del
lote de firmas falló — la misma que había pasado cinco veces seguidas el día
anterior. No era una casualidad del entorno: era un fallo de verdad que se
manifestaba según la suerte.

`signature_audit_events.occurred_at` es `datetime(3)`, y dos eventos de la misma
ceremonia caen en el mismo milisegundo con toda facilidad — abrir un enlace
escribe `opened` y `viewed` seguidos. La cadena de hashes buscaba el eslabón
anterior **ordenando por la hora**, y con la hora empatada el desempate era el
UUID, que es aleatorio. Escribir y verificar podían entonces recorrer la cadena
en órdenes distintos, y la verificación fallaba en una firma perfectamente sana
según qué UUID hubiera tocado esa vez.

El arreglo es de fondo: **una cadena de hashes se recorre por sus enlaces, no
ordenando por un campo.** Ahora se busca la cola siguiendo los enlaces
—el evento al que no apunta ningún otro— y se verifica caminando desde la raíz.
De paso detecta dos cosas que el orden por hora no veía: un evento suelto que no
cuelga de la cadena, y una bifurcación con dos eventos apuntando al mismo
anterior.

La prueba que lo fija **congela el reloj** para que todos los eventos compartan
el instante. Comprobado que falla siempre con la implementación vieja: un fallo
que aparece una de cada tantas no vale como prueba de nada.

### Probar el contenido en la capa donde se decide

Dos pruebas de este lote empezaron mirando bytes y acabaron mirando otra cosa,
por el mismo motivo:

- «El PDF no lleva lo que la casa le cobra al cliente» empezó inflando flujos
  zlib del PDF y deshaciendo el escapado de dompdf. Funcionaba a medias, llenaba
  el informe de fallos con cien kilobytes de binario, y se habría roto el día
  que la librería cambiara de compresión. Se partió el renderizador en `html()`
  y `toPdf()`, y la prueba comprueba el HTML — que es donde se decide qué dice
  el documento. Aparte, otra prueba comprueba que lo que se guarda es un PDF.
- «El correo sale en el idioma de la solicitud» empezó con `Mail::fake()` y
  chocó con que `Mail::raw` no registra un Mailable. Se partió el `Mailer` en
  `composeRequest()` y `sendRequest()`, y la prueba comprueba el mensaje
  compuesto. Cómo el doble de pruebas de Laravel registra un envío en crudo es
  un detalle del framework; el idioma del correo es una decisión de este código.

La regla que sale de las dos: **si una prueba tiene que deshacer tres capas de
codificación para llegar al dato, está mirando en la capa equivocada.**

### El ayudante que se llamaba igual, por tercera vez

Escribí `documentoQueCaduca()` en `Feature/Platform/HealthTest.php` sin saber que
`Feature/Notifications/SweepTest.php` ya la tenía. Pest carga todos los ficheros
de prueba en un único espacio global, así que eso no es un fallo de una prueba:
es un `Cannot redeclare function` que impide ejecutar la SUITE ENTERA, y el
mensaje señala los dos ficheros sin decir cuál es el nuevo.

Lo doloroso es que en ese mismo fichero, veinte líneas más arriba, había un
comentario mío advirtiendo exactamente de esto — escrito al copiar a mano
`superAdministrador()` y `entrarComo()` de `PlatformTest.php` para no tomarlas
prestadas. Un ayudante con un nombre natural («un documento que caduca») es
justo el que dos personas escriben igual.

Ahora hay una prueba, `Unit/Suite/HelperCollisionTest.php`, que recorre todos los
ficheros de `tests/`, junta las funciones declaradas en primera columna y falla
si alguna aparece en dos sitios — nombrando la función y los dos ficheros. Un
fallo normal en vez de una suite que no arranca. Comprobado que caza la colisión
real.

### La comparación que nunca puede ser cierta

En el lote de los papeles de la carga apareció el peor defecto encontrado hasta
ahora, y llevaba meses en producción con la suite entera en verde.

La puerta de `pod_received` —el estado con el que se factura una carga— exige un
comprobante de entrega y lo buscaba así:

```php
->where('d.document_type', 'proof_of_delivery')
```

El CHECK de `documents.document_type` **no admite ese valor**. El tipo se llama
`pod`. Ninguna fila podía tenerlo jamás, así que la puerta no era estricta: era
imposible. El estado con el que se cobra era inalcanzable, y no lo notaba nadie
porque tampoco había pantalla para colgar el papel — `load_documents` la
escribía solo el sembrador de demostración.

Un literal que no está en el CHECK no da error de compilación, ni de tipos, ni
de análisis estático. Da algo peor: una comparación que siempre es falsa. Y las
pruebas que tocaban esa puerta escribían el mismo literal equivocado, así que
**confirmaban el error en vez de encontrarlo**.

Lo cubre `tests/Unit/Suite/DocumentTypeCheckTest.php`, que lee el CHECK del DDL
—no una constante de PHP: una constante la escribe la misma mano que escribe el
literal, y las dos se equivocan a la vez— y falla nombrando el literal y el
fichero. Comprobado que caza el fallo real al reintroducirlo. De paso comprueba
que los dos CHECK de tipo de documento —el de `documents` y el de
`load_documents`, que viven en ficheros de esquema distintos— siguen diciendo lo
mismo.

La forma general del defecto: **una comprobación que compara contra un valor que
el esquema no admite parece más estricta de lo que es, cuando en realidad no es
una comprobación en absoluto.** Es la misma familia que la puerta de documentos
que solo miraba vencimientos y por eso dejaba pasar a un transportista con cero
documentos.

### La sexta vez que el navegador encuentra lo que la suite no

Con las dieciséis pruebas del lote en verde, abrir la pantalla enseñó que el
desplegable de «¿de qué parada es este comprobante?» decía **«Parada 1:
recogida» y «Parada 2: entrega»** — dos etiquetas que no dicen dónde, que es lo
único que hace falta saber para elegir.

La causa: una parada puede llevar su dirección escrita en su propia fila o
apuntar a una `customer_locations`. Las cargas reales usan lo segundo, y
entonces `facility_name`, `city` y `state` de la parada están **todas a NULL**.
La consulta leía solo la fila de `load_stops`.

Ninguna prueba lo veía, y por el motivo de siempre: todas montaban las paradas
escribiéndoles la dirección a mano, que es justo el caso que sí funcionaba. La
prueba nueva crea la ubicación del cliente y deja la parada sin dirección
propia — como lo hace la aplicación de verdad. Comprobado que falla con la
consulta vieja.

Es el mismo enunciado que ya está tres veces en este documento, y conviene que
esté una cuarta porque se sigue cumpliendo: **una prueba que inserta sus propias
filas prueba el controlador, no el sistema. Cuando el dato puede llegar por dos
caminos, la prueba tiene que usar el que usa la aplicación.**

Y tirando de ese hilo salió un tercero, en los datos de demostración: dos
clientes tenían una sola ubicación, el sembrador elegía la primera para la
recogida y la última para la entrega —la misma fila—, y **cinco de las once
cargas sembradas recogían y entregaban en la misma dirección**. En un sistema de
despacho eso no es cosmético: es una carga que no existe, en la primera pantalla
que abre quien evalúa la demostración. Lo cubren ahora dos pruebas en
`Feature/Database/DemoSeedTest.php`: ninguna carga con origen igual a destino, y
ninguna parada sin dirección por ninguno de los dos caminos.

### La séptima vez, y esta vez por reimplementar

En el lote de mensajes, con las nueve pruebas de alcance en verde, abrir el
navegador dio un **404 en el hilo que el despachador acababa de crear**.

La causa: un despachador alcanza una carga por DOS caminos —el transportista que
lleva, o ser él mismo el `dispatcher_user_id` de esa carga— y `ScopeFilter` los
une con un OR. `MessageScope` miraba solo el primero, porque lo había escrito de
nuevo en vez de preguntárselo a `LoadScope`.

Y no lo vio ninguna prueba por el motivo de siempre, en su versión más limpia:
**`tests/Support/Scenario.php` asigna el despachador al transportista**, así que
el primer camino tapaba siempre al segundo. En los datos de demostración el
despachador no lleva ningún transportista y llega a sus cargas solo por ser su
despachador — que es la configuración normal de una casa pequeña.

La regla no es «probar también el otro camino». Es la que este proyecto lleva
reaprendiendo desde el lote 44 y que aquí se pisó de frente:

> **Cuando dos sitios contestan la misma pregunta, uno de los dos se equivoca.**

La pregunta era «¿alcanzo esta carga?» y ya tenía dueño. La prueba nueva quita la
asignación de transportista y pone al despachador como dueño de la carga —
comprobado que falla con la consulta vieja.

El navegador encontró un segundo, más difícil de llamar defecto y más fácil de
sufrir: un hilo de carga cuyo transportista está dado de alta pero cuya gente
todavía no tiene cuenta queda **con un solo lado**, sin que nada falle. Despacho
escribe «la cita se mueve a las 14:00» y no lo lee nadie. La única señal era que
la lista de participantes era corta, o sea pedirle a alguien que note una
ausencia. Ahora la pantalla lo dice arriba y en voz alta, y hay dos pruebas.

### El Actor fuera de una petición no es el Actor

Media hora perdida que merece quedar escrita. Estas pruebas empezaron cogiendo el
actor así:

```php
signIn($scenario, Role::Admin);
$actor = app(CurrentActor::class)->require();   // ← no
```

Funciona, no lanza nada, y devuelve un Actor con **`role` y `tenantId` en nulo**:
el Actor vive dentro de una petición y `signIn()` ya terminó la suya. Todo lo que
dependa de esos dos campos se comporta distinto que en la aplicación, y los
fallos que salen no se parecen a la causa — en este caso, filas de participante
que no se escribían y una consulta de hilos que devolvía cero.

Lo correcto es construirlo como lo construye la aplicación:

```php
app(TenantContext::class)->set((string) $scenario->tenant->id);
$actor = app(ActorFactory::class)->for($scenario->user($rol)->fresh(), $tenantId);
```

Con `->fresh()`, además: el modelo que `Scenario` tiene en memoria se construyó
con los atributos del INSERT, y `locale` lo rellena la base de datos.
`ActorFactory` hace `Locale::from()` sobre él y una cadena vacía revienta.

### Las claves con punto, otra vez

`audit.json` guarda las acciones ANIDADAS —`action.load.status_changed`— porque
el buscador del cliente parte las claves por puntos. Al añadir las dos acciones
nuevas del lote las escribí planas (`"message.participant_added": "…"`), que es
exactamente la trampa contada más arriba, y `EnumLabelsTest` la cazó en el mismo
minuto. Es la tercera vez que un guardián escrito en un lote anterior atrapa un
error del siguiente, y la razón de que valga la pena escribirlos.

### Un guardián que caza antes de que exista la función

En el lote de retención escribí primero `Policy::ENTITIES` —la lista de tablas
que el barrido toca— y a continuación el guardián que la comprueba contra el
esquema. El guardián falló **en su primera ejecución**, antes de que existiera
nada que barrer: `load_status_history` estaba en mi lista y no tiene columnas de
retención. Se habría contado como candidata cada domingo y no se habría hecho
nada con ella: un «procesados: 0» eterno que nadie sabría interpretar.

Es la primera vez en este proyecto que un guardián atrapa un error antes que el
código que protege, y merece decirlo porque cambia cuándo conviene escribirlos:
no al final, como red; al principio, como especificación.

El mismo fichero destapó una contradicción del esquema que llevaba ahí desde el
puerto: seis tablas tienen columnas de retención —«puedes purgar esto»— Y un
disparador `before delete` que lanza `SIGNAL` —«no puedes borrar esto jamás»—.
Sin la comprobación, el sitio donde se habría descubierto es un barrido nocturno
reventando a mitad de una transacción, en el cliente que primero acumulara cinco
años de datos.

### El literal que el CHECK no admite, otra vez

`Sweeper` escribía `retention_jobs.status = 'completed'`. El CHECK admite
`queued | running | succeeded | failed | dead_letter | cancelled`. Es
exactamente el mismo tropiezo que el `proof_of_delivery` del lote 50, en un lote
que se abrió citando ese fallo — o sea que conocer la trampa no basta para no
pisarla, y por eso la respuesta correcta nunca es «tener más cuidado» sino otro
guardián. Ahora `PurgeableTablesTest` compara los literales de `'status' =>` de
`Sweeper.php` contra el CHECK del DDL. Comprobado que falla al reintroducirlo.

### Lo que encontró el navegador, dos veces

Con veinticinco pruebas en verde:

1. **`/platform/health` contaba la consecuencia equivocada.** La pantalla tenía
   un solo texto —escrito para `notifications:sweep`— y se lo pintaba a todas las
   tareas. Al añadir `retention:sweep`, le decía a quien mira que sin él no se
   mandan los avisos de documentos que caducan. Un aviso que describe mal lo que
   pasa se corrige tarde, porque quien lo lee busca donde no es. Ahora la
   consecuencia es por tarea, y una prueba obliga a que la siguiente traiga la
   suya en los dos idiomas.

2. **La pantalla de retención decía «el barrido todavía no ha corrido» después
   de que corriera.** Un barrido sin trabajo no escribe filas en `retention_jobs`
   —no hay nada que contar—, así que la lista quedaba vacía y la pantalla
   concluía que no se había ejecutado. Para una empresa nueva ese es el estado
   normal durante dos años: dos años diciéndole que su retención no funciona.
   Ahora se distingue «nunca corrió» de «corrió y no había nada que hacer»
   leyendo la última ejecución de `job_queue`.

Las dos son de la misma familia que todo lo que este documento lleva contando
desde el lote 44, y conviene nombrarla de una vez: **el fallo más caro de esta
aplicación no es que algo no funcione, es que una pantalla afirme algo que no es
verdad.** Un botón roto se nota. Una frase falsa se cree.

### El fallo que ninguna prueba puede ver mirando la base de datos

El lote 53 salió a cerrar un agujero que yo mismo había dejado documentado —la
purga borraba la fila y dejaba el fichero— y al escribir la primera prueba
aparecieron tres más, cada uno peor que el anterior. Merece la pena el orden en
que salieron, porque explica por qué el lote no se pudo hacer «con cuidado»:

1. **La purga no borraba el fichero.** Conocido, documentado, y la razón por la
   que existía el lote.
2. **Al arreglarlo, la prueba siguió fallando.** Borrar un `documents` arrastra
   su `document_versions` por una clave foránea `on delete cascade`, y el
   fichero vive en la HIJA. El código nunca pasaba por esa fila, así que nadie
   leía su `storage_key` — y la pasada siguiente sobre `document_versions` ya no
   encontraba nada, con lo que el resumen decía «ficheros: 0» y parecía bien.
3. **Un bloqueo legal sobre la hija no detenía la cascada de la madre.** El
   bloqueo marcaba las filas de `document_versions` y no las de `documents`; la
   purga veía el `legal_hold` del documento en cero, lo borraba, y MySQL se
   llevaba la versión bloqueada para un pleito. El bloqueo protegía la fila y no
   protegía nada.
4. **El sembrador de demostración escribía filas sin fichero.** Doce de doce.
   Cada documento de la demostración era un botón de «Descargar» que daba error,
   en lo primero que abre quien evalúa el producto.

Los tres últimos comparten algo que conviene nombrar: **no se pueden ver desde la
base de datos.** Las filas eran perfectamente válidas — ese era el problema. Un
`document_versions` con su `storage_key`, su `byte_size` y su `sha256` pasa
cualquier comprobación de integridad que se le haga a la base; lo que falla está
al otro lado, en un disco que ninguna prueba miraba.

De ahí la forma de las pruebas nuevas: todas usan `Storage::fake('local')` y
comprueban **el fichero**, no la fila. La regla que dejan:

> Cuando un dato vive en dos sitios, una prueba que solo mira uno prueba la
> mitad. Y la mitad que se mira siempre es la fácil.

El cuarto lo encontró el barrido nuevo al ejecutarlo contra los datos de
demostración: contó doce filas rotas cuando yo había roto una a mano. Es la
segunda vez en dos lotes que una herramienta escrita para producción encuentra un
fallo en la demostración antes que cualquier persona.

### El simulacro que se llamaba a sí mismo

En el lote del cobro escribí un adaptador simulado que, al «pagar», fabricaba el
suceso, lo firmaba y lo mandaba al webhook con `Http::post(url('/billing/webhook'))`
— exactamente lo que haría el proveedor de verdad. Parecía lo más fiel que se
podía hacer.

Veinte pruebas en verde. Abrí el navegador y el servidor se quedó **treinta
segundos colgado**, dos veces, y devolvió sendos errores.

Una petición que llama por red a su propio servidor espera a un trabajador que
está ocupado siendo ella misma. Con un solo proceso PHP eso es un abrazo mortal,
y no es un problema del servidor de desarrollo: un servidor pequeño en producción
tiene exactamente un proceso libre menos de los que cree.

Lo que no lo vio: **todas las pruebas del webhook llaman a la ruta directamente**
—`$this->post('/billing/webhook', …)`— porque así se prueba el enrutado, la
exención de CSRF y el limitador. Ninguna pasaba por el camino que hace la llamada
anidada. La prueba correcta no era otra prueba del webhook: era abrir el
navegador y pulsar el botón, que es lo que hace un usuario.

El arreglo invoca el controlador del webhook en vez de llamarse por red. Recorre
el mismo camino en todo lo que importa —firma, libro, ciclo— y lo único que deja
de ejercer es el enrutado, que ya lo prueban las otras. Lo fija una prueba que
lee el fichero y comprueba que no hay `Http::`.

Y esa prueba falló a la primera **por su propio comentario**: la explicación de
por qué existe NOMBRA la llamada que ya no está. Un guardián que se dispara con
la explicación de su propia razón de ser es un guardián con falsos positivos, y
uno con falsos positivos se acaba desactivando — así que filtra las líneas de
comentario antes de mirar. Es la segunda vez que un guardián mío tiene ese fallo
(la primera fue en el lote 49) y la regla ya está escrita más arriba.

### Por qué el navegador encuentra algo en CADA lote

Esto lleva desde el lote 44 pasando en todos, y hasta el 55 no supe por qué.
La explicación no es que las pruebas estén mal escritas: es estructural.

**Inertia renderiza en el cliente.** La respuesta del servidor es un `<div>`
vacío y un atributo `data-page` con los props en JSON. El HTML que ve
`$this->get('/loads/x')->getContent()` NO CONTIENE la pantalla: contiene los
datos con los que el navegador la construirá después. Una prueba de PHP puede
comprobar todo lo que el servidor decide y nada de lo que la pantalla hace con
ello.

Lo comprobé a propósito. La carga llevaba este fallo:

```tsx
{blocking.map((b) => <li>{t(`loads.blocking.${b}`)}</li>)}
```

donde `blocking` YA venía traducido del servidor. En la pantalla más usada de la
aplicación se leía, literalmente:

> loads.blocking.No se ha elegido transportista.

Escribí una prueba que pedía la página y buscaba el texto correcto en el HTML.
**Pasó.** Volví a meter el fallo. **Siguió pasando** — porque el texto correcto
está en los props, que es lo único que hay en la respuesta, y la concatenación
ocurre en el navegador. Una prueba que mira el HTML de una página de Inertia
está mirando los props con pasos extra.

De ahí salen dos reglas:

1. **Ninguna prueba de PHP sustituye a abrir la pantalla.** El paso «recorrido
   con navegador en los dos idiomas» de la lista de entrega no es celo: es la
   única capa donde existe la mitad cliente.
2. **Lo que sí se puede fijar es la CONVENCIÓN, leyendo el fichero.**
   `tests/Unit/Ui/TranslatedPropsTest.php` recorre `resources/js` y falla si
   encuentra ``t(`…${algoMessages}`)``: una prop que se llama `…Message` o
   `…Messages` lleva TEXTO y no se pasa por `t()`. Por eso el prop se renombró
   de `blocking` a `blockingMessages` en vez de solo arreglar la línea — el
   nombre viejo no permitía distinguir la clave del mensaje, y en
   `App/Onboarding/Index.tsx` hay un `blocking` que sí son claves y sí se
   traduce en la pantalla. Los dos nombres ahora dicen cuál es cuál.

### Y lo que encontró el navegador ESTE lote

Con las 1.083 en verde, el recorrido de los dos idiomas dio dos cosas más, las
dos de texto y ninguna visible desde PHP:

- **La pantalla de acceso denegado decía lo mismo dos veces.** «Consulte con un
  administrador si cree que debería tenerlo» seguido de «si cree que debería
  tener acceso, escriba a soporte@…». La segunda frase existe justamente porque
  la primera es un consejo sin destinatario, así que ahora es una **o** la otra,
  nunca las dos.
- **Tuteo en una aplicación de usted.** Las dos frases nuevas decían «si crees»
  y «escribe a»; el resto del diccionario español trata de usted de arriba abajo
  («Inténtelo», «Ajuste», «Consulte»). Se ve leyendo la pantalla, no comparando
  claves: la prueba de paridad entre idiomas comprueba que la clave EXISTE en
  los dos, no en qué registro está escrita.

### El guardián que pasó con el fallo puesto, tercera vez

`tests/Unit/Suite/InertSettingsTest.php` —el que comprueba que cada ajuste de
`tenant_settings` que la pantalla deja editar lo lee alguien— pasó a la primera
con los dos ajustes inertes todavía inertes. Otra vez el mismo motivo: buscaba
los nombres de columna en el código y los encontraba **en sus propios
comentarios**, que los nombran para explicar qué hace la prueba.

Van tres (lote 49, lote 54 y este). La regla ya no admite excusa: **un guardián
que busca texto en ficheros filtra los comentarios antes de buscar**, con
`token_get_all()` y `T_COMMENT`/`T_DOC_COMMENT` en PHP, o descartando las líneas
`//` y `*` en TypeScript.

Y la regla hermana, que es la que salvó este lote: **un guardián nuevo se
verifica saboteando**. Se vuelve a meter el fallo que el guardián existe para
cazar y se comprueba que FALLA. Un guardián que nunca se ha visto fallar no es
un guardián: es una prueba que pasa.

### La pantalla que se contradice a sí misma, en dos párrafos seguidos

Lote 56, y otra vez lo encontró el navegador con la suite entera en verde.

La pantalla de plataforma llevaba desde el lote de informes un texto explicando
por qué los topes del plan no se aplicaban:

> «Se enseña, no se impide. Los topes del plan no se han aplicado nunca, y
> empezar a bloquear hoy cambiaría cómo trabajan empresas que ya están por
> encima.»

Era verdad cuando se escribió y era una buena razón — tanto que este lote la
respetó y construyó el bloqueo empresa por empresa en vez de global. Lo que no
hizo fue **releer la frase**. Al abrir la pantalla, ese párrafo estaba dos
centímetros por encima del interruptor nuevo, que decía «Bloqueando desde el 31
de agosto».

Ninguna prueba puede ver esto. Las dos afirmaciones son correctas por separado y
la contradicción solo existe al leerlas juntas, que es lo que hace un ojo y no
hace un `assertSee`. La lección práctica: **cuando un lote cambia una política,
hay que buscar los textos que explicaban la política vieja.** El código que
cambia se ve en el diff; la frase que lo explicaba, no — vive en un JSON de
idioma que el diff no toca.

Y la comprobación barata que lo caza: al abrir cada pantalla que el lote toca,
leer los párrafos de alrededor, no solo lo que se ha añadido.

### Dos pruebas mías que no probaban nada

Del mismo lote, y las cacé releyendo lo que acababa de escribir:

- **`assertRedirect()` a secas sobre un POST rechazado por el tope.** Una
  validación fallida también redirige, así que la prueba pasaba igual con la
  puerta quitada. Ahora afirma el MENSAJE (`assertSessionHas('error', …)`), que
  es lo único que distingue «lo paró el tope» de «lo paró cualquier otra cosa».
- **Una prueba de conteo que recalculaba el conteo.** Comprobaba que
  `Limits::usage()` daba lo mismo que una consulta escrita a mano con la misma
  lógica. Eso no prueba la regla: prueba que sé repetirme. Ahora MUEVE la aguja
  —afilia un chófer y espera que el número no cambie, afilia un despachador y
  espera que suba— que es la única forma de comprobar una regla de conteo.

La regla general de las dos: **una prueba que pasaría igual con el defecto
puesto no es una prueba.** Es el mismo criterio que el sabotaje de guardianes,
aplicado a las pruebas normales.

### La frase que llevaba desde el primer día siendo falsa

Lote 57. El diccionario de equipos decía que una unidad pendiente de verificar
«no se puede poner en una carga hasta que alguien la haya revisado», y el
comentario del controlador lo repetía. La asignación solo rechazaba
`out_of_service`.

Lo que hace este caso distinto de los anteriores no es el defecto: es **dónde
estaba escrito**. No era una pantalla que se hubiera quedado desfasada por un
cambio de política, como en el lote 56 — era una frase que NUNCA fue verdad, y
llevaba ahí desde que se escribió el módulo, respaldada por un comentario en el
código que decía lo mismo. Dos afirmaciones que se apoyaban la una en la otra, y
ninguna de las dos comprobada por nada.

De ahí sale una comprobación barata que no estaba en la lista de entrega:
**leerse los textos del módulo que se toca y preguntarse cuál de ellos comprueba
alguien.** Un `grep` de las frases que prometen un bloqueo —«no se puede», «hasta
que», «impide»— es media hora y encuentra promesas huérfanas.

Y una prueba: `tests/Unit/Suite/EquipmentBlockingTest.php` ata las claves de
`equipment.blocking.*` a las constantes de `Eligibility`, en los dos sentidos. Una
regla sin frase enseña la clave en crudo; **una frase sin regla promete una
puerta que no existe**, que es exactamente lo que había.

### El desplegable que no decía lo mismo que la puerta

Del mismo lote y probablemente lo más reutilizable que ha salido de él.

Cuando una regla decide si algo se puede hacer, hay casi siempre DOS sitios que
la consultan: el que impide (la puerta) y el que anticipa (la lista, el botón
deshabilitado, el aviso). Si cada uno la implementa por su cuenta, divergen — y
la divergencia siempre cae del mismo lado: la lista es más permisiva que la
puerta, porque la lista se escribió antes. El usuario elige una opción que
parecía válida, pulsa, y recibe un error que nada anticipaba.

Aquí el desplegable de asignación marcaba en regla unidades que la puerta iba a
rechazar. La solución no es sincronizar las dos listas: es que **haya una sola
regla y los dos la llamen**, y una prueba que compruebe que la llaman —
`EquipmentBlockingTest` lo hace leyendo los tres ficheros, con los comentarios
filtrados.

### Y lo que encontró el navegador, dos veces más

Con las 1.115 en verde:

- **«El certificado está vencido» cuando no lo estaba.** El código distinguía dos
  casos —hay papel o no lo hay— y la empresa de demostración tenía el tercero: un
  certificado subido y pendiente de revisión. Se anunciaba como vencido, y eso
  manda a quien lo lee a pedirle a un transportista un documento que ya había
  mandado. Ahora son tres casos, que son tres llamadas de teléfono distintas.
- **«Verificada contra el certificado del …» debajo de «Sin verificar».** Reusar
  una frase de un estado en otro: la etiqueta del enlace decía el nombre de la
  sección en vez del nombre del documento, y la fecha de vencimiento de la póliza
  se presentaba con el texto de una verificación ya hecha. Dos líneas seguidas
  contradiciéndose, como en el lote anterior. Se ve leyendo la pantalla; no se ve
  de ninguna otra forma.

### El barrido de promesas, y lo que sacó a la primera

En el lote anterior escribí aquí que convenía **buscar en el diccionario las
frases que prometen un bloqueo** —«no se puede», «hasta que», «impide»— y
preguntarse cuál de ellas comprueba alguien. Lo hice al empezar el lote 58 y
tardó menos de un minuto:

> «El rastreo no puede iniciarse hasta que el conductor otorgue su
> consentimiento, y se detiene de inmediato si el consentimiento se retira.»

Cero puerta, cero registro, cero forma de retirarlo — sobre la ubicación en vivo
de una persona, enseñada a terceros por un enlace público. El `grep` de frases
prometedoras es la comprobación más barata de todas las que ha dado esta serie de
lotes: **hazla al principio del lote, no al final.**

### Una columna que existe no es una columna que se mantiene

El defecto de este lote que no vi venir, y que habría dejado la puerta cerrada
para todo el mundo sin que nadie entendiera por qué.

Un conductor se enlaza con su cuenta de acceso por DOS caminos en este esquema:
`drivers.user_id` y `user_tenant_memberships.driver_id`. Los dos existen, los dos
están rellenos en el sembrador, y **solo el segundo lo mantiene la aplicación**:
es el que rellena la invitación y el que lee `ActorFactory`. El primero lo escribe
el sembrador y nadie más.

Escribí la puerta contra `drivers.user_id` porque estaba ahí y porque en la base
de demostración funcionaba. Lo cacé al mirar cómo lo resuelve el resto del código,
no con una prueba — el escenario de pruebas también enlaza por afiliación, así
que ninguna prueba habría fallado, y en producción todo conductor invitado por el
camino normal habría quedado sin poder consentir.

La regla: **cuando dos columnas dicen lo mismo, averigua cuál escribe la
aplicación antes de leer ninguna de las dos.** Y de paso salió gratis otra frase
falsa: `hasLogin` se calculaba con la columna muerta, así que un conductor con
cuenta salía en pantalla como «sin cuenta de acceso».

### La promesa que no se le hace al usuario

Lote 59, y el barrido de promesas otra vez — esta vez sobre `marketing.json`, que
en los cuatro lotes anteriores no había mirado.

> «Una vez despachada su carga, recibirá un enlace seguro por correo
> electrónico.»

Repetida en cinco sitios, y falsa. `recipient_email` se pedía en el formulario,
se guardaba y no lo leía nadie.

Lo que aprendí y no había visto: **los diccionarios del sitio público son
promesas igual que los de la aplicación, y son peores cuando fallan.** Una frase
falsa dentro de la aplicación la sufre un usuario que puede quejarse y a quien se
le puede explicar. Una frase falsa en la página de ventas la sufre el cliente de
nuestro cliente, que no tiene cuenta, no se queja con nosotros, y deja mal a la
casa de despacho que nos pagó.

Así que el barrido de promesas incluye `lang/*/marketing.json` desde ahora, y el
guardián `TrackingLinkPromiseTest` comprueba además que la frase **siga estando**:
si alguien la reescribe, hay que volver a mirar si la puerta que la cumple sigue
cumpliendo lo que dice ahora.

### Cambiar una firma barata: `issue()` devolvía un token y ahora devuelve dos cosas

Nota práctica, por si vuelve a pasar. Para anotar que el correo salió hacía falta
el id del enlace, y `TrackingLinks::issue()` solo devolvía el token en claro. Se
podía haber añadido un método nuevo al lado; se cambió la firma para que devuelva
`{id, token}`, con dos llamadas en todo el proyecto.

El coste real fue una línea en un ayudante de pruebas. **Un método con dos
variantes casi iguales cuesta más para siempre que arreglar dos llamadas hoy**, y
la variante de más es donde acaba el fallo del que llama a la equivocada.

### Un guardián que caza dentro del mismo lote

Lote 60, y la primera vez que pasa: al meter `insufficientMedia` en
`Eligibility`, el guardián `EquipmentBlockingTest` —escrito en el lote 57— falló
en el acto porque faltaba la frase del diccionario en los dos idiomas.

Es exactamente para lo que existía, y merece la pena anotarlo porque cambia el
cálculo de escribir guardianes: **el que escribí para que un fallo no volviera
dentro de seis meses me ahorró el mismo fallo dentro de seis minutos.** El coste
de un guardián se recupera antes de lo que parece cuando se escribe.

### Cuando el escenario de pruebas tiene que envejecer con las reglas

Al exigir cuatro fotos, veintiuna pruebas que no tienen nada que ver con fotos se
cayeron: todas las que asignan un camión. La tentación es parchear cada una; lo
correcto fue meter las cuatro fotos en `Scenario::crew()`, que es el método cuyo
trabajo es «esta carga tiene un camión y un conductor QUE PUEDEN TRABAJAR».

La regla: **cuando una puerta nueva rompe muchas pruebas ajenas, casi siempre lo
que hay que actualizar es el escenario, no las pruebas.** Un escenario que monta
una unidad que no puede trabajar no sirve para probar nada más que la propia
puerta — y si el escenario no puede cumplir la regla nueva, esa es una señal
sobre la regla, no sobre el escenario.

Efecto secundario útil: la caída dijo de una vez dónde estaban TODOS los sitios
que dependen de que un camión pueda asignarse.

### El tercer sitio donde estaba copiada la misma escritura

`fmcsa_verifications` se escribía en tres sitios —el alta, el botón de verificar y
(nuevo) el barrido—. Los dos que ya existían habían divergido sin que nadie lo
notara: uno contaba el intento con `count()+1` y el otro con `max(attempt)+1`, y
los dos programaban la siguiente comprobación «dentro de un año» mientras el
barrido daba por caducado a los siete días.

Nadie lo habría visto leyendo un solo fichero. Se vio al ir a escribir el
TERCERO, que es cuando uno compara los dos anteriores. Vale la pena escribirlo
como señal: **si estás a punto de copiar una escritura por segunda vez, ese es el
momento de moverla; si es la tercera, ve primero a comparar las dos que ya
existen — habrán divergido.**

### El ajuste que se guarda y no se ve: casi lo repito yo

Lote 61. Añadí dos colores editables —principal y de acento—, los validé, los
guardé, los pasé a la página pública como variables CSS… y solo pinté el
principal. El de acento se guardaba, se validaba, se previsualizaba en el propio
formulario, y no aparecía en ninguna parte de la página que ve el cliente.

Es exactamente el defecto del lote 55 —un ajuste que se edita y no lee nadie—
introducido por mí, seis lotes después de dedicar uno entero a quitarlo. **Lo vi
mirando la captura del navegador, no leyendo el código**: el código parecía
correcto porque la variable estaba puesta; lo que faltaba era que alguien la
usara.

La regla práctica que saco: **cuando un lote añade un ajuste, la comprobación no
es «¿se guarda?» sino «¿dónde lo veo?»** — y hay que poder señalarlo con el dedo
en una captura. Una previsualización del propio ajuste no cuenta: es el ajuste
mirándose al espejo.

### Un nombre de columna no es una especificación

`tenant_branding` tiene `email_header_html` y `email_footer_html`. El nombre
invita a guardar HTML. Guardarlo habría sido regalar un vector de suplantación:
ese texto lo escribe un cliente nuestro y lo lee un tercero que no nos conoce, y
un bloque con formato es exactamente lo que usa quien suplanta.

Se guarda texto, se escapa al leer, y el guardián lo fija — porque es la clase de
decisión que alguien deshace dentro de seis meses «para que se vea mejor», y el
nombre de la columna estará ahí dándole la razón.

Vale como regla general: **el esquema portado propone, no obliga.** Ya había
pasado con `media_count` (se cuenta desde la tabla, no del contador cacheado) y
con `integration_connections` (no se rellena con filas de plataforma). Cuando el
nombre de una columna y la decisión correcta no coinciden, gana la decisión y se
escribe por qué.

### Probar el camino del fallo ANTES que el del éxito

Lote 62, y la mejor decisión de recorrido que he tomado en toda la serie — casi
por casualidad.

El guion del navegador probaba primero el pago RECHAZADO y luego el aceptado. El
rechazo funcionó; el pago posterior no hizo nada. La causa: la clave de
idempotencia estaba atada a la factura y al importe, así que el segundo intento
chocaba contra el primero. Es decir: **un pago rechazado dejaba la factura
impagable para siempre.**

Con el orden inverso —pagar primero— el recorrido habría salido verde y el
defecto habría llegado a producción, donde se manifiesta como «un cliente no
puede pagarnos y no sabemos por qué».

La regla: **en cualquier flujo con dos desenlaces, recorre primero el malo.** El
bueno casi siempre está probado; el malo es el que nadie mira, y además deja al
sistema en el estado desde el que se descubre lo que falta.

### Una ruta pública debajo de un prefijo autenticado se queda tapada sin decir nada

`pay/mock` se llamó primero `invoices/mock-pay`. `auth.php` registra
`invoices/{invoice}` y se carga ANTES, así que la ruta pública la capturaba
aquella —con su middleware de sesión— y el transportista acababa en la pantalla
de acceso.

Lo delator fue que la petición SIN FIRMA devolvía 302 a /login en vez de 403: la
ruta que contestaba no era la mía. **Cuando una ruta nueva se comporta como si
tuviera un middleware que no le puse, la pregunta no es qué middleware sobra sino
qué otra ruta la está capturando** — `route:list` con la ruta exacta lo dice en
un segundo.

## Migraciones: por qué todas son reanudables

MySQL no tiene DDL transaccional, y Laravel manda **un `alter table` por
columna**. Una migración que muera a mitad deja media tabla puesta y **no se
registra** en `migrations`: al reintentarla se estrella contra lo que ya está
(`ERROR 1060 Duplicate column`).

Pasó dos veces en despliegues reales, en agosto de 2026. La primera se arregló
como caso particular; la segunda obligó a sacar la regla:

> Toda migración comprueba, paso a paso, si lo que va a hacer ya está hecho —
> columnas con `Schema::hasColumn`, CHECK y claves foráneas contra
> `information_schema.table_constraints`, índices contra
> `information_schema.statistics`.

Ejecutar una dos veces seguidas tiene que dar el mismo resultado que ejecutarla
una. `down()` va igual de protegido.

Y una restricción de MySQL que costó un despliegue entero, por si vuelve a
aparecer:

> Una clave foránea con `ON DELETE CASCADE` **no puede** estar sobre una columna
> que sea base de una columna generada **STORED**.

El esquema emula índices únicos parciales con columnas generadas STORED por todas
partes, así que el choque es fácil de provocar. La salida es que la columna
generada no dependa de la columna de la clave foránea: se mete esa columna en el
ÍNDICE, que no está sujeto a la restricción. Ver
`2026_08_28_100000_create_carrier_contacts.php`.

## Cómo están organizadas

- **`tests/Unit`** — sin base de datos y sin arrancar la aplicación. La
  autorización vive aquí a propósito: `can()` es una función pura del Actor, y si
  algún día necesitara la base de datos para responder, eso es el fallo que hay
  que ver. La excepción es `Unit/I18n`, que necesita `lang_path()` y por tanto la
  aplicación, pero sigue sin tocar la base de datos.
- **`tests/Feature`** — la aplicación entera, por HTTP.
- **`tests/Support/Scenario.php`** — monta una empresa con un usuario por rol,
  dos transportistas y un cliente, con el despachador asignado a **uno solo** de
  los transportistas. Que no los lleve todos es el punto: un escenario donde el
  despachador ve todo no distingue «el ámbito `assigned` funciona» de «el ámbito
  `assigned` no hace nada».

## `signIn()`

Se hace un POST real a `/login`, no `actingAs()`. No es purismo: la empresa
activa de la sesión la fija `App\Http\Responses\LoginResponse` al final del
pipeline de acceso. Con `actingAs()` habría usuario pero `active_tenant_id`
quedaría en NULL, `ResolveTenant` no encontraría empresa y todas las pruebas
fallarían por un motivo que no tiene nada que ver con lo que prueban.

Cada llamada usa una IP distinta del rango TEST-NET-1 (RFC 5737). El limitador
de accesos permite 20 por minuto y por IP: un fichero con veinticinco pruebas
empezaría a recibir 429 a partir de la vigésima, y el fallo parecería un
problema de autorización cuando sería el limitador haciendo su trabajo.

## Lecciones del lote de las posiciones (63)

### `insertOrIgnore` se traga MUCHO más que un duplicado

Degrada a aviso **todos** los errores del INSERT: una columna que no admite
nulos, un CHECK que no se cumple, un tipo que no cabe. Los tres se ven
exactamente igual que el choque contra el índice único, que es el que se
buscaba.

Se descubrió con el navegador. La llegada a la parada se guardaba, la pantalla
decía «Anotado.», y la línea de tiempo se quedaba vacía: a la base de datos de
desarrollo le faltaba una migración de este mismo lote y `session_id` seguía
siendo NOT NULL. Ninguna prueba lo habría visto —en la base de pruebas la
migración sí estaba—, y en producción habría sido un botón que dice que anotó lo
que no anotó.

La regla que queda: **si `insertOrIgnore` devuelve cero, hay que comprobar por el
índice único que la fila esté.** Si no está, la escritura falló y hay que gritar.
Una consulta más solo en ese camino.

### Probar el camino nuevo con datos del demo, no solo del escenario

`StopProgress` leía `load_stops.city` y el lugar del suceso salía en blanco. No
era un descuido: una parada puede apuntar a una ficha de `customer_locations` en
vez de llevar la dirección escrita a mano, y entonces la columna suelta está
vacía. `LoadController` y el panel de rastreo ya hacían el `leftJoin`; el código
nuevo no.

Las pruebas pasaban porque `Scenario` escribe ciudad y estado a mano en las
paradas. **El escenario de pruebas es un caso, no el caso**: el demo usa
ubicaciones, y los clientes de verdad también.

### Una herramienta de desarrollo que existe en producción no lo es

El botón de simular movimiento se cerró primero con `instanceof
StopDerivedTrackingProvider`, que parecía suficiente. No lo era: mientras no
exista un adaptador de GPS real, **ese es el proveedor atado también en
producción**. Cualquier administrador habría tenido en su servidor de verdad un
botón que mete sucesos inventados en la línea de tiempo que su cliente está
mirando por un enlace.

La condición del entorno hacía falta además de la del proveedor. Y el texto de
ayuda tuvo que decirlo: prometía «solo mientras el proveedor simulado esté
activo», que después de la segunda puerta ya no era toda la verdad.

### Probar el flip de entorno rompe la sesión del cliente de pruebas

`app()->detectEnvironment(fn () => 'production')` a mitad de una prueba deja la
petición siguiente sin sesión, y el fallo sale como «se esperaba un mensaje y
llegó null», que no se parece en nada a la causa.

Lo que sí funciona: sustituir la atadura del contenedor por un proveedor que dice
ser de verdad —eso prueba la mitad del `instanceof` de forma limpia— y dejar la
condición del entorno a un guardián que la busca en el código. Dos pruebas
pequeñas y honestas en vez de una grande y frágil.

### El resumen se calcula sobre lo que se sabe, no sobre lo que trajo la sesión

El panel decía «aún no se ha reportado ninguna posición» justo encima de una
línea de tiempo que enseñaba la llegada al origen. Pasa siempre que se anota algo
**antes** de abrir la sesión, que es el orden normal.

Dos pantallas contiguas que se contradicen son peores que una vacía: la vacía se
entiende. Es la tercera vez que aparece este defecto (lotes 56, 61 y este).

### Un suceso no es una posición

Contar «rastreo iniciado» para la salud de la sesión la ponía en «saludable» sin
que nadie hubiera dicho dónde estaba el camión, y dejaba una hora colgando debajo
de «aún no se ha reportado ninguna posición». La salud mide el tiempo desde la
última **posición**, que es lo que quiere decir «señal perdida».

### Una fracción honesta dentro de una frase falsa

El avance se calculaba bien —paradas hechas sobre paradas totales— y se enseñaba
como «50 % del recorrido completado». Con el camión recién llegado a la recogida,
el recorrido no ha empezado: la cifra era cierta y la frase no. Se cambió a «1 de
2 paradas hechas», que es exactamente lo que se sabe.

Conviene releer la frase que envuelve un número, no solo comprobar el número.

### El botón que la puerta va a rechazar

La pantalla ofrecía «Anotar llegada» en las dos paradas, y el servidor rechaza la
segunda mientras la primera no esté anotada. Es la misma lección del desplegable
que no coincidía con la puerta de asignación (lote 57), y volvió a encontrarla el
navegador.

## Lecciones del lote de la voz del cliente (64)

### Un mensaje de fallo dentro de un matcher variádico anula la aserción

`expect($x)->not->toContain('billing', 'mensaje de fallo…')` **no** hace lo que
parece. `toContain` es variádico: el mensaje se toma por una segunda aguja, y la
negación pasa a ser «no contiene AMBAS». Como el mensaje nunca está en el texto,
la aserción es cierta siempre.

La prueba estaba en verde con el defecto puesto. Lo descubrió el sabotaje, que es
justo para lo que existe: **una prueba que no se ha visto fallar no se ha
visto**. Donde haga falta un mensaje, `expect(str_contains(...))->toBeFalse('…')`.

### `Mail::fake()` no ve un correo mandado con `Mail::raw()`

Solo registra Mailables. Para un envío en crudo hay que escuchar el suceso
`MessageSending`, que sí se dispara — y entonces **no** se puede llamar a
`Mail::fake()`, porque el falso no manda nada y el suceso no llega a existir. En
pruebas el transporte ya es `array`, así que no hace falta falsear nada.

Y el cuerpo se lee con `getTextBody()`: `getBody()` devuelve una parte MIME, y un
`(string)` sobre ella es un error en ejecución.

### `(string)` sobre una columna casteada a enum es un 500

`$carga->status` viene de un modelo y está casteado a `LoadStatus`. Un `(string)`
encima no es una conversión torpe: es un `Error` de PHP, o sea una pantalla en
blanco. Se usa `EnumValue::of()`.

Esta vez lo cazó la suite —cuatro pruebas de rastreo se pusieron rojas de golpe
por un 500— y no el navegador, que es la excepción agradable de las últimas diez
entregas. El mismo caso está documentado desde hace lotes en
`CarrierController::primaryFromColumns`, y aun así volvió a pasar: una trampa
documentada sigue siendo una trampa.

### Cambiar el tipo de retorno rompe las pruebas que lo asumían, y está bien

`CustomerLink::sendForLoad()` pasó de `bool` a devolver el motivo. La prueba que
decía `->toBeTrue()` se puso roja inmediatamente, y ese fallo es la señal
correcta: alguien tiene que releer qué esperaba. Es lo contrario del cambio que
se cuela porque el tipo seguía encajando.

### El escenario de pruebas es un caso, no el caso

Van dos lotes seguidos con esto. En el 63, `Scenario` escribe ciudad y estado a
mano en las paradas, y el código nuevo leía solo esa columna: en el demo —que usa
ubicaciones del cliente— el lugar salía en blanco. En el 64, `Scenario` crea
clientes sin contactos, que era exactamente el estado que el lote venía a
arreglar.

Cuando un lote cambia de dónde sale un dato, hay que sembrar el caso nuevo en el
demo y mirarlo con el navegador. La suite verde solo dice que el caso viejo sigue
funcionando.

## Lecciones del lote de los sitios (65)

### Una aserción por `grep` puede pasar por el motivo equivocado

La prueba del formulario de carga buscaba `customer_location_id` a secas. El
sabotaje —quitar la línea que RELLENA el campo— la dejó en verde, porque el
nombre sigue apareciendo en la interfaz del borrador y en los `disabled`.

Segunda vez en dos lotes que el sabotaje encuentra una prueba que pasa por el
motivo equivocado (la anterior fue el mensaje dentro de un matcher variádico).
La regla que queda: **buscar la línea que hace el trabajo, no la palabra que la
nombra** — `customer_location_id: sitio.id`, no `customer_location_id`.

### La mitad del defecto que está en el servidor es la fácil de ver

`load_stops.customer_location_id` se validaba y se guardaba desde el primer día,
y ocho lectores lo leían. Leyendo solo el servidor, la función parecía completa.
El que no lo mandaba nunca era el formulario, porque el campo no existía.

Cuando una columna sale null en producción y el código del servidor parece
correcto, hay que ir a mirar quién la ENVÍA. Es la misma forma del defecto del
lote 63 (`actual_arrival_at` se leía en tres pantallas y nadie la escribía), con
el agravante de que aquí sí había código de escritura: le faltaba el remitente.

### Una clave foránea que llega del navegador es una frontera

`customer_location_id` se validaba como «una cadena de 36 caracteres». Ocho
lectores hacen `leftJoin` con `customer_locations`, así que ese identificador
—elegido por el navegador— podía traer a la pantalla el nombre y la dirección de
la instalación de otro cliente, o de otra empresa, incluido el papel que firma el
transportista.

Una regla de forma (`size:36`, `uuid`) no es una validación de una clave foránea.
Lo que hay que comprobar es de quién es la fila.

### Índices que existen en una tabla y no en su hermana

`customer_contacts` tiene índice único sobre el principal; `customer_locations`
no. Dos tablas que se editan igual, se pintan igual y se sincronizan con el mismo
código, y una de las dos no tiene red debajo.

Antes de apoyarse en «la base no lo admitiría», conviene mirar el esquema de esa
tabla concreta.

## Lecciones del lote del recibo (66)

### Una puerta silenciosa se vive como un botón roto

La puerta del recibo funcionaba: el gasto no se aprobaba. Pero la lista de
gastos no pintaba ningún error, así que al pulsar «Aprobar» no pasaba
absolutamente nada visible. La suite estaba en verde —el estado seguía en
`submitted`, que es lo que comprueba— y la pantalla era inutilizable.

Lo encontró el navegador, otra vez. **Una puerta nueva necesita dos cosas: que
cierre y que se sepa por qué.** Vale la pena buscar dónde se pinta el error
ANTES de dar la puerta por hecha.

### El aviso que se contradice con la tarjeta que lo rodea

«Esta categoría exige recibo. Sin él no se puede aprobar el gasto» salía también
sobre gastos ya aprobados —los que la migración retrollenó—, dos líneas debajo
de la palabra «Aprobado».

Tercera o cuarta vez que aparece este defecto. La regla que va quedando: un texto
en futuro o en condicional tiene que mirar el estado, porque la misma frase es
verdad antes de una decisión y mentira después.

### Cuando una puerta nueva rompe pruebas ajenas, se arregla el AYUDANTE

Tres pruebas de finanzas se pusieron rojas: daban de alta gastos de combustible
—categoría que exige recibo— y los aprobaban. Lo que comprueban es que un gasto
aprobado mueve el dinero, no cómo llegó a aprobarse.

Se arregló el ayudante `gasto()` para que adjunte el recibo cuando la categoría
lo exige. Igual que en el lote 60, cuando exigir cuatro fotos al equipo rompió
veintiuna pruebas: **el escenario tiene que producir cosas que pueden trabajar.**

### El demo también tiene que enseñar el caso nuevo

El sembrador insertaba gastos sin la copia congelada, así que la primera pasada
del recorrido no enseñó nada: ni insignia, ni aviso, ni recibo. Se sembró la
copia y se dejó UNO a propósito sin recibo, para que la pantalla enseñe los dos
estados.

Van tres lotes seguidos con esto. Cuando un lote añade una columna que decide
algo, hay que sembrarla — y sembrar los dos lados, o el demo no distingue
«funciona» de «no mira nada».

## Lecciones del lote de los papeles (67)

### Dos pasadas del recorrido no son dos pruebas independientes

La puerta parecía no cerrar en el navegador: se pulsaba «aprobar» y la carga
quedaba aprobada aunque el permiso no tuviera papel. La puerta estaba bien. Lo
que pasaba es que la **primera** pasada del recorrido había subido el papel al
final, así que la segunda encontró el permiso ya completo.

Un recorrido que modifica datos deja el mundo distinto para el siguiente. Si una
pasada tiene que comprobar un estado concreto, hay que **reponer ese estado
antes**, no confiar en que sigue como al empezar.

### Sembrar datos a mano puede inventar valores que la base acepta

Para el recorrido inserté una escolta de tipo `lead`, que no existe: los tipos
válidos son `pilot_car`, `police`, `height_pole` y `route_survey`. La pantalla
enseñó `oversize.escorts.type.lead` en crudo y por un momento pareció una clave
de traducción que faltaba.

No lo era: era **mi dato**. Pero destapó algo real — `escorts.escort_type` no
tiene restricción en el esquema, así que cualquier vía de escritura que no sea
el controlador puede meter un tipo inventado. Lista cerrada en el código,
abierta en la base. Segunda vez en tres lotes que aparece esa asimetría.

### La tercera copia es la que obliga a extraer

`LoadFile` y `ExpenseFile` escribían el mismo documento con su versión; los
papeles del permiso iban a ser la tercera. La regla de la casa —comparar las dos
que existen antes de copiar la tercera— llevó a `Attachment`, y comparándolas se
vio que la parte común era mayor de lo que parecía y la distinta más pequeña:
solo **a qué se cuelga** el documento.

Extraerlo con la suite delante costó minutos y dejó un guardián que impide que
vuelvan a divergir.

## Qué falta

- Pint y Larastan (nivel 6) están en `composer.json` pero tampoco se han podido
  ejecutar en este entorno. `composer lint` y `composer stan`.
- No hay pruebas de las pantallas en React. La verificación de la interfaz ha
  sido con navegador a mano.
- `tests/Support/Scenario.php` vive bajo el espacio `Tests\`, que está en
  `autoload-dev`. Con las dependencias de desarrollo ausentes no se autocarga;
  con `composer install` completo, se resuelve solo.
- No hay pruebas del adaptador REAL de FMCSA contra el servicio de verdad.
  `QcMobileDirectory` se prueba con `Http::fake()`, lo que demuestra el mapeo de
  la respuesta, **no** el contrato del proveedor. La primera consulta con clave
  de verdad puede exigir ajustar nombres de campo.

## Lote 68 — la carga que dice facturada

**Un comentario puede ser la denuncia del código que tiene debajo.** La
declaración de `invoiced` en `Transitions::GRAPH` llevaba encima un comentario
que decía que facturar «lo hace el dominio de finanzas al emitir la factura».
No lo hacía. Cuando un comentario y su línea se contradicen, el comentario
suele ser la intención original y la línea, la deuda. Merece la pena leer los
comentarios buscando esa contradicción: es un barrido nuevo y dio dos defectos
en un solo fichero.

**La mitad de una regla extraída es la mitad de una regla copiada.**
`InvoiceController` explicaba en un comentario por qué la mitad «¿ya está
facturada?» vivía en `Billable` —dos copias se separan— mientras la otra mitad,
«¿qué estados son facturables?», estaba copiada como el literal `'delivered'`
en cinco consultas. Extraer una regla a medias deja el problema y además la
sensación de haberlo resuelto.

**Un estado alcanzable de más rompe consultas que nadie tocó.** En cuanto
facturar movió la carga sola, todas las consultas que preguntaban «¿está
entregada?» comparando contra `'delivered'` empezaron a perder cargas de vista.
La primera en caer habría sido la de liquidaciones: dinero que se le debe al
transportista y deja de verse. Antes de hacer alcanzable un estado nuevo, hay
que barrer quién compara contra los viejos.

**El sembrador es una prueba.** La primera versión de `alFacturar()` solo
avanzaba desde `pod_received`; parecía razonable hasta que corrió el sembrador
y dejó tres cargas entregadas dentro de una factura de verdad diciendo
«Entregada». La misma contradicción que el lote quitaba, vista desde el otro
lado. Ninguna prueba unitaria lo habría enseñado tan rápido como sembrar.

**Una vuelta atrás no debe llevar el destino escrito.** Anular una factura
devuelve la carga al estado del que salió, y ese estado es dato, no constante:
se lee del historial. Un destino fijo habría inventado un comprobante de
entrega que nunca llegó, en la única tabla a la que la gente acude cuando ya no
se fía de las demás.

**`toContain` sigue siendo variádico.** Segunda vez, después del lote 64. El
mensaje de fallo se convirtió en una segunda aguja y la aserción pasaba siempre.
La forma segura sigue siendo `expect(in_array(...))->toBeTrue('mensaje')`.

**Una prueba que espera un 404 lo consigue escribiendo mal la ruta.** Dos
pruebas afirmaban que la transición «facturada» ya no existía posteando contra
`/loads/{id}/transition/invoiced`. La ruta real es `/loads/{id}/status/{action}`:
las dos pasaban con el defecto puesto. Lo destapó el sabotaje, no la prueba. Una
aserción negativa —404, «no contiene», «no aparece»— hay que verla fallar antes
de creérsela.

## Lote 69 — el fichero que nadie revisa

**Una aguja escrita sin espacios no encuentra código que los tiene.** Los
guardianes de `tests/Unit/Suite` quitan los comentarios con `token_get_all()`
antes de buscar, y eso NO quita los espacios en blanco: el tokenizador los
devuelve como un token más. Varias agujas estaban escritas compactas
—`'malware_scan_status'=>'clean'`, `'invoiced'=>[[LoadStatus...`— y por tanto no
podían casar jamás. Esas comprobaciones pasaban siempre, con el defecto puesto y
sin él. **Cuatro de ellas llevaban un lote entero en verde sin comprobar nada.**
Lo destapó un sabotaje: se volvió a poner el `clean` que el guardián prohibía y
el guardián no se movió.

De ahí salió `Tests\Support\Source`, con dos funciones y no una
—`sinComentarios()` y `compacta()`— y el cuerpo que estaba copiado en quince
ficheros ahora vive en uno. Quince copias es lo que hace falta para que dos de
ellas dejen de significar lo mismo sin que nadie lo note.

**Un sabotaje por aserción, no por lote.** Es la tercera vez que una
comprobación pasa por el motivo equivocado —lote 65 el grep flojo, lote 68 la
ruta mal escrita, ésta— y las tres veces el patrón fue el mismo: sabotear el
defecto grande, ver fallar ALGO, y dar por verificado el conjunto. Cada
aserción negativa hay que verla fallar por separado.

**Una aguja demasiado ancha señala a inocentes.** Al arreglar lo anterior, el
guardián de «quién escribe el estado de dinero de una carga» empezó a acusar a
`CommissionLedger` y a `SettlementController`, que escriben el estado de una
comisión y el de una liquidación: otras dos tablas con una columna llamada
`status`. La comprobación se hace ahora por SENTENCIA, exigiendo que la tabla y
el valor estén en la misma. Una aserción de código que no acota la tabla no está
comprobando lo que dice comprobar.

**Un simulacro no puede dar un visto bueno.** La tentación al construir un
adaptador de mentira para un antivirus es devolver «limpio» y quitarse el aviso
de encima. Todos los demás simulacros del proyecto siguen la misma regla y
conviene tenerla escrita: el adaptador simulado devuelve «no sé», nunca «está
bien». La diferencia entre `unavailable` y `clean` es la diferencia entre no
haber mirado y haber mirado.

**Dos motivos para no hacer algo son dos estados.** «No se analizó porque lo
generamos nosotros» y «no se analizó porque no había con qué» se parecen lo
suficiente como para querer juntarlos en uno, y juntarlos habría borrado la
única información que le importa a quien lee la pantalla: si se quiso mirar o
no.

**Analizar después de guardar no es analizar.** El orden es la garantía. Un
borrado posterior que falle deja en el almacén exactamente el fichero que se
acaba de decidir que no debía estar.

## El tablero canban y las letras de la licencia

**Un comentario de una prueba puede ser una decisión que ya se tomó.** Al barrer
los diccionarios encontré nueve ficheros con 1.524 claves que ninguna pantalla
puede cargar, y propuse moverlos fuera de `lang/`. Existía desde hacía lotes
`PortedDictionariesTest`, que dice que esos ficheros son los diccionarios
portados de la aplicación original, que se guardan A PROPÓSITO como media
especificación de los dominios que faltan, y que la convención no se cambia.
Comprobé el hecho con rigor y no comprobé si alguien ya lo había decidido. Antes
de proponer quitar algo, hay que buscar la prueba que lo defiende.

**Un «pendiente» apuntado en una lista no se hace solo.** Esa misma prueba tenía
cinco entradas que decían «Pendiente de repasar contra X.json» y llevaban lotes
sin tocarse. La sexta, la que sí se repasó, dejó anotado lo que encontró: un
suceso de aviso que faltaba y que hacía decir «renuévelo antes de que venza»
sobre un documento ya caducado. La lista funcionaba como registro y no como
trabajo.

**Un guardián que empareja por convención deja fuera lo que no la sigue.**
`PortedDictionariesTest` emparejaba `X.json` con `Xs.json`. `finance.json` —el
portado más grande, 383 claves— se construyó repartido en seis diccionarios que
no se llaman «finances», así que no tenía pareja: la prueba pasaba en verde
diciendo que todo estaba repasado, sobre el fichero que nadie había mirado
nunca. Una regla de emparejamiento es una aserción sobre los nombres, y los
nombres se salen de la regla.

**Una letra no es un dato: es una clave que hay que descifrar.** Los endosos de
una licencia se enseñaban como «H, N, T» y las restricciones no se enseñaban en
absoluto, con la columna llena. El vocabulario completo llevaba desde el puerto
escrito en los dos idiomas. Un dato de cumplimiento que hay que descifrar no se
comprueba: se mira por encima.

**Una lista escrita en la pantalla y otra en la validación acaban discrepando.**
La constante `ENDORSEMENTS` del formulario llevaba un comentario que decía «son
cinco y no cambian» encima de una lista de SEIS, mientras el servidor aceptaba
cualquier cadena de cuatro caracteres. Tres sitios tenían que coincidir —lo que
se ofrece, lo que se acepta y lo que se sabe nombrar— y no había ninguno que
mandara.

**El sabotaje que no aplica no es un sabotaje.** Uno de los ocho de este lote
pasó en verde y me lo creí un momento: el parche no había llegado a tocar el
fichero porque su condición miraba una palabra que también aparecía en un
comentario. Un sabotaje hay que verlo cambiar el fichero antes de leer el
resultado.

**En un tablero, ofrecer de más se paga más caro.** Arrastrar INVITA: la columna
se ilumina, la persona suelta y el servidor dice que no. Por eso los destinos
legales de cada tarjeta los calcula el servidor y la pantalla no lleva copia del
grafo — y por eso una columna ilegal ni siquiera acepta la tarjeta.

**Lo que la columna ya dice, la tarjeta no lo repite.** Al pasar la cola a
tablero, el motivo «la incorporación no está aprobada» empezó a salir en rojo en
todas las tarjetas de seis de las siete columnas: repetía la cabecera. Un aviso
que aparece siempre deja de leerse y arrastra consigo a los que sí importan.

## El cobro que llega después de anular

**Una firma que pide de más fabrica duplicados.** `PaymentLedger::resync()`
recibía un `Actor` y del actor usaba una sola cosa: su empresa. El webhook de la
pasarela no tiene actor, así que el método parecía inalcanzable desde ahí y
alguien escribió un segundo escritor de las mismas cuatro columnas — uno que
sumaba sobre la columna en vez de recalcular desde las filas y que se saltaba la
protección que impedía dar por pagada una factura anulada. Antes de duplicar
algo porque «no se puede llamar desde aquí», conviene mirar qué pide de verdad
la firma.

**Dos caminos que dan el mismo número lo dan hasta que se cruzan.** Sumar sobre
la columna y recalcular desde las filas coinciden mientras solo actúe uno. Medio
cobro por cada vía es todo lo que hace falta para que dejen de coincidir, y
ninguna prueba de un solo camino lo enseña: hay que escribir la que usa los dos.

**Una protección que solo cubre el estado deja el saldo fuera.** `statusFor()`
impedía que una factura anulada volviera a «pagada», y el saldo se recalculaba
igualmente: la anulada acababa con estado correcto y con saldo vivo, y la
pantalla de vencidos volvía a contarla. Cuando una lista de estados protege una
columna, hay que preguntarse cuáles más dependen de lo mismo — y usar LA MISMA
lista, no una copia.

**El camino automático no dejaba rastro.** El cobro anotado por la oficina
escribía en la bitácora; el que entra por la pasarela, no. La pista de auditoría
parecía completa y solo enseñaba la mitad del dinero. Cuando un dominio tiene un
camino manual y otro automático, hay que comprobar el automático APARTE: el
manual suele estar bien porque es el que alguien usó al construirlo.

## El barrido que dejó de correr

**Una expresión regular que casa de más casa antes.** `cadence()` ordenaba
cuatro `preg_match` y clasificaba `0 * * * *` como DIARIA, porque el `*` de la
hora satisface un `\S+` igual que un número. El orden de los `match` acabó
siendo la regla de verdad, que es justo lo que no se ve al leerlo. Reescrito por
campos, con `$fijo()` y `$todo()` explícitos, la regla se lee.

**Una regla perezosa cierra en la primera llave.** El guardián recortaba el mapa
de tonos del TSX con `/constTONO[^=]*=\{(.*?)\}/s` y contaba cuántas veces
aparecía `success-`. El `.*?` cerraba en la llave de la PRIMERA entrada, así que
medía una entrada creyendo medir seis: se pintó «con retraso» en verde y la
comprobación siguió pasando. Lo destapó el sabotaje. La versión buena comprueba
CADA entrada por separado — una aserción que agrega puede estar agregando sobre
un trozo.

**Verde con fecha vieja parece sano.** La pantalla enseñaba la insignia del
`status` guardado y la fecha de la última ejecución, y dejaba que el lector
restara. «Correcta» y «14 de agosto» son las dos piezas de un problema, no un
problema. Cuando una pantalla tiene los datos para nombrar algo, tiene que
nombrarlo: `late` y `stalled` son estados calculados, no una fecha que hay que
interpretar.

**No saber no es una alarma.** Si la expresión de cron no se entiende, la tarea
no sale con retraso: sale sin saber. Convertir un fallo de lectura en una alarma
es inventarse un problema a partir de la propia ignorancia, y una pantalla que
lo hace se deja de mirar.

**Un margen de gracia no es laxitud: es lo que hace que la alarma se lea.** Sin
la hora de perdón, el barrido diario de las 06:00 saldría «con retraso» cada
mañana durante los dos minutos que tarda. Una alarma que salta todos los días
sin motivo enseña a ignorar la pantalla, y entonces la de verdad tampoco se ve.

**Una lista de lo que hay que vigilar, escrita a mano, no vigila lo nuevo.** La
pantalla llevaba `TAREAS = ['notifications:sweep', 'retention:sweep']` y
`routes/console.php` llevaba la otra. Un `Schedule::command()` nuevo corría sin
que ninguna pantalla lo enseñara. Lo que vigila algo tiene que preguntarle a
quien lo define — aquí, al planificador de Laravel.

**Cambiar una firma exige buscar los llamadores, no la constante.** Al pasar
`ScheduledRuns::summary()` de recibir nombres a recibir nombres con su cron,
busqué `TAREAS` —la constante que quitaba— y no `summary(`. Había un segundo
llamador, `RetentionController`, y 301 pruebas cayeron con un `TypeError` que
no tenía nada que ver con el lote. El grep correcto es el del SÍMBOLO que
cambia de forma, no el del que se borra.

**El mismo defecto suele estar en dos pantallas.** La de salud de la plataforma
enseñaba «correcta» sobre un cron muerto; la de retención decía «corrió el 13 de
agosto y no había nada que hacer» sobre el mismo barrido parado. Y la segunda es
la que ve un administrador de EMPRESA — la de plataforma pide
`platform:health:read`. Al arreglar una frase tranquilizadora conviene buscar
quién más la dice.

## Lote «el día hábil que nadie prometía cumplir»

**Un guardián por FICHERO da por bueno el fichero entero.** La comprobación
decía «los dos controladores públicos avisan» y leía cada fichero completo. Se
le quitó el aviso a `LeadController::storeLead` y **siguió en verde**, porque
`storeQuote` —en el mismo fichero— todavía lo tenía. Cuando lo que se vigila es
una obligación de cada punto de entrada, hay que recortar el CUERPO de cada
método y mirar dentro. Tres puertas, tres comprobaciones.

**`expect()->toContain()` no acepta un mensaje: acepta más agujas.** Escribí

```php
expect($codigo)->toContain('Arrival::announce(', "Falta el aviso en {$nombre}");
```

y el mensaje se convirtió en una segunda aguja que no casaba con nada. La
comprobación fallaba siempre, y fallaba diciendo otra cosa. Cuando hace falta
un mensaje, `test()->assertStringContainsString($aguja, $sujeto, $mensaje)`.

**Una ventana de tamaño fijo acaba leyendo el método de al lado.** `substr($codigo,
$inicio, 1600)` para mirar dentro de `prospectosSinAtender()` se comía el
principio de `unDiaHabilAntes()`, que tiene un `->subDay()` legítimo. La
comprobación «este método no usa subDay pelado» medía el método siguiente. El
final se busca: la firma del método que viene, o el `return` del propio método.

**Pest carga todos los ficheros de prueba en un espacio global.** `prospecto()`
en `ArrivalTest.php` chocó con `prospecto()` en `LeadTest.php`: fatal que se
lleva por delante la suite ENTERA, y que **solo aparece al correrla entera** —
el fichero solo pasaba en verde. Toda función de primer nivel en un fichero de
pruebas necesita un nombre que no vaya a repetirse.

**Un total que se suma y no se imprime deja de existir sin que nada cambie.**
Añadí `$totales['leads']` al barrido y no lo puse en la línea que imprime el
resumen. La pasada podía dejar de correr entera y la salida del comando sería
idéntica. Se cerró con una comprobación que lee el `sprintf` y exige que el
total aparezca.

**Un ayudante compartido que no cubre un caso muere con un error que no explica
nada.** `Scenario::user(Role::PlatformSuperAdmin)` moría con
`Undefined array key "platform_super_admin"`, porque `Scenario::create()` salta
ese rol a propósito. Dos ficheros de prueba llevaban su propia copia local del
montaje. Ahora se construye al pedirlo.

**Y la copia local llevaba dentro una creencia falsa.** Escribí que
`users.is_platform_super_admin` «es lo que mira la autorización». No lo es:
`PermissionChecker` resuelve la matriz desde el ROL de la membresía y esa
columna no aparece en la decisión. La columna hace otra cosa —dejar entrar con
la empresa suspendida, y pintar el menú—. Lo destapó el recorrido con navegador:
el usuario promovido a mano entró y recibió «No tiene acceso a esto». Un
comentario sobre autorización que no se ha comprobado corriendo es una
suposición con aspecto de documentación.

**El recorrido con navegador encuentra lo que ninguna prueba mira.** Enviar el
formulario público de verdad enseñó tres cosas que la suite no ve: el token de
formulario exige tres segundos mínimos de rellenado, las dos casillas de
consentimiento son obligatorias, y al superar el límite de seis envíos por hora
la página **vuelve a pintar el formulario sin decir por qué**. Las dos primeras
son guardias haciendo su trabajo. La tercera es una pantalla que se calla, y
está anotada en `docs/lead-response.md` sin arreglar.

## Lote «al remitente ya le avisaron»

**Una prueba puede atar la FRASE al código, no solo al código.** El defecto no
era una función que faltara: era una pantalla que afirmaba algo falso. Así que
el guardián principal no comprueba «existe la llamada», sino: *si el diccionario
sigue afirmando que al remitente le avisaron, entonces `decline()` tiene que
avisar*. Si mañana alguien quita el aviso, la prueba obliga a quitar también la
frase — que es la otra forma correcta de arreglarlo. Un guardián que solo exige
la llamada convierte una decisión de producto en una regla de código.

**Fijar la fecha «hace N días» hace pruebas que fallan ciertos días.** Una
prueba mía de dos lotes atrás afirmaba que una tarea semanal (`0 4 * * 0`) que
corrió «hace 2 días» no va con retraso. Hace 2 días solo cae después del último
domingo a las 04:00 si hoy es de miércoles a domingo: **los lunes y los martes
fallaba**, y era la prueba la que estaba mal, no el código. Falló hoy, lunes.
Dos días de cada siete es la peor frecuencia posible — pasa lo bastante para
parecer sana y falla lo bastante para que se le eche la culpa a otra cosa. La
fijación se ancla ahora a la última ocurrencia real del cron.

**El límite de peticiones es compartido, y hace fallar pruebas de OTROS
ficheros.** Las rutas públicas de firma van con `throttle:20,1`, por IP, y todas
las pruebas salen de 127.0.0.1. Mis ocho envíos nuevos se comían el presupuesto
que ya usaba `SignatureTest.php`, y caían al azar pruebas de `AssignmentTest` y
`DemoSeedTest` — que no tocan firmas. Al correr esos ficheros juntos pasaba
todo; solo aparecía en la suite entera, y no siempre. Exactamente lo que se
etiqueta de «flaky» y se ignora. El remedio ya estaba escrito en `Pest.php`:
variar `REMOTE_ADDR` con `withServerVariables` (no como cabecera — como cabecera
el limitador sigue viendo 127.0.0.1).

**Dos ejecuciones de la suite, no una.** La primera pasada limpia después de
arreglar algo no prueba que la intermitencia se fuera. La segunda sí dice algo.

**Una comprobación posicional puede compararse consigo misma.** Para exigir que
el aviso vaya FUERA de la transacción escribí `strrpos($cuerpo, '));')` — que
encuentra el paréntesis final del propio aviso, no el de la transacción. La
prueba comparaba una posición con otra que venía después por construcción. Se
arregló acotando la REGIÓN de la transacción (de `DB::transaction(` al `catch`)
y exigiendo que `Outcome::` no aparezca dentro.

**`pint` sobre una carpeta toca ficheros que no son tuyos.** Al pasarlo por
`app/Support/Signatures` reformateó cuatro ficheros que este lote no tocaba,
uno de ellos `Seal.php` — el canonicalizador del sello de integridad de las
firmas. El cambio era equivalente (`"\\"` a `'\\'`), pero un cambio gratuito en
el sitio donde se calcula una huella no se entrega. Se restauraron desde el
tarball de origen. **El repositorio no está del todo limpio para pint**, y
conviene saberlo antes de que un `pint` amplio lo mezcle con un lote.

## Lote «la tarifa que nadie contesta»

**Una aguja sin ancla final es un PREFIJO, y no ve lo que se le añada detrás.**
El guardián de la clave de deduplicación buscaba

    dedupeKey:RateResponse::SIN_CONTESTAR.':'.$documento->id

y el sabotaje que la convertía en `...->id.':'.now()->toDateString()` **pasó en
verde**: la aguja seguía estando, como prefijo. La coma final es lo que obliga a
que el argumento TERMINE ahí. Y esto no lo puede atrapar ninguna prueba de
recorrido: dos pasadas del barrido el mismo día generan la misma clave con fecha
y sin ella, así que se deduplicarían igual — el fallo solo aparecería al día
siguiente, en producción, con la campana repitiendo. **Toda aguja que fije el
final de una expresión lleva su coma o su paréntesis de cierre.**

**Derivar los sucesos del enum convierte «se me olvidó» en un fallo de prueba.**
Los cuatro avisos de este lote salen de `RateConfirmation::DECISIONES` con
`array_map(self::sucesoDe(...), ...)`, y el guardián recorre ese mismo enum
exigiendo, para cada valor, su entrada en `EVENTS` y su título, cuerpo y nombre
en los dos idiomas. Una quinta decisión futura no puede colarse sin rótulo. Un
sabotaje que convertía `sucesos()` en una lista literal lo confirma.

**Un `public static` que ya existe vale más que leer el fuente.**
`NotificationController::events()` es público y devuelve la lista de sucesos.
Estaba leyendo ese fichero con `Source::sinComentarios()` y buscando comillas
dentro. Llamar al método es más corto, no necesita arrancar la aplicación, y
sigue el símbolo aunque la constante cambie de forma. Antes de escribir una
aguja sobre el fuente conviene mirar si hay un accesor.

**Tercera vez con el espacio global de Pest.** `avisosDe()` chocó con la de
`tests/Feature/Notifications/SweepTest.php`. Ya van tres lotes seguidos. La
comprobación cuesta un `grep -rn "^function <nombre>(" tests/` antes de escribir
la función, y se hace ahora por costumbre.

**Una fijación puede chocar con la validación y medir otra cosa.** Para probar
que el motivo se recorta a 160 usé `str_repeat(..., 100)` = 2200 caracteres. El
campo valida `max:2000`, así que la petición ni pasaba: no había aviso, y la
prueba medía «no hay aviso» creyendo medir el recorte. Una fijación que quiere
provocar UN límite tiene que quedarse dentro de todos los demás.

**Dos botones con la misma etiqueta, y clicar el primero no da error.** En el
recorrido con navegador, «Accept the rate» es primero el botón que ELIGE la
decisión y luego el que ENVÍA el formulario que aparece. Playwright clicó el
primero, no se mandó nada, y no hubo ningún error — la prueba habría dado por
bueno un flujo que no ocurrió. Se atrapó registrando `page.on('response')` y
viendo que no salía ningún POST. **En un recorrido, comprobar el efecto, no el
clic.**

## Lote «el permiso que no manda»

**Una fijación puede aprender el defecto y defenderlo.** Dos pruebas de
`LoadDocumentTest` descolgaban un documento firmando como DESPACHADOR y pasaban
en verde — porque la acción autorizaba contra el permiso de SUBIR en vez del de
borrar. Al conectar `document:delete`, cayeron. No eran pruebas rotas: eran
pruebas que habían codificado la frontera equivocada y llevaban tiempo
protegiéndola. **Cuando un arreglo de autorización rompe una prueba existente,
la primera pregunta es cuál de las dos tenía razón**, no cómo hacerla pasar.

**El guardián encontró más que el barrido a mano.** Yo había contado doce
permisos sin comprobar grepeando a ojo; la prueba, que recorre `Permissions::keys()`
contra todo `app/` y `routes/`, encontró **dieciséis**. Entre los cuatro que se
me habían escapado estaban `tenant:integration:read` y `tenant:integration:update`
— la mitad ya hecha de una función que llevo cuatro lotes ofreciendo. Cuando la
comprobación es enumerable, escribirla es más fiable que hacerla a mano, incluso
para el barrido que la origina.

**Una lista de excusas necesita sus propios guardianes.** `Enforcement::SIN_APLICAR`
podría pudrirse de tres formas, y hay una prueba para cada una: nombrar un
permiso que ya SÍ se comprueba (la excusa dejó de ser cierta y la próxima persona
la creerá), nombrar una clave que no existe en el catálogo, o llevar un motivo
vacío. Un registro de excepciones sin mantenimiento es peor que no tenerlo.

**No borrar lo que no se usa, hasta saber si es deliberado.** Doce claves no
gobiernan nada y se quedan, anotadas. Ya me equivoqué recomendando quitar nueve
diccionarios «muertos» que estaban ahí a propósito: comprobé el hecho y no
comprobé la intención. Vocabulario reservado para algo aún no construido tiene
valor; borrarlo obliga a reinventarlo con otro nombre.

**El recorrido tiene que saltarse su propia interfaz.** Comprobar que el botón
«Descolgar» ya no se pinta demuestra la cortesía, no la seguridad. La prueba que
importa fue mandar el DELETE a mano desde la consola del navegador con la sesión
del transportista: 403. Si solo se comprueba lo que la pantalla ofrece, se está
verificando el escondite y no la cerradura.

**Un filtro de recorrido escrito en un idioma miente en el otro.** Buscaba el
botón con `/^(Quitar|Detach)$/` y en español la etiqueta es «Descolgar»: el
recorrido informó de que el ADMIN tampoco veía el botón. Un minuto más y habría
«arreglado» algo que funcionaba. En un recorrido bilingüe, las agujas salen del
diccionario, no de la memoria.

## Lote «la parada que se borraba de verdad»

**Un sabotaje puede golpear el método equivocado y parecer que funciona.** Para
probar el guardián del «resuelve dentro del dueño», la aguja del sabotaje era

    ->where('load_id', $load->id)\n                ->where('id', $id)

y `.replace(..., 1)` la aplicó a `syncRequirements`, que va **antes** en el
fichero. El md5 cambiaba, así que el arnés lo daba por bueno, y el guardián
pasaba en verde sin haberse probado nunca. **Ver que el fichero cambia no basta:
hay que ver que cambia lo que se cree.** Toda aguja de sabotaje lleva ahora algo
que la ancle al sitio exacto — aquí, el nombre de la tabla.

**Y el guardián que sobrevivió a ese susto también estaba mal.** Miraba el
método ENTERO buscando `->where('load_id', $load->id)`, que también aparece en
el UPDATE de borrado blando del final. Quitárselo a la búsqueda no lo rompía. Se
acotó a la sentencia de búsqueda. Es la tercera vez en cuatro lotes que una
aguja demasiado ancha da un guardián inerte: **por fichero cuando había que
mirar por método, por método cuando había que mirar por sentencia.**

**`$request->validate()` no devuelve los datos en el orden en que se mandaron.**
Los monta regla por regla, así que en un array de objetos las entradas que
cumplen la primera regla salen primero. `array_values()` sobre eso reordena en
silencio. Aquí hacía que una parada nueva puesta la primera se guardara la
última — con uso normal, sin nadie manipulando nada. **Si el orden de un array
de entrada significa algo, hay que ordenarlo explícitamente y usar las claves
originales para los mensajes de error.**

**El esquema puede ser la razón por la que el código está mal.** El DELETE crudo
sobre una tabla con borrado blando parecía un descuido. No lo era: el índice
`UNIQUE (load_id, sequence)` no miraba `deleted_at`, así que borrar en blando
dejaba el número de orden ocupado para siempre y rompía la siguiente edición.
Con esa restricción puesta, el borrado de verdad era lo único que funcionaba.
**Antes de llamar descuido a algo, conviene comprobar si el esquema deja hacerlo
bien.**

**Cuarta colisión de nombre global en cinco lotes** (`paradasDe`). El
`grep -rn "^function <nombre>(" tests/` antes de escribir ya no es una
precaución: es parte de escribir la función.

**En un recorrido con navegador, el botón que hay que pulsar se mueve.** Para
subir una parada hasta la primera posición hay que pulsar SU flecha, y esa
flecha cambia de índice en cada pulsación. Pulsando siempre la última se pulsa
la de otra parada, no pasa nada visible, y el recorrido informa de que la
función no va. Dos intentos perdidos por adivinar el DOM en vez de abrir el
componente y leerlo: **cuando un selector falla dos veces, se lee el fuente.**

## Lote «los siete días que promete la web»

**Un guardián de hace lotes evitó que el arreglo se llevara una verdad por
delante.** `CarrierPromisesTest` fija las frases «re-verified automatically» y
«revalida automáticamente» con el comentario «si alguien las reescribe, esta
prueba lo dice y hay que revisar si lo que se cumple sigue siendo lo que se
promete». Al quitar la cifra falsa quité también «automáticamente», que **sí**
es cierto, y la prueba lo cazó en la suite. Arreglar una mentira puede borrar
una verdad que estaba en la misma frase: el guardián existe justamente para
obligar a mirar cuál es cuál.

**Dos guardianes sobre la misma frase, tirando en direcciones distintas, es
correcto.** El viejo exige que diga «automáticamente»; el nuevo prohíbe que diga
un número de días. Ninguno de los dos solo es suficiente, y juntos describen la
promesa exacta que el sistema puede cumplir.

**El texto sin cifra tiene que decir de quién depende.** Quitar «cada 7 días» y
dejar «se revalida periódicamente» habría sido cierto y peor: quien lo lee no
sabe a quién preguntarle cada cuánto. Hay una comprobación de que las dos frases
nombran a la casa de despacho. Ser vago no es lo mismo que ser honesto.

**Un token de color inventado se pinta como nada.** Puse `border-warning-400` y
el guardián de tokens lo cazó: los tonos que existen son 50, 100, 300, 500, 700
y 800. Sin esa prueba, el aviso se habría visto sin borde y nadie lo habría
notado hasta verlo en producción.

**Una prueba puede medir la caché en vez del ajuste.** `TenantPolicy` cachea por
petición y `TenantSettingController` la invalida al guardar. Al cambiar el ajuste
escribiendo en la tabla a pelo, mi prueba leía el valor viejo y pasaba en verde
creyendo medir el nuevo. Cuando una prueba se salta el controlador, se salta
también lo que el controlador hace además de escribir.

**Las agujas del sabotaje caducan con el texto.** Reescribí la copia dos veces y
las tres primeras agujas del arnés dejaron de encontrar nada — el arnés lo dijo
(«la aguja del SABOTAJE no está») en vez de dar verde. Un arnés que distingue
«no pude sabotear» de «saboteé y siguió pasando» es la diferencia entre
enterarse y no.

## Lote «la hora que el cliente lee mal»

**Arreglar una superficie y dejar la de al lado es peor que no tocar ninguna.**
Al convertir la lista de paradas, la cronología de la MISMA página seguía en
UTC: decía «llegó a las 09:04» arriba y «13:04» abajo, del mismo suceso. Antes
era una hora mala; después eran dos que se contradicen, y quien lee no sabe cuál
creerse. Lo vio el recorrido con navegador, no la suite — porque cada prueba
miraba su propia superficie. Hay ahora una que exige que las dos digan lo mismo
**en la misma respuesta**.

**Un script que muere después de `replace()` y antes de `write()` no cambia
nada, y el `php -l` siguiente pasa igual.** Mi primer intento de convertir la
cronología reventó al añadir el import, después de haber calculado el reemplazo
y antes de escribir el fichero. El lint pasó —el fichero estaba intacto— y el
segundo script solo añadió el import sobre el cuerpo viejo. La prueba lo cazó,
pero la lección es de método: **después de editar, comprobar que lo editado está
ahí**, no que el fichero compila.

**Tercera aguja demasiado ancha, y esta vez a nivel de sentencia.** El guardián
de «la pantalla manda el huso» buscaba `'zone' => StopClock::label(` en el
fichero. Al añadir un segundo `StopClock::label(` para la última posición, el
sabotaje que se lo quitaba a las PARADAS pasó en verde. Ya van tres formas del
mismo error: por fichero cuando había que mirar por método, por método cuando
había que mirar por sentencia, y por fichero cuando el fichero ganó una segunda
llamada legítima. La aguja se ancla al argumento que la distingue —aquí
`$s->timezone`.

**Una aguja escrita con espacios no casa tras `compacta()`.** Buscaba
`.' '.$s['zone']` y el compactado deja `.''.$s['zone']`. Es exactamente el fallo
que dio origen a `Tests\Support\Source`, repetido por escribir la aguja mirando
el fichero en vez de mirando lo que la función devuelve.

**Cuarta vez con `expect()->toContain($aguja, $mensaje)`.** Toma todos los
argumentos como agujas. Ya está anotado tres veces en este fichero y volvió a
morder: cuando hace falta mensaje, `test()->assertStringContainsString()`.

**Una suite que tarda seis veces más de lo normal puede no ser culpa del
código.** La primera pasada completa se quedó nueve minutos sin terminar y
sospeché de mi propio `timezone_identifiers_list()`. No era: aislando por
carpetas todo iba a su velocidad, y la siguiente pasada completa hizo 110 s.
Había reiniciado mysql a mitad de la anterior. **Antes de optimizar, aislar.**

---

## El reloj de quien mira (`docs/viewer-clock.md`)

**Un árbol que ya estaba rojo no mide nada, y mi arnés de sabotajes no lo
comprobaba.** Un script suelto para inspeccionar un fallo murió con un
`TypeError` **antes** de restaurar `Clock.php`, dejando el sabotaje puesto. El
`.bak` del siguiente script copió el fichero ya saboteado, así que las dos
restauraciones posteriores restauraron la versión mala. A partir de ahí, **cada
sabotaje de tres tandas seguidas informó «CAZADO»** solo porque el árbol ya
fallaba: el arnés únicamente exigía «no verde después». Veintitantas
verificaciones que no verificaban nada.

El arnés ahora, y esto es el patrón que se queda:

1. **Exige VERDE antes** de cada sabotaje, y si no lo está lo dice y no lo cuenta.
2. Restaura en un `finally` y **verifica el md5** contra el de partida.
3. Antes de la tanda, valida cada sabotaje: **aguja única** y, si es PHP,
   **`php -l` en verde**. Cinco de mis sabotajes generados producían paréntesis
   desbalanceados; medían un error de sintaxis, no el guardián.
4. Imprime **qué prueba** se puso roja, no solo cuántas. Es lo que distingue
   «cazado por lo que quería» de «cazado de rebote».

Al repetir la tanda con eso puesto, **una** salió verde — y era la comprobación
por la que existía todo el lote.

**Un `(?<![a-z_])` sobre el fichero compactado descarta `return substr(`.** La
aguja del censo excluía `mb_substr` mirando la letra anterior. Pero `compacta()`
quita los espacios, así que `return substr(...)` se lee `returnsubstr(` y la
letra anterior es la `n` de `return`: **un fichero nuevo que sacara la hora con
un `return` directo pasaba el guardián sin declarar nada**. La aguja correcta es
`(?<!_)`, que excluye `mb_`/`iconv_`/`grapheme_` y no las palabras clave. Lección
general: **una exclusión por «carácter anterior» se escribe contra el texto que
la función devuelve, no contra el que se ve en el editor.**

**Un guardián que LEE el código no puede ver que `$this->hora()` está dentro de
un `static fn`.** El texto es idéntico en los dos casos y el guardián pasó en
verde; en marcha era `Error: Using $this when not in object context` y un 500 en
la lista de avisos. Lo cazó la prueba de integración al pedir la página. De ahí
sale una regla nueva: **cuando un lote cambia N pantallas, una de las pruebas
tiene que PEDIR las N pantallas**. Hay ahora un `->with([...])` que recorre las
seis y solo exige `assertOk()`; es barato y cubre toda la clase de fallo que el
guardián de texto no alcanza.

**`expect()->toHaveKey($clave, $mensaje)` toma el segundo argumento como VALOR
esperado.** Misma familia que `toContain`, que ya va por la cuarta anotación en
este fichero. Con mensaje: `test()->assertArrayHasKey($clave, $array, $mensaje)`.
Empieza a haber patrón: **en Pest, el segundo argumento de un `toX()` casi nunca
es un mensaje.** Antes de escribir uno, comprobar la firma.

**`actingAs()` no pone la empresa activa.** Cuatro pruebas rojas con «Not a valid
Inertia response» hasta acordarme de que la empresa vive en
`sessions.active_tenant_id` y que existe `signIn()` en `tests/Pest.php`
precisamente para eso — con el comentario que lo explica ya escrito. **Antes de
escribir una prueba HTTP nueva, mirar cómo entra la de al lado.**

**Otra prueba que había aprendido el defecto.** `OnboardingQueueTest` comparaba
`waitingSince` contra `now()->subDays(4)->format(...)`, y `now()` sale en
`config('app.timezone')`, que es UTC: la prueba **afirmaba** la hora sin
convertir. Lo que quería medir era *cuál* de las marcas se elige según el estado,
no en qué reloj se enseña. Corregida a `Clock::at(..., Clock::POR_OMISION)`. Van
tres lotes con una prueba defendiendo el defecto que el lote arregla; el olor es
siempre el mismo: **la prueba reconstruye el valor esperado con la misma
operación que hace el código que vigila.**

**No todo `datetime` de la base de datos es un instante en UTC, y el censo no lo
sabe.** Tres columnas del censo —`permits.issued_at`, `permits.expires_at`,
`escorts.scheduled_for`— las teclea una persona en un `datetime-local` y se
guardan tal cual: convertirlas las habría **movido**. Se descubrió leyendo quién
escribe cada columna, no contando `substr`. **Antes de convertir una hora, buscar
el `=>` que la escribe.** Y la conversión a la inversa también importa: dos
pantallas del sistema enseñando la MISMA fila con dos husos distintos
(`SignatureController` convertido y `Readiness` sin convertir) es peor que las
dos en UTC, así que el criterio para meter un fichero en el lote no fue solo
«cuánto duele» sino «¿comparte columna con algo que ya convertí?».

---

## El tipo que no tenía nombre (`docs/document-names.md`)

**Un guardián que recorre una lista escrita por quien lo escribió no comprueba
el código, se comprueba a sí mismo.** La prueba de que el catálogo de dueños
cubre las ranuras de `Papers` iteraba `['permit','route_survey','escort']` a
mano. El sabotaje que AÑADÍA una cuarta ranura sin catalogar pasó en verde: la
lista del guardián no cambiaba. La versión que sirve lee las ranuras del
fichero. Regla: **si el guardián existe para vigilar una lista del código, la
lista tiene que salir del código.**

**Una aguja que no entiende una entrada la salta, y saltarla es no
comprobarla.** Corregido lo anterior, la aguja leía `'tipo'=>'([a-z_]+)'`. El
sabotaje que ponía `route_survey_v2` —con dígito— no casaba, así que el bucle
pasaba de largo y el guardián seguía verde. Dos arreglos: la clase pasa a
`[^']+`, y —esto es lo que se generaliza— **se cuenta cuántas entradas hay y se
exige haber leído todas**:

```php
expect(count($ranuras))->toBe(substr_count($fuente, "=>['tabla'=>"));
```

Sin ese contador, cualquier futura entrada con una forma inesperada vuelve a
salir gratis. Es la misma familia que el `(?<![a-z_])` del lote anterior: **una
expresión que filtra tiene que fallar sobre lo que no entiende, no ignorarlo.**

**Completar un catálogo puede ABRIR una puerta.** `DocumentController::store`
guardaba la subida con `isKnown()`. Con veintidós tipos daba igual; al
completarlo a veintisiete, los cinco que escribe la aplicación se volvieron
«conocidos» y la puerta los habría dejado pasar — justo lo que el lote decía
estar impidiendo. El guardián de código no lo vio: **el fichero seguía diciendo
exactamente lo mismo, lo que cambió fue la respuesta del catálogo**. Lo cazó la
prueba de integración al hacer el POST. Regla que ya va por la segunda vez en
dos lotes: **cuando un lote amplía un conjunto del que depende una validación,
una de las pruebas tiene que ejercitar esa validación de verdad.**

**`*/` dentro de un docblock lo cierra.** Escribí `lang/*/documents.json` en un
comentario y el fichero dejó de compilar. Obvio dicho así y perdí un ciclo.

**Un reemplazo cuyo ancla incluye líneas que quiero conservar tiene que
reproducirlas.** Usé como ancla el bloque `// Genéricos` + `'other' => …` para
insertar detrás, y el reemplazo no las repetía: el catálogo se quedó en 26 de 27
y solo lo vi porque conté. **Anclar antes, no encima.**

**Los diccionarios JSON no comparten indentación.** `documents.json` usa cuatro
espacios y `carriers.json` dos. Un `json.dump(indent=4)` sobre el segundo
reformatea el fichero entero — que es lo que me pasó con `nav.json` en el lote
anterior y por lo que ahí el commit hubo que enmendarlo. Lo que hago ahora:
**recuperar el original de git, comparar, y exigir que el diff sean solo las
líneas añadidas** antes de dar el fichero por bueno.

**Un dominio declarado mal pide rótulos que no existen.** Al montar el registro
de dominios declaré `tracking_sessions.provider => tracking.provider` y
`trucks.coi_verification_status => equipment.verification`. Ninguna de las dos
rutas es la que usa la pantalla, y el guardián exigió diez rótulos para dos
pantallas que estaban bien. **Un par del registro solo entra después de leer el
`t()` que de verdad lo usa** — si no, el guardián se convierte en una fuente de
trabajo inventado y acaba desactivado, que es la forma en que un guardián deja
de guardar.

---

## La pantalla vacía que mentía (`docs/empty-states.md`)

**Los props de una pantalla llevan más que sus filtros, y eso rompe el «¿hay
filtros puestos?».** Al escribir la prueba de integración comprobé
`array_filter($props['filters'])` esperando que estuviera vacío en una pantalla
recién abierta, y salieron `sort => 'legal_name'` y `direction => 'asc'`. La
prueba falló y con ella descubrí que `Documents` calculaba
`Object.values(filters).some(v => v !== '')`: si esa pantalla gana orden algún
día, `filtered` queda cierto para siempre y las otras tres ramas del estado
vacío se vuelven inalcanzables. **No fallaba todavía**, y solo apareció porque
la prueba mira los props de verdad en vez de razonar sobre ellos. Lección:
**una aserción sobre «está vacío» tiene que nombrar qué debería estar vacío**;
la versión genérica pasa por buena todo lo que el servidor decida meter ahí
mañana.

**El orden de unas ramas es una decisión que hay que vigilar, no solo su
existencia.** El componente mira filtro, luego alcance, luego permiso. Con
alcance y permiso intercambiados el resultado es correcto en cinco de los seis
roles y falso en uno —el despachador, que sí puede crear conductores y sí tiene
la lista acotada—. Un sabotaje que solo quita ramas no lo caza; hay que
comparar POSICIONES en el fichero:

```php
expect($posAlcance)->toBeLessThan($posPermiso, '…');
```

Es la primera vez en estos lotes que lo vigilado es el orden y no la presencia,
y vale la pena tenerlo en cuenta cuando lo que se construye es una cadena de
`if` cuyas ramas se solapan.

**Un escenario de prueba sin datos hace pasar una prueba que no mide nada.** La
prueba de «la empresa tiene documentos y el conductor no» pasaba con la empresa
también vacía. Ahora crea el documento ANTES de mirar y afirma que existe. El
olor: **cuando la prueba dice «A sí y B no», tiene que afirmar A además de negar
B**, o solo está midiendo B.

**El borrado suave sirve para poner una lista vacía sin romper nada.** Para
llegar a la rama de empresa hacía falta una lista de transportistas vacía sobre
la base de datos de demostración. Ocultarlos con `deleted_at` y una razón
reconocible —`PRUEBA_TEMPORAL`— y restaurarlos por esa razón deja el recorrido
repetible y la base como estaba. Verificado contando al final.

---

## El trabajo abierto que nadie comprobaba (`docs/open-work.md`)

**Una constante que nadie fija es una constante que se puede ampliar sin que
nada falle.** `CARGAS_CERRADAS = ['paid','cancelled']` estaba comprobada solo
así: «cada uno de sus valores existe en un CHECK del esquema». El sabotaje que
añadía `delivered` pasó en verde — los tres valores existían. Con `delivered`
dentro se podía borrar al transportista que acababa de entregar y todavía no
había cobrado. Dos arreglos, y hacen falta los dos:

```php
expect(OpenWork::CARGAS_CERRADAS)->toBe(['paid', 'cancelled']);   // la lista exacta
```

y una prueba de integración que **ejercite** un estado que no está en la lista
(`delivered`, `invoiced`). Lo primero fija la decisión; lo segundo comprueba que
la decisión hace algo. **Una lista de valores permitidos necesita las dos
aserciones: cuál es la lista, y qué pasa con algo que no está en ella.**

**Comprobar la posición de un texto no comprueba que la rama se alcance.** El
guardián exigía que `openWork.blockedTitle` apareciera antes que `if (!armed)`.
El sabotaje `if (false && abierto.length > 0)` dejó el texto donde estaba y la
rama muerta: verde. La aguja pasó a fijar la **condición** exacta —`if
(abierto.length > 0) {`— con lo que un `&&` delante ya no casa. Regla: **cuando
lo vigilado es que algo ocurra bajo cierta condición, la aguja tiene que
contener la condición, no lo que se pinta debajo de ella.**

**Una aguja sin retrorreferencia acepta que se ignore lo que se acaba de
contar.** Para exigir que un borrado compruebe dependencias yo buscaba
`exists();if(`. El sabotaje `if (false)` mantiene el `exists();` y deja de mirar
el resultado: verde. La versión que sirve ata la condición a la variable que se
asignó:

```php
preg_match('/\$(\w+)=DB::table\([^;]+;if\(\$\1\)/', $fuente)
```

Es la tercera vez en tres lotes que un sabotaje destapa una aguja demasiado
laxa, y las tres tenían la misma forma: **la aguja describía la vecindad del
código en vez de la relación que importa.**

**Un escenario con dos de algo distingue «cuenta bien» de «cuenta todo».** La
prueba de que `OpenWork::forCarrier` cuenta lo de UN transportista pasaba
trivialmente hasta que se cerró la carga del OTRO y se comprobaron los dos a la
vez. `Scenario` da un transportista asignado y otro que no precisamente para
esto, y aun así se me olvidó usarlo.

**Volví a reformatear un diccionario, con la lección ya escrita dos lotes
antes.** `carriers.json` usa DOS espacios y `common.json` cuatro; escribí los
cuatro con `indent=4` y el diff salió 224 añadidas / 213 quitadas. Lo que
faltaba no era la lección, era el PASO: la sangría se lee del propio fichero

```python
segunda = texto.split('\n')[1]
ind = len(segunda) - len(segunda.lstrip(' '))
```

y después del write se compara contra el original de git EXIGIENDO cero líneas
quitadas. Escribirlo en `docs/testing.md` no evitó nada; ejecutarlo, sí. Cuando
una lección se repite, lo que falta es una comprobación, no otra frase.

**Insertar filas en las pruebas encuentra columnas obligatorias que el modelo
esconde.** `carrier_settlements` pide `period_start` y `period_end`, y
`expenses` pedía `treatment_snapshot`, ninguna con valor por omisión. Escribir
con `DB::table()->insert()` en vez de con el modelo es lo que hace que esas
reglas aparezcan — y es también lo que obliga a leer el esquema antes de dar por
buena una prueba.

---

## El logo que podía traer un script (`docs/logo-safety.md`)

**`pkill -f "artisan serve"` casa con el propio shell que lo ejecuta.** La
cadena aparece en la línea de órdenes del `bash -c` que la contiene, así que el
proceso se mata a sí mismo a mitad de la orden: el servidor no se reinició, los
ficheros de prueba no llegaron a crearse y la salida fue un código 144 sin
explicación. Para reiniciar algo en este contenedor, arrancar la copia nueva y
dejar morir la vieja, o filtrar por PID — nunca por una cadena que uno mismo
está escribiendo.

**Un error de validación de Inertia no siempre está en el texto visible.**
Buscando «rechazado / aceptado» en `document.body.innerText` no encontré nada y
di por hecho que el fichero se había aceptado. Estaba rechazado: el mensaje vive
en `props.errors` del `data-page`, y el texto de la pantalla lo pinta un
componente que mi expresión no cubría. Leer los props es lo fiable:

```js
JSON.parse(document.getElementById('app').dataset.page).props.errors
```

**Volcar la pantalla entera encuentra cosas que no se buscaban.** Al ampliar esa
misma comprobación a todo el texto visible aparecieron dos claves crudas
—`SETTINGS.BRAND.TEMPLATES.TRACKING.LINK`— que ningún barrido anterior había
visto, porque su familia de clave dinámica no sale de un dominio cerrado del
esquema y el guardián de nombres no la cubría. **El volcado completo de una
pantalla es barato y encuentra lo que las agujas dirigidas no.**

**Una clave de diccionario no puede contener el separador.** `t()` parte por
puntos: `templates: { "tracking.link": … }` no se puede encontrar nunca, porque
la búsqueda baja por `templates → tracking`. Estaba traducida en los dos idiomas
y no se había enseñado jamás. La comprobación es de una línea y cubre los
veintitantos diccionarios: ninguna clave, a ninguna profundidad, lleva un punto.

**Una prueba que planta el estado «de antes» tiene que saltarse el
controlador.** Para comprobar que un logo SVG guardado cuando la validación lo
admitía deja de servirse, no vale subirlo —la validación nueva lo rechaza—: hay
que escribir la clave directamente en la fila, que es exactamente como llegó
allí. **El caso que importa de una migración de comportamiento es el dato viejo,
y el dato viejo no entra por la puerta nueva.**

## La ficha que el cliente lee entre llaves (`docs/email-templates.md`)

**Un sabotaje mal etiquetado deja una aserción sin verificar y la campaña lo
cuenta como verde.** Para probar la aserción de que la comprobación va *antes*
de guardar escribí un sabotaje que cambiaba `'tokens' => '{'.implode(…).'}'` por
`'tokens' => 'x'`. Salió verde, y el verde era correcto: **ese cambio no mueve
nada de sitio**. La aserción compara posiciones de dos cadenas en el fuente; el
único sabotaje que la mide es poner el bucle que escribe por encima del que
comprueba. El nombre del caso decía una cosa y el `old→new` hacía otra, y
durante una vuelta entera creí tener un hueco donde no lo había — y donde sí lo
tenía (el mensaje del error no se afirmaba en ninguna parte) no me enteré por
ahí. **El nombre de un sabotaje es una afirmación sobre lo que ese `old→new`
hace: si no se puede leer el reemplazo y ver el nombre, está mal uno de los
dos.**

**Un verde en la campaña tiene dos lecturas y hay que separarlas antes de
tocar nada.** O falta un guardián, o el sabotaje no sabotea. Confundirlas cuesta
en las dos direcciones: escribir una prueba para un agujero inexistente, o dar
por cubierto lo que no lo está. La pregunta que las separa es literal: *¿qué
línea del código se comporta distinto después de este reemplazo?* Si no hay
respuesta, el problema es el sabotaje.

**El servidor puede rechazar perfectamente y la pantalla callarse.** El 422
llegaba con la ficha nombrada, no se guardaba nada, y no se pintaba una sola
línea: los dos `<Campo>` de plantilla eran los únicos del fichero sin `error=`.
La causa es que Inertia nombra el error `templates.0.body`, una **ruta con
puntos** que no es una clave del formulario — `form.errors.body` no existe —,
así que hay que leerla como cadena. **Desde la silla del usuario, un rechazo
invisible y un guardado son la misma pantalla.** Ninguna prueba de servidor lo
habría visto: las ocho de feature pasaban.

**Un formulario con campos indexados es un sitio donde mirar.** La regla
general —cada campo pinta su error— la cumplían los treinta y pico `<Campo>` del
fichero; los dos que no eran justo los que vienen de un array, porque su clave
de error no se parece a las demás. Otra vez la forma de los tres lotes
anteriores: la regla se cumple en todas partes menos donde la clave cambia de
forma.

**La vuelta por el navegador va ANTES de dar el lote por cerrado, no después.**
Este hallazgo no salió de la campaña de sabotajes ni de las pruebas: salió de
teclear la ficha ajena y mirar la pantalla. El sabotaje comprueba que lo escrito
está bien atado; abrir la pantalla comprueba que lo escrito es lo que hacía
falta.

## Las notas internas que el transportista leía (`docs/internal-notes.md`)

**Un fichero de pruebas nuevo que escribe y no declara `DatabaseTransactions`
envenena la suite entera, y el fallo sale en otro sitio.** Aquí la convención es
**por fichero**, no global: cada fichero de Feature pone su propio
`uses(DatabaseTransactions::class)`. El mío no lo tenía, así que los datos de
`Scenario::create()` se confirmaban en la base de pruebas en cada vuelta. El
síntoma fue `CustomerAccessTest` fallando con «7 is identical to 1», y luego 223,
y luego 235 — un fichero que yo no había tocado, contando de más. El docblock de
`TestCase` ya describe esta familia de fallo con precisión («las pruebas
siguientes empiezan a contar de más y fallan por sitios que no tienen nada que
ver»); lo que faltaba era leerlo antes. **Cuando una prueba ajena empieza a
contar de más, el sospechoso es el fichero nuevo, no el que falla.**

**Dos suites a la vez sobre la misma base no es «el doble de rápido», es basura
en las dos.** Lancé la segunda vuelta mientras la primera seguía corriendo —
`ps` mostraba tres procesos— y el resultado fue seis fallos que no existían. Una
vuelta tarda ~130 s y no se puede solapar: la base de pruebas es una sola.

**`nohup ... & sleep 150` en una misma orden muere entera con el tiempo de
espera.** El corte a los dos minutos manda SIGTERM al grupo de procesos y se
lleva por delante el proceso de fondo, que deja un fichero de registro vacío y
ninguna pista. Lanzar con `setsid nohup … & disown` en **su propia** llamada, y
consultar en otra.

**El truco de `[a]rtisan` no protege si en la misma orden se lanza eso mismo.**
`ps | grep "[a]rtisan test"` casó con mi propio shell, porque su línea de órdenes
llevaba también el `nohup php artisan test` que estaba lanzando. Es la misma
lección del `pkill -f "artisan serve"` una capa más abajo: **un filtro por cadena
casa con la orden que lo contiene, y los corchetes solo esquivan la copia
literal, no la otra mención.**

**Pint arregla de más, y lo de más no es de este lote.** Correr `pint` sobre un
controlador que arrastra deuda de formato mete en el diff seis líneas de
importaciones y nombres cualificados que no tienen que ver con el hallazgo. La
comprobación que lo cazó fue sacar el fichero original con `git show HEAD:…` en
el Mac y hacer `git diff --no-index` contra mi versión **antes de entregar**.
Revertir a mano lo ajeno cuesta un minuto; explicarlo en un commit sobre una fuga
de confidencialidad, mucho más. **Antes de entregar, el diff se mira: no basta
con saber lo que uno quiso cambiar.**

**`?? 'ausente'` no distingue «falta la clave» de «vale null».** Escribí
`expect($props['carrier']['notes'] ?? 'ausente')->toBeNull()` para comprobar que
el campo venía vacío, y falló: `null ?? 'ausente'` es `'ausente'`, o sea que la
prueba no podía pasar nunca. Para «la clave está y vale null» son dos
aserciones: `assertArrayHasKey` y luego `toBeNull`.

## La base de la tarifa que sí reescribía (`docs/fee-base-frozen.md`)

**Un hallazgo de segunda mano se mide antes de creérselo — y también antes de
descartarlo.** Este defecto me llegó como informe de un barrido: «la base se lee
viva». La primera medición dijo que NO, que la carga conservaba lo suyo. Estuve
a punto de darlo por falso. Lo que pasaba es que `TenantPolicy::for()` tiene
**caché estática por proceso**: dentro de una misma prueba, la segunda petición
reutilizaba la política de la primera, cosa que en producción —un proceso por
petición— no ocurre. Con `TenantPolicy::forget()` en medio, el defecto apareció
entero. **Una caché estática convierte una medida en un espejismo, en las dos
direcciones: puede esconder un fallo y puede inventarlo.**

**Y ni siquiera entonces se movía el dinero.** La segunda medición mostró la
base cambiando de nombre con todas las cifras idénticas, porque las dos bases
solo se separan cuando hay gastos **excluidos**. Hizo falta plantar un gasto
excluido para que el fallo enseñara lo que costaba: $100 menos al transportista.
**Un cambio que no mueve la cifra en el caso simple no es un cambio inocuo: es
un cambio cuyo caso hay que construir.**

**Un guardián que comprueba que algo se MENCIONA no comprueba que funcione.**
Escribí `assertStringContainsString('FeeBase::CarrierGross=>', $fuente)` y un
sabotaje que cambiaba `FeeBase::CarrierGross => $carrierGrossRate` por
`=> $commissionableBase` salió VERDE: el caso seguía mencionado, y las dos bases
pasaban a dar la misma cifra — o sea, congelar la base dejaba de servir de nada
sin que nada se pusiera rojo. La prueba que faltaba es de comportamiento y con
números exactos: $300 sobre la base comisionable, $400 sobre el bruto. **Cuando
la aserción es sobre el fuente, hay que preguntarse qué reemplazo la deja en pie
sin hacer lo que promete.**

**Editar el fichero de una migración ya aplicada no sabotea nada.** El otro
verde de la campaña cambiaba el `CHECK` en el fichero de la migración; la prueba
lee `information_schema`, que refleja lo que se aplicó, no lo que pone el
fichero. El sabotaje de verdad era **añadir un caso a la enumeración** y ver si
algo se quejaba — que además es el riesgo real: un valor nuevo sin `CHECK` y sin
cálculo. Cazado por dos pruebas a la vez. **Un sabotaje sobre un fichero que el
sistema ya no vuelve a leer es siempre inerte.**

**Una lista de columnas clavada en una prueba es un guardián que funciona, y
avisa a quien añade una.** `CalculatorTest` fija las columnas exactas de
`financial_snapshots` «por si el esquema gana una y esta lista no». Gané una y
la prueba se puso roja en la vuelta completa. No era un fallo: era el guardián
haciendo su trabajo sobre mí.

**Una función de otro fichero de pruebas no existe hasta que ese fichero se
carga.** `loadPayload()` vive en `LoadFormTest.php`; llamarla desde un fichero
nuevo da «Call to undefined function» al ejecutarlo solo, y funciona cuando se
ejecuta la suite entera. Es una prueba que pasa o falla según con quién la
ejecuten. Cada fichero se lleva la suya.

## El periodo cerrado que cambiaba cada día (`docs/aging-as-of.md`)

**0 de 14 no son catorce agujeros: es el arnés apuntando a otro sitio.** La
campaña salió entera en verde. Catorce guardianes ausentes a la vez es
imposible, y esa imposibilidad es el dato. Había construido el arnés nuevo con
un `sed` sobre el ANTERIOR, con un patrón sacado del de en medio, así que la
sustitución no casó con nada y `TESTS` seguía apuntando a las pruebas del lote
pasado —que pasan hagas lo que hagas en `PeriodReport`—. **Un resultado
uniforme en una campaña de sabotajes es una avería del arnés hasta que se
demuestre lo contrario; lo primero que hay que mirar es qué pruebas está
ejecutando de verdad.** Copiar un arnés de un lote a otro con `sed` sin
comprobar la línea resultante es la forma barata de perder una vuelta entera.

**Todas las pruebas en verde a la primera es una señal, no un premio.** Las diez
de feature pasaron sin un solo ajuste. Eso puede querer decir que el arreglo
está bien o que las pruebas no pueden fallar, y las dos se parecen mucho desde
fuera. Lo que las separa es la campaña de sabotajes, y por eso va después y no
antes de dar nada por hecho.

**Un guardián que busca una cadena «en alguna parte del fichero» se conforma con
que sobreviva UNA de sus apariciones.** Puse la fecha en dos sitios de la
pantalla —el contador y el título de la sección— y comprobé
`assertStringContainsString("t('reports.aging.asOf'", $fuente)`. Quitarla del
título salió verde: seguía estando en el contador. Con dos sitios, la aserción
es `substr_count(...)->toBe(2)` más una comprobación del sitio concreto.

**Una aserción sobre el importe no cubre el contador que va al lado.** El
sabotaje que quitaba el corte `if ($saldo <= 0) continue;` salió verde porque yo
comprobaba `pendiente === 0` y una factura saldada suma cero… pero incrementa el
contador de su tramo. La cartera habría dicho «$0 en 1 factura», que manda a
buscar una factura que no debe nada. **Donde la pantalla enseña importe Y
número, la prueba tiene que mirar los dos.**

**El caso que un sabotaje destapa suele ser el que la prueba nunca construyó.**
De los tres verdes de la segunda vuelta, ninguno era un guardián mal escrito por
descuido: eran tres situaciones que no había en las pruebas —un cheque sin
compensar, una factura ya saldada, la fecha en dos sitios—. La campaña no
comprueba el código: comprueba el **catálogo de casos** que uno se ha molestado
en construir.

## El plazo de aviso que dos pantallas ignoraban (`docs/expiry-window.md`)

**Un defecto ya encontrado, arreglado y documentado puede seguir vivo en dos
sitios más.** El docblock de `DocumentController::warnDays()` describía este
mismo fallo con precisión, nombraba los cuatro sitios que tenían que contestar
lo mismo, y explicaba por qué. Se aplicó en un controlador y ahí se quedó.
**Cuando un docblock explica un defecto de clase —«esto era una constante y
tenía que salir del ajuste»—, la pregunta siguiente no es si está arreglado
aquí, sino dónde más vive esa constante.** Un `grep` de treinta segundos habría
encontrado los otros dos el mismo día.

**La prueba se escribe para las pantallas que se arreglan, y el sabotaje
pregunta por la que se refactoriza.** De los dos verdes de la campaña, uno era
Documentos: la única de las tres que ya funcionaba, y por tanto la única que
este lote podía romper sin que nadie lo notara. No la había probado porque «esa
ya estaba bien». **La pantalla que más necesita una prueba en un lote de
unificación es la que ya funcionaba.**

**Una insignia en una fila es una pantalla más.** El otro verde dejaba el filtro
y el contador correctos y la etiqueta de la fila con su propia regla. Yo había
probado los dos primeros porque son los que devuelven números; la insignia es lo
que el despachador mira de verdad al pasar la lista. **Filtro, contador y
etiqueta son tres promesas distintas aunque salgan del mismo número.**

**Una aguja de sabotaje con menos sangría casa también dentro de la de más
sangría.** `"        $limit = ..."` (8 espacios) está contenido literalmente en
`"            $limit = ..."` (12), así que `count()` dio 2 y la validación
abortó la campaña entera antes de empezar. Es un buen fallo: abortó en vez de
sabotear el sitio equivocado. **Un ancla se ensancha con la línea de al lado, no
con espacios.**

**`?? 'ausente'` otra vez, y van dos lotes.** Vuelvo a escribir
`expect($x['clave'] ?? 'ausente')->toBeNull()` para comprobar «la clave está y
vale null», y vuelve a ser imposible de pasar. Para eso son dos aserciones:
`assertArrayHasKey` y luego `toBeNull`. Lo dejo escrito por segunda vez porque
al parecer hace falta.

**Un ayudante estático que lee la empresa activa no funciona fuera de una
petición.** `ExpiryWindow::days()` resuelve por `TenantContext`, y llamarlo
suelto en una prueba devolvió 30 —el valor por defecto de la política— en vez de
los 20 que acababa de fijar. No era un fallo del cálculo: era que no había
empresa. Las llamadas directas van dentro de `runAs($tenantId, …)`.

## El visto verde que se guardó el día que se guardó (`docs/live-checklist.md`)

**Un fichero de depuración de cinco líneas también envenena la base de
pruebas.** Escribí un `DbgTest.php` para volcar los props de una pantalla, lo
borré a los dos minutos, y no le puse `uses(DatabaseTransactions::class)`.
Dejó una empresa, un cliente y dos transportistas confirmados, y el fallo salió
—dos lotes después de aprender esta misma lección— en `CustomerAccessTest`
contando 2 donde esperaba 1. **La regla no es «los ficheros de prueba llevan el
trait»: es que cualquier código que llame a `Scenario::create()` lo lleva,
aunque vaya a vivir dos minutos.**

**Un sabotaje que añade una clave repetida a un array de PHP no sabotea nada.**
Para probar que la fila de FMCSA no puede pasar por bloqueante, inserté
`'blocking' => true,` ANTES del `'blocking' => false` que ya estaba. En PHP gana
la última, así que el array salía idéntico. Salió verde y por un momento pareció
un guardián ausente. El de verdad cambia el valor que ya existe. **Antes de
creerse un verde, hay que poder decir qué línea del programa se comporta
distinto — y con un array literal, «he añadido una clave» no es respuesta.**

**Cortar un método por su nombre y quedarse con el resto del fichero mete
dentro los métodos de abajo.** Un guardián que comprobaba que `checklist()` no
lleva tipos de documento escritos a mano se disparó con un `'carrier_agreement'`
que vive en `firmaDelAcuerdo()`, tres métodos más abajo. Lo escribí como
`substr($fuente, strpos($fuente, 'function checklist('))`, que llega hasta el
final del fichero. **Un corte por firma necesita las dos fronteras**, y el
ayudante que las pone se reutiliza.

**Quitar una columna pone rojas las pruebas que la vigilaban, y eso es una
buena noticia.** `OnboardingQueueTest::no guarda ninguna lista de comprobación`
comprobaba que la columna se quedara vacía. Al quitarla, se rompió. La
tentación es borrar la prueba; lo correcto es **repuntarla a lo que ahora hay
que sujetar** —que la columna no vuelva a existir—, porque la intención que la
hizo nacer sigue viva aunque su mecanismo haya cambiado.

**Los props de Inertia no siempre están donde uno cree.** Busqué la lista en
`props.carrier.onboarding` y era `props.onboarding`, una prop de primer nivel.
Tres pruebas fallaron con «la tarjeta no llega a la pantalla», que suena a
defecto del servidor y era una ruta mía equivocada. Volcar las claves del props
una vez cuesta treinta segundos y ahorra ese desvío.

## «Se le avisará 45 días antes» (`docs/durations-in-copy.md`)

**Unificar un número en el código no lo unifica en el texto, y el guardián que
escribí no miraba ahí.** El lote anterior llevó el plazo de aviso a un solo
sitio y dejó `«45 días»` escrito en el diccionario, en los dos idiomas. Mi
guardián comprobaba que la clave del ajuste existiera; comprobar que existe una
etiqueta no es comprobar que el texto diga la verdad. **Cuando un lote unifica
una fuente de verdad, el barrido siguiente es el diccionario: un número en la
copia es una copia del cálculo.**

**Un sabotaje del propio fichero de pruebas siempre sale verde, y eso no es un
hueco.** Dos de los nueve desactivaban la condición del guardián o le hacían
mirar un solo idioma. Ninguna prueba caza que alguien desarme esa misma prueba.
La tentación es construir una prueba que vigile a la prueba, y de ahí no se
sale. Se retiran del catálogo y se dice por qué. **La campaña mide el código,
no la lealtad del fichero que lo mide.**

**El tercero de esa familia sí valía, y conviene saber distinguirlos.** Meter la
clave recién arreglada en la lista de excepciones del guardián NO es tocar el
mecanismo de la prueba: es el movimiento natural del que se encuentra la prueba
roja y quiere seguir. Eso se caza con una lista de **prohibidas** —claves que no
pueden declararse fijas nunca, con su motivo—. **La diferencia es si el sabotaje
imita algo que alguien haría de buena fe: si sí, hay que cazarlo; si es
vandalismo del fichero, no.**

**Una lista de excepciones necesita dos comprobaciones propias.** Que sus claves
sigan existiendo —una excepción que nombra una clave borrada tapa a la siguiente
que se llame igual— y que no crezca: pasado cierto tamaño ha dejado de ser una
lista de excepciones y es la regla nueva.
