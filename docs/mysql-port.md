# Port de PostgreSQL a MySQL 8.0

Mapeo autoritativo para la migración de Goliath Dispatch de PostgreSQL/Drizzle a
MySQL/Eloquent. Cada regla de aquí fue **verificada ejecutándola** contra MySQL
8.0.46, no inferida de la documentación.

## Resumen de la verificación

| Característica PostgreSQL | Reemplazo en MySQL | Verificado |
|---|---|---|
| `pgEnum` | `varchar` + `CHECK (col IN (...))` | Acepta válidos, rechaza inventados |
| `JSONB` | `JSON` | Extracción con `json_extract` funciona |
| `timestamptz` | `datetime(3)` en UTC | Ver §Fechas |
| Índice único parcial | Columna generada `STORED` + índice único | Semántica completa, incluido soft delete |
| Trigger plpgsql genérico | Trigger explícito por tabla con `SIGNAL` | `UPDATE`/`DELETE` rechazados |
| `FOR UPDATE SKIP LOCKED` | Idéntico | Soportado en 8.0 |
| `uuid` | `char(36)` | Ver §Claves |
| FK de una columna | FK compuesta `(tenant_id, padre_id)` | `ERROR 1452` en INSERT y UPDATE cruzados |
| — | Triggers de guarda para las `SET NULL` | Rechaza el cruce; el `SET NULL` sigue funcionando |

## Requisito de versión

**MySQL 8.0.16 o superior.** Antes de esa versión MySQL *acepta* la sintaxis
`CHECK` y la ignora silenciosamente, lo que convertiría cada restricción de enum
y cada guarda de dinero no negativo en decoración. Forge instala 8.0 por
defecto; el servidor `fleetforce` corre 8.0.46.

## Claves

`char(36)` con UUID v4, mediante el trait `HasUuids` de Laravel.

`binary(16)` sería un 55% más compacto y produciría índices más rápidos, pero
vuelve ilegible cualquier consulta manual, cualquier volcado y cualquier línea
de log — y en un sistema donde la depuración pasa por leer una pista de
auditoría, esa legibilidad vale más que los bytes.

Toda tabla propiedad de un tenant lleva además:

```sql
unique key <tabla>_tenant_id_uq (tenant_id, id)
```

No es redundante con la primaria: es lo que permite que un hijo referencie
`(tenant_id, id)` del padre y que el trigger de guarda pueda comparar.

## Fechas

**`datetime(3)`, siempre en UTC. Nunca `timestamp`.**

Laravel genera columnas `timestamp` con `$table->timestamps()`. En MySQL el tipo
`timestamp` se agota en **2038-01-19**. Este sistema guarda registros
financieros con retención de siete años, permisos con fecha de vencimiento y
citas de entrega programadas a futuro; una fecha de 2039 es un dato normal, no
un caso extremo. Por eso las migraciones declaran las columnas de fecha
explícitamente:

```php
$table->dateTime('created_at', 3)->useCurrent();
$table->dateTime('updated_at', 3)->useCurrent()->useCurrentOnUpdate();
```

MySQL no tiene equivalente de `timestamptz`: no guarda la zona. La aplicación
almacena UTC y resuelve la zona al presentar. Esto importa especialmente en las
paradas de carga, donde la cita se muestra en la zona local de la instalación y
no en la del tenant.

## Dinero

`bigint` **con signo**, en centavos.

Sin signo sería tentador, pero el margen bruto y la liquidación neta pueden ser
legítimamente negativos: una carga que se vendió por debajo del costo, o un
transportista cuyas deducciones exceden su tarifa. Las restricciones
`CHECK (col >= 0)` se aplican solo donde el valor no puede ser negativo por
definición — el cargo al cliente, la tarifa bruta, el monto de un gasto.

Los porcentajes son puntos base (`int`), con `CHECK (col BETWEEN 0 AND 10000)`.

## Enumeraciones

`varchar(n)` con una restricción `CHECK`, más un enum de PHP como fuente de
verdad en la aplicación y un cast de Eloquent.

