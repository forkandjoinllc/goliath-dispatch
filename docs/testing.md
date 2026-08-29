# Pruebas

## Cómo se ejecutan

```bash
composer install                 # con dependencias de desarrollo
php artisan migrate --env=testing # crea goliath_l_test la primera vez
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
OK (632 tests, 4300 assertions)
```

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
