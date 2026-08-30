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
OK (872 tests, 6081 assertions)
```

(Cifra del 30 de agosto, tras el lote de firmas.
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