MySQL tiene un tipo `ENUM` nativo, pero agregarle un valor requiere reescribir
la tabla (`ALTER TABLE ... MODIFY COLUMN`), que sobre una tabla de cargas grande
significa bloqueo y minutos de espera. Con `varchar` + `CHECK`, agregar un
estado es soltar y recrear una restricción: instantáneo.

## Colaciones

El esquema usa `utf8mb4_0900_ai_ci` por defecto — insensible a mayúsculas y
acentos, correcto para nombres de empresas y búsquedas de texto.

**Excepción:** las columnas que guardan hashes, tokens y huellas digitales se
declaran `char(64) charset ascii collate ascii_bin`. Son hexadecimal, así que
`ascii` basta, y `_bin` las hace sensibles a mayúsculas — una colación `ai_ci`
trataría dos hashes que difieren solo en el caso como el mismo valor, lo que en
un índice único de tokens de sesión sería un defecto de seguridad, no una
comodidad.

## Índices únicos parciales

PostgreSQL permite `unique index ... where <predicado>`. MySQL no. El reemplazo
es una columna generada que vale `NULL` cuando el predicado no se cumple —y
MySQL no considera los `NULL` como duplicados— más un índice único sobre ella:

```sql
primary_contact_key char(36) as (
  case when is_primary = 1 and deleted_at is null then customer_id end
) stored,
unique key customer_contacts_primary_uq (primary_contact_key)
```

Verificado: acepta el primer principal, rechaza el segundo del mismo cliente,
permite cuantos no-principales haga falta, y libera el hueco cuando el
principal se borra en suave.

`STORED` y no `VIRTUAL`: un índice único sobre una columna virtual funciona,
pero se recalcula en cada lectura del índice, y esta se consulta en cada
escritura de contacto.

### Una restricción de InnoDB que condiciona el patrón

Una columna generada `STORED` **no puede leer una columna que sea hija de una
clave foránea con `ON DELETE CASCADE` o `SET NULL`** — InnoDB responde
`ERROR 1215`. Como casi todas las claves naturales de este esquema empiezan por
`tenant_id`, que sí es hija de un cascade, la expresión generada no puede
incluirlo.

La solución es no meterlo: la columna generada cubre **solo** la parte no-FK, y
las columnas FK entran en el índice como columnas normales al frente:

```sql
live_dot_key varchar(12) as (case when deleted_at is null then dot_number end) stored,
unique key carriers_tenant_dot_uq (tenant_id, live_dot_key)
```

Es equivalente para la unicidad (un `NULL` en cualquier posición de un índice
único hace que MySQL no compare la fila) y no cuesta nada.

### Divergencia deliberada respecto al origen PostgreSQL

El esquema Drizzle original **no tenía ningún índice único parcial**: todas sus
claves naturales eran únicas absolutas. Eso significa que en la app Next.js,
borrar en suave un carrier quemaba su número USDOT para siempre — el tenant no
podía volver a darlo de alta ni corrigiendo el error. Lo mismo con el email de
un usuario, el VIN de un camión, el número de unidad de un trailer y la licencia
de un conductor.

Este port lo corrige en 13 índices, los que identifican algo que un tenant
legítimamente reutiliza:

| Tabla | Índice |
|---|---|
| `carriers` | `carriers_tenant_dot_uq` |
| `users` | `users_email_normalized_uq` |
| `trucks` | `trucks_tenant_vin_uq`, `trucks_tenant_carrier_unit_uq` |
| `trailers` | `trailers_tenant_vin_uq`, `trailers_tenant_carrier_unit_uq` |
| `drivers` | `drivers_tenant_license_hash_uq` |
| `tenants` | `tenants_slug_uq`, `tenants_custom_domain_uq` |
| `dispatcher_groups` | `dispatcher_groups_tenant_name_uq` |
| `equipment_types` | `equipment_types_tenant_code_uq` |
| `expense_categories` | `expense_categories_tenant_code_uq` |
| `factoring_companies` | `factoring_companies_tenant_name_uq` |

