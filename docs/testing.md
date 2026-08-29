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

## Estado: qué se ha ejecutado y qué no

La suite **se ejecutó y quedó en verde** el 25 de agosto de 2026:

```
Tests:  433 passed (3187 assertions)
```

Antes de eso, buena parte se había escrito sin poder ejecutarse. Aquel primer
arranque dejó una lección que conviene conservar, porque no es la que se espera:
de los 119 fallos iniciales, **uno solo** era un defecto de la aplicación —los
milisegundos que se perdían en las escrituras crudas, hoy resueltos con
`App\Support\Database\MillisecondGrammar`—. El resto eran defectos de las
propias pruebas: dos fallos en `signIn()`, diez `assertForbidden()` mal puestas,
un fixture al que le faltaban documentos obligatorios y varios números mágicos
caducados. Dos fallos que parecían agujeros de seguridad resultaron ser efectos
del segundo defecto de `signIn()`.

### Lo que se ha añadido DESPUÉS y no he ejecutado nunca

Estos once ficheros son posteriores a aquel arranque en verde:

```
tests/Feature/Carriers/CarrierContactsTest.php
tests/Feature/Documents/UsedDocumentTypesTest.php
tests/Feature/Factoring/FactoringTest.php
tests/Feature/Finance/InvoiceTest.php
tests/Feature/Finance/SettlementTest.php
tests/Feature/Fleet/DriverQualificationTest.php
tests/Feature/Fmcsa/CarrierLookupTest.php
tests/Feature/Geo/CountryStateTest.php
tests/Feature/Loads/LoadRequirementsTest.php
tests/Unit/Geo/RegionParityTest.php
tests/Unit/Loads/DriverEligibilityTest.php
```

Más los retoques a `SchemaAgreementTest` (el recuento de modelos) y a
`NavigationTest`.

**No los he ejecutado ni una vez.** El entorno donde se escriben no alcanza
packagist, así que no hay `vendor/`, y sin `vendor/` no hay `artisan` ni Pest.
Eso no ha cambiado.

### Lo que sí se comprueba antes de entregar cada lote

| Qué | Cómo |
|---|---|
| Sintaxis PHP | `php -l` sobre cada fichero tocado |
| Tipos de TypeScript | `tsc --noEmit` sobre cada `.tsx` tocado |
| Paridad de diccionarios | EN y ES comparados clave a clave |
| Claves usadas y no traducidas | Extraídas del TSX y del PHP y cruzadas con el diccionario |
| **El DDL de cada migración** | Ejecutado contra un **MySQL 8.0.46 real** con los quince ficheros del esquema cargados: 93 tablas, 47 triggers, 246 claves foráneas |
| Que la migración se pueda reanudar | Ejecutada desde cero, sobre lo ya aplicado, y desde estados a medias |
| Que el instalador del lote acierte | Aplicado sobre una copia limpia y comparado byte a byte; y ejecutado dos veces para comprobar que es idempotente |

Ese banco de MySQL existe desde el lote 18, y nació de un fallo: el lote 15
tumbó un despliegue con un `ERROR 1215` que se reproduce en segundos con la base
delante. Ver más abajo.

### Al ejecutar los once, distinga los dos tipos de fallo

Si algo se rompe por la **forma** —un método que no existe, una aserción con
otra firma, un fixture al que le falta un campo obligatorio del escenario— es
una errata mía y se arregla en el fichero de pruebas. Si algo falla por el
**valor esperado**, eso sí merece mirarse: puede ser una regresión de verdad.

La proporción del primer arranque (118 de 119 fallos eran de las pruebas, no de
la aplicación) sugiere qué esperar, pero no lo garantiza.

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
