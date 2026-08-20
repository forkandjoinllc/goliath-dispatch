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

## Estado: parte de la suite NUNCA se ha ejecutado

Esto hay que decirlo antes que nada.

Los ficheros de `tests/Feature/Carriers`, `tests/Feature/Customers`,
`tests/Feature/Loads`, `tests/Unit/Customers`, `tests/Unit/Finance`,
`tests/Unit/Support` y `tests/Unit/I18n/NavigationLabelsTest`
se escribieron en un entorno donde **Pest no se puede instalar**: composer exige
autenticarse contra GitHub para las dependencias de desarrollo, y ese entorno no
podía hacerlo. Llevan un aviso en su cabecera.

Lo que sí está comprobado, y conviene distinguirlo:

| Qué | Cómo se comprobó |
|---|---|
| El comportamiento que afirman | A mano, con peticiones HTTP reales y con navegador, contra la aplicación en marcha |
| Que las 16 rutas que usan existen | Resolviéndolas contra el enrutador |
| Que los componentes Inertia existen | Comprobando los ficheros en `resources/js/pages` |
| Que las columnas consultadas existen | `Schema::hasColumn` sobre las 9 tablas implicadas |
| Que las clases y métodos existen | `class_exists` / `method_exists` |
| Los valores de `NameKeyTest` | Llamando a `NameKey::for()` con cada par del dataset |
| Las aserciones de `NavigationTest` | Ejecutando `Navigation::for()` con los seis roles |
| **Las 26 aserciones de `CalculatorTest`** | Ejecutando `Calculator` y `Money` con cada caso, una por una |
| Las del grafo en `LoadTransitionTest` | Ejecutando `Transitions` con los trece estados |
| Las claves de `loads.blocking.*` | Comprobadas en los dos diccionarios |
| Sintaxis PHP | `php -l` sobre cada fichero |

Lo que **no** está comprobado es la mecánica de Pest: la firma exacta de una
aserción, un `->with()` mal formado, un helper que no existe en la versión
instalada.

**Al ejecutarlas por primera vez, distinga los dos tipos de fallo.** Si algo se
rompe por la FORMA —método desconocido, aserción con otra firma— es una errata
mía y se arregla. Si algo falla por el VALOR esperado, eso sí es una regresión
de verdad y hay que mirarla.

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
  se comprobó cargando el fichero a mano. Con `composer install` completo, se
  resuelve solo.