Los que **no** se tocan, a propósito: números de factura, de carga y de
liquidación, tokens, hashes de acceso, ids de Stripe y claves de snapshot. Ahí
reutilizar un valor tras un borrado rompería la pista de auditoría, y la unicidad
absoluta es la conducta correcta.

## Sesiones: el choque con Laravel

Laravel es dueño del nombre de tabla `sessions` y escribe en ella en cada
petición cuando `SESSION_DRIVER=database`. El origen PostgreSQL traía su propia
tabla `sessions` (token opaco + `token_hash` sha256). Mantener las dos habría
dejado dos almacenes de sesión en paralelo sin una autoridad única sobre
`active_tenant_id`, así que gana la forma de Laravel y se le añaden las cuatro
columnas que el dominio necesita: `active_tenant_id`, `mfa_satisfied_at`,
`revoked_at` y `revoked_reason`.

El coste, dicho sin adornos: Laravel guarda el id de sesión en claro, no
hasheado. La protección es la cookie cifrada con `APP_KEY`. Una lectura de la
base de datos por sí sola sigue devolviendo un id de sesión utilizable, cosa que
el diseño hasheado impedía. Se compensa comprobando `revoked_at` en cada
petición autenticada, de modo que la revocación es inmediata.

Consecuencias en cadena:

- `sessions.id` es `varchar(255)` (Laravel genera 40 caracteres aleatorios, no
  un UUID), y `impersonation_sessions.session_id` iguala esa anchura.
- `last_activity` es un `int` de segundos Unix — convención de Laravel, y la
  columna que barre el recolector de sesiones.
- `users.password_hash` pasa a llamarse `password` y se añade `remember_token`:
  son los nombres que leen el contrato `Authenticatable` y Fortify.
- Se añade `password_reset_tokens` para el password broker. `verification_tokens`
  cubre un superconjunto de flujos, pero Fortify espera esa tabla exacta.
- **No** se usan las columnas `two_factor_*` de Fortify: el MFA vive en
  `mfa_configurations`, que ya modela más de lo que Fortify ofrece. La función
  `twoFactorAuthentication` de Fortify queda desactivada.

## Triggers

Dos familias, ambas con `SIGNAL SQLSTATE '45000'`.

**Inmutabilidad append-only** para `audit_events`, `signature_audit_events`,
`load_status_history` y `financial_snapshots`. En PostgreSQL era una única
función plpgsql aplicada en bucle sobre una lista de tablas. MySQL no permite
SQL dinámico dentro de un trigger, así que cada tabla lleva su par explícito
`before update` / `before delete`. Más verboso; misma garantía.

**Guardas de aislamiento entre empresas** para las 17 relaciones
`ON DELETE SET NULL`: el trigger lee el `tenant_id` del padre y aborta si no
coincide. Las otras 78 relaciones no necesitan trigger — se resuelven con claves
foráneas compuestas, que es mejor. Ver §Aislamiento entre empresas.

En las migraciones se aplican con `DB::unprepared()`, que acepta el bloque
`BEGIN ... END` completo como una sola sentencia. `DELIMITER` es un comando del
cliente `mysql` y no existe vía PDO.

## Aislamiento entre empresas

El origen PostgreSQL usaba claves foráneas de una sola columna en todas partes.
Portadas literalmente, dejan un hueco real: nada impide que una carga del tenant
A apunte a un camión del tenant B. El scope global de Eloquent lo evita en la
práctica, pero es una sola capa, y el requisito dice que el aislamiento se impone
también en la base de datos.

Hay 95 relaciones hijo→padre con `tenant_id` a ambos lados. Se cubren en dos
formas, ambas en `database/schema/85_cross_tenant_isolation.sql`:

**78 con clave foránea compuesta.** Cada tabla con tenant ya llevaba una clave
única `<tabla>_tenant_id_uq (tenant_id, id)` — existe precisamente para poder
referenciarla. La FK pasa a ser:

```sql
foreign key (tenant_id, carrier_id) references carriers (tenant_id, id)
```

InnoDB rechaza la fila cruzada por sí solo, en `INSERT` y en `UPDATE`, sin
código. Verificado: `ERROR 1452` en ambos casos, y la fila con el tenant correcto
entra.

