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
OK (1228 tests, 7520 assertions)
```

(Cifra del 2 de septiembre, tras el lote de los sitios del cliente.
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