**17 con trigger.** Son las `ON DELETE SET NULL`. Una FK compuesta intentaría
poner `tenant_id` a NULL al borrar el padre, y `tenant_id` es `NOT NULL`. Así que
ahí se conserva la FK de una columna (que sigue haciendo su `SET NULL`) y se
añade un par de triggers `before insert` / `before update` que comprueban lo
único que la FK no puede: que el padre sea del mismo tenant. Verificado: rechaza
el cruce en inserción y en actualización, y borrar el padre sigue dejando la
columna a NULL.

Detalle de implementación: al soltar una FK, MySQL conserva con el mismo nombre
el índice que había creado para ella, de modo que reutilizar el nombre da
`ERROR 1061`. La FK compuesta lleva sufijo `_xt`; el índice de una columna se
queda y sigue sirviendo para las búsquedas por esa columna sola.

Esto es una capa **añadida**, no un sustituto: el scope global de Eloquent sigue
siendo la primera línea, porque la base de datos impide escribir mal pero no
impide *leer* de más.

## Lo que se pierde

Honestamente, tres cosas:

1. **`CHECK` con subconsultas.** PostgreSQL tampoco las permite, pero sus
   constraints de exclusión sí resolvían el solapamiento de compromisos de
   equipo. En MySQL la detección de conflictos de horario queda enteramente en
   la capa de aplicación, respaldada por pruebas.
2. **Índices `GIN` sobre JSON.** MySQL indexa JSON solo a través de columnas
   generadas. Donde había búsqueda sobre `jsonb`, ahora hay una columna
   generada explícita e indexada.
3. **Transacciones DDL.** PostgreSQL puede revertir un `ALTER TABLE`; MySQL no.
   Una migración que falla a mitad deja el esquema a medias, así que las
   migraciones se escriben cortas y con un `down()` que realmente revierte.

## Fase 2: modelos, autorización y autenticación

### El catálogo de permisos se portó de forma mecánica

115 permisos × 6 roles son 263 concesiones. Transcribirlas a mano habría
metido erratas invisibles: un permiso con ámbito `tenant` donde debía ir
`assigned` no rompe nada, solo deja ver de más. Así que se convirtieron con un
script y luego se comprobó al revés — se vuelve a leer
`src/lib/permissions/catalog.ts` y se compara clave a clave, descripción a
descripción, ámbito a ámbito, contra el PHP ya escrito en disco. La prueba está
en `tests/Unit/Authorization/PermissionCheckerTest.php`.

Dos comprobaciones de integridad que valen la pena:

- toda clave que concede un rol existe en el catálogo;
- todo permiso del catálogo lo concede al menos un rol (un permiso huérfano es
  código muerto o un agujero: alguien lo comprueba y nadie puede pasarlo).

### El contexto de empresa lanza en vez de devolver vacío

`TenantScope` estrecha toda consulta a la empresa activa. Cuando NADIE ha dicho
en nombre de qué empresa se trabaja, la consulta **lanza**
`MissingTenantContextException`.

Devolver cero filas habría sido la opción cómoda, y es la equivocada: un informe
que olvida el contexto sale vacío y parece decir "no hay datos". Ese error se
descubre en producción, con un contable mirando una pantalla en blanco. Lanzando,
se descubre en la primera prueba.

Las dos vías de escape son explícitas y visibles en un diff:
`TenantContext::runAs($tenantId, ...)` y `TenantContext::withoutTenant(...)`.
La segunda es para plataforma y mantenimiento; usarla para que una consulta
"deje de fallar" convierte un olvido en una fuga.

### Los 92 modelos se generaron desde information_schema

Nada de escribir 1.800 columnas a mano. Los `casts` salen del tipo real de cada
columna, los enums se emparejan comparando la lista de valores de cada `CHECK`
con los `case` de cada enum de PHP (coincidencia exacta del conjunto, no por
nombre), y las relaciones salen de las 246 claves foráneas —incluido `hasOne` en
vez de `hasMany` cuando la columna del hijo tiene índice único.

Después, la prueba hace el camino contrario: comprueba que lo que los modelos
DICEN sigue existiendo en la base de datos. Eso convierte al generador en un
contrato en vez de una foto de un momento.

Dos cosas que solo aparecieron al ejecutar:

- **`load()` choca con Eloquent.** Una carga de flete es un `load`, y
  `Model::load()` es la carga diferida de relaciones. Una relación llamada
  `load()` no lo sobrescribe: PHP lanza un error fatal de firma incompatible. Se
  renombró a `freightLoad()` en los 20 modelos afectados, resolviendo por
  **nombre reservado** y no por lista de tablas, para que un futuro `save_id` se
  detecte igual.
- **InnoDB y las columnas generadas.** Una columna `STORED` no puede leer una
  columna que sea hija de una FK con `ON DELETE CASCADE` (`ERROR 1215`). Como
  casi toda clave natural empieza por `tenant_id`, la expresión generada cubre
  solo la parte no-FK y `tenant_id` entra en el índice como columna normal. Ver
  §Índices únicos parciales.

### Autenticación: qué se cambió de Fortify y por qué

- **`authenticateUsing` propio.** La tabla `users` portada trae política de
  bloqueo, estado de cuenta y correo normalizado, y el `attempt()` por defecto no
  conoce nada de eso.
- **El orden de las comprobaciones es deliberado.** Primero el bloqueo por
  intentos, ANTES de verificar la contraseña: si se verificase primero, los
  ~200 ms de bcrypt dirían si la cuenta existe. Después la contraseña, siempre,
  contra un hash de relleno real cuando el usuario no existe. Y solo al final el
  estado de la cuenta: decirle "está suspendida" a quien no sabe la contraseña
  confirmaría que la cuenta existe.
- **La empresa activa se fija en `LoginResponse`, no escuchando el evento
  `Login`.** El evento se dispara dentro de `Auth::login()` y Fortify regenera el
  id de sesión DESPUÉS, en `PrepareAuthenticatedSession`. Un listener escribiría
  en la fila que la regeneración deja atrás. El síntoma es `active_tenant_id` en
  NULL sin ningún error, que es exactamente lo que pasó antes de moverlo.
- **Y hace falta `$request->session()->save()` antes de tocar las columnas.**
  `StartSession` guarda la sesión al final de la petición: sin ese `save()` la
  fila todavía no existe, el `UPDATE` afecta a cero filas y Laravel inserta
  después una fila limpia. Mismo síntoma silencioso.
- **Con varias empresas no se elige ninguna.** Adivinar significaría enseñarle a
  alguien los datos de la empresa equivocada.
- **`twoFactorAuthentication` de Fortify está desactivado.** Guarda el secreto en
  columnas de `users`; nuestro MFA vive en `mfa_configurations`, con varios
  métodos por usuario, y se satisface **por sesión**
  (`sessions.mfa_satisfied_at`), que es lo que permite exigir step-up en una
  acción concreta.
- **El registro público no pasa por Fortify.** Crear una cuenta aquí es crear una
  EMPRESA, con plan y suscripción. Eso es un asistente, no un formulario de dos
  campos.

### Las pruebas corren contra MySQL, no SQLite

`phpunit.xml` apunta a `goliath_l_test` con `DB_CONNECTION=mysql` y
`SESSION_DRIVER=database`. El esquema son 15 ficheros de DDL MySQL en crudo:
columnas generadas `STORED`, `CHECK`, triggers con `SIGNAL`, claves foráneas
compuestas. SQLite no ejecuta nada de eso, así que una suite sobre SQLite
probaría un esquema que no es el que se despliega. Y con el driver de sesión
`array`, las columnas `active_tenant_id` y `mfa_satisfied_at` no existirían en
ningún sitio.

No se usa `RefreshDatabase`: construir las 99 tablas cuesta unos seis segundos, y
hacerlo por clase de prueba convertiría la suite en algo que nadie ejecuta. Se
construye una vez y cada prueba que escribe va en una transacción.

### PHPStan al nivel 6, sin `tests/`

`tests/` queda excluido a propósito. Pest es un DSL dinámico: las expectativas
propias, `$this->post()` dentro de un closure y las cadenas de `expect()` no son
analizables sin anotar a mano cada llamada. Al nivel 6 producía 40 errores, todos
falsos positivos, que habrían enterrado los cuatro reales — entre ellos que el
stub `UpdateUserProfileInformation` de Fortify escribía una columna `name` que en
este esquema no existe.

## Fase 3: sitio público bilingüe y alta de empresa

### Los diccionarios se portaron tal cual, y se prueban

22 espacios de nombres, 3.374 claves, en inglés y español. Se copiaron sin tocar
desde `src/i18n/messages/` y ahora hay cuatro pruebas que los vigilan: mismos
espacios en los dos idiomas, mismas claves en cada espacio, ninguna cadena larga
idéntica en ambos (señal casi segura de copiar-pegar sin traducir), y los mismos
marcadores `{…}` a los dos lados.

La última encontró un caso real: `signature.templates.fields.requiredTokensHint`
llevaba `{{tokenName}}` en inglés y `{{nombreDeVariable}}` en español. Resultó ser
un falso positivo —las llaves DOBLES son un ejemplo de la sintaxis de plantillas,
no un parámetro— y la prueba aprendió a distinguirlos. Pero el mecanismo es el
correcto: un `{year}` que se pierde al traducir deja `{year}` literal en la
pantalla, y nadie que trabaje en inglés lo ve nunca.

### Un cargador de traducciones propio

Laravel soporta ficheros PHP por grupo (`lang/en/marketing.php`) y un único JSON
de cadenas completas (`lang/en.json`). Lo que hay aquí es lo tercero: 22 JSON
anidados, uno por dominio. `App\Translation\JsonNamespaceLoader` los hace
funcionar como grupos normales, de modo que `__('marketing.seo.home.title')`
resuelve.

Convertirlos a PHP en un paso de compilación habría duplicado la fuente de verdad
y roto la propiedad que los hace fiables: que el MISMO fichero lo leen el
servidor (SEO, validación) y el cliente (interfaz). Con dos copias, una se queda
atrás.

Detalle que costó un rato: `TranslationServiceProvider` es un proveedor
**diferido**. Atar `translation.loader` con `singleton()` no funciona —se
registra cuando alguien lo resuelve, y al hacerlo pisa lo que hubiera antes—. Hay
que usar `extend()`, y conservar sus rutas (`$loader->paths()` incluye la del
framework, con `validation.php`).

### El prefijo de idioma manda sobre todo

`/en/...` y `/es/...`, con la raíz redirigiendo al idioma negociado. La cookie y
`Accept-Language` solo deciden cuando la URL no lo dice. Si la cookie pudiera
cambiar lo que sirve una URL, dos personas abriendo el mismo enlace verían
páginas distintas y un buscador indexaría una de las dos al azar.

Los slugs van en inglés en los dos idiomas (`/es/services`, no `/es/servicios`):
traducirlos duplicaría las URLs a mantener y partiría los enlaces compartidos en
cuanto se retocase una traducción.

### Solo viajan los espacios que la página pide

Mandar los 22 espacios en cada página serían unos 190 KB de JSON en el HTML
inicial. Cada página declara los suyos (`usesDictionary`) y el resto se queda en
el servidor. Una página de marketing viaja con cinco: `common`, `nav`, `errors`,
`marketing` y `validation`.

### Anti-spam: el sello de tiempo va firmado

El original mandaba `Date.now()` desde el navegador y comprobaba en el servidor
que hubiesen pasado tres segundos. Un bot no ejecuta el JavaScript —hace el POST
directamente— y puede poner ahí cualquier valor. **La comprobación parecía
existir y no existía.**

Aquí el sello lo emite el servidor al renderizar el formulario, firmado con
`APP_KEY`, y lleva dentro para qué formulario es. Un sello inventado no pasa la
firma, y uno del formulario de contacto no sirve para el alta de transportista.
Sigue sin haber CAPTCHA a propósito: un CAPTCHA le cobra el peaje a quien rellena
el formulario con un lector de pantalla, no al bot.

El rechazo nunca dice cuál de las tres defensas saltó. Decírselo a un bot es
enseñarle a rodearla.

### Dónde acaba un alta de transportista

Depende de dónde se envíe, y la diferencia no es un detalle:

- **En el dominio propio de una empresa** (verificado) se crea un `carriers` de
  verdad con su `carrier_onboardings`.
- **En el sitio de la plataforma** no hay empresa a la que pertenecer y
  `carriers.tenant_id` es NOT NULL. Se guarda como `lead` con origen
  `carrier_signup` — que es justo para lo que `leads` tiene columnas `dot_number`
  y `mc_number`. Inventar un tenant huérfano o relajar la restricción habría sido
  mentirle al esquema.

Un dominio personalizado **sin verificar** no cuenta: si bastara con apuntar un
DNS a nuestro servidor, cualquiera elegiría de qué empresa recibir las altas.

### El ámbito de plataforma, un cuarto estado

`leads` y `quote_requests` admiten `tenant_id` NULL porque un formulario en el
sitio de Goliath no pertenece a ninguna empresa cliente. Eso obligó a que
`TenantContext` distinga **cuatro** estados, no tres: con empresa, sin definir
(lanza), plataforma (`tenant_id IS NULL`) y sin frontera (`withoutTenant`).

Confundir los dos últimos habría dejado los leads de todas las empresas a la
vista del formulario de contacto público.

### Alta de empresa: siete filas en una transacción

Crear una cuenta aquí no crea un usuario, crea una EMPRESA: `tenants`,
`tenant_settings`, `tenant_branding`, `tenant_subscriptions`, `users`,
`user_tenant_memberships` y dos `consent_records`. Por eso
`Features::registration()` de Fortify está desactivado — no cabe en un formulario
de dos campos.

Decisiones que merecen quedar escritas:

- **No se cobra en el alta.** La suscripción nace en `trialing` con la fecha del
  plan y `stripe_customer_id` en NULL. El propio texto promete «sin tarjeta».
- **No se inicia sesión.** El usuario queda en `pending_verification`, y
  `AttemptLogin` rechaza cualquier estado que no sea `active`. Iniciarle sesión
  se saltaría la verificación que el flujo acaba de prometer.
- **La versión de la política se graba** en cada `consent_records`. Un
  consentimiento que solo dice «aceptó» no prueba a QUÉ texto aceptó, y el texto
  cambia.
- **Los slugs se desambiguan con un número**, no con un UUID: `acme-dispatch-2`
  sirve al teléfono, `acme-dispatch-9f3a71c4` no.
- **El correo se guarda como lo escribió la persona.** La unicidad no sufre
  porque `users.email_normalized` está en `utf8mb4_0900_ai_ci`, insensible a
  mayúsculas — comprobado contra MySQL, no supuesto. Y así, si tecleó mal el
  dominio, verlo escrito en la pantalla final es lo único que se lo revela.

### Lo que solo apareció al arrancar el servidor

Dos defectos que las pruebas de Inertia no podían ver, porque comprueban la
respuesta del servidor sin renderizar React:

1. **`I18nProvider` envolvía `<App>` en lugar de ir dentro.** El contexto de
   página lo provee `<App>`, así que su `usePage()` quedaba fuera y reventaba con
   «usePage must be used within the Inertia component». En cliente eso es una
   pantalla en blanco; en SSR, una página sin nada que indexar. Se arregló usando
   la forma con `children`.

2. **El título salía duplicado**: «Goliath Dispatch — Heavy-Haul Dispatch
   Software · Goliath Dispatch». Los títulos SEO del diccionario ya llevan la
   marca y el sufijo se añadía igual. En un resultado de búsqueda eso gasta la
   mitad de los caracteres visibles repitiendo el nombre.

Y un falso positivo que conviene no «arreglar»: el `<Head>` de Inertia escribe
los nombres de prop tal cual, así que `hrefLang` sale literalmente como
`hrefLang=`. Comprobado con un analizador de HTML: los nombres de atributo son
insensibles a mayúsculas y se lee como `hreflang`. Forzar la minúscula exigiría
un cast que apagaría la comprobación de tipos del elemento entero.
