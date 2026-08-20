# Despliegue en Laravel Forge

Servidor **fleetforce** (ID 1223071) · sitio **goliathdispatch.com** (ID 3345800)
Ubuntu 24.04 · PHP 8.3 · MySQL 8.4 · Nueva York

> El servidor es **compartido**: además de este, alojan `app.pulsedcalls.com`,
> `fleetforceapp.com`, `api.supporteld.com` y `highway.toptracking.com`, todos en
> producción. Nada de lo que hay aquí toca configuración del servidor —
> PHP-FPM, MySQL, nginx global—: todo queda dentro del sitio. Un cambio a nivel
> de servidor para arreglar este sitio se llevaría por delante los otros cuatro.

## Lo que hace falta una sola vez

### 1. Base de datos

El servidor no tiene todavía una base para este sitio. En Forge → Storage →
Database:

- **Add database**: `goliath_dispatch`
- **Add user**: uno propio para este sitio, con acceso **solo** a esa base.

Un usuario por sitio, no el `forge` que tiene acceso a todas: si algún día se
filtra el `.env` de este sitio, lo que se filtra es el acceso a esta base y no a
los 649 MB de `callcenter`.

La contraseña la genera y la guarda Forge. **No debe pasar por el chat, ni por
el repositorio, ni por un fichero de este proyecto.**

### 2. Variables de entorno

En Forge → el sitio → Environment. Se parte de `.env.example` y se rellenan:

| Variable | De dónde sale |
|---|---|
| `APP_KEY` | `php artisan key:generate` en el servidor (no se escribe a mano) |
| `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | lo del paso 1 |
| `APP_URL` | `https://goliathdispatch.com` |

Todo lo demás puede quedarse como está. Los servicios externos sin credenciales
usan adaptadores simulados: la aplicación arranca igual, y lo que no funciona es
lo que necesita ese servicio, no el sitio entero.

Si el servidor no tiene Redis, cambiar `QUEUE_CONNECTION=database` y
`CACHE_STORE=database`, y no arrancar Horizon.

### 3. Demonio de renderizado en servidor

Forge → el sitio → Processes → Add background process:

```
Command:   php artisan inertia:start-ssr
Directory: /home/forge/goliathdispatch.com/current
User:      forge
Processes: 1
```

Sin este proceso el sitio **funciona**, pero devuelve un `<div>` vacío y el
contenido lo pinta el navegador. Para una aplicación tras login daría igual; para
un sitio de marketing que vive de que lo indexen, no: un rastreador vería una
página en blanco en los dos idiomas.

El script de despliegue hace `inertia:stop-ssr` después de activar el release, y
el gestor de procesos lo vuelve a levantar solo con el bundle nuevo.

### 4. Tareas programadas

Forge → el sitio → Scheduled jobs:

```
Command:   php /home/forge/goliathdispatch.com/current/artisan schedule:run
Frequency: Every minute
User:      forge
```

Es la que dispara los barridos de reverificación FMCSA, los avisos de documentos
por vencer y los trabajos de retención. Sin ella el sitio se ve perfecto y nada
de eso ocurre nunca — que es la peor forma de fallar, porque no da error.

## Script de despliegue

Está partido en dos a propósito.

**En la pestaña Deploy Script de Forge** va solo el armazón, porque las
directivas `$CREATE_RELEASE()` y `$ACTIVATE_RELEASE()` las sustituye Forge en
SU script y no funcionan dentro de un fichero del repositorio:

```bash
$CREATE_RELEASE()
cd $FORGE_RELEASE_DIRECTORY

FORGE_PHP="$FORGE_PHP" FORGE_COMPOSER="$FORGE_COMPOSER" bash deploy/forge/deploy.sh

$ACTIVATE_RELEASE()

cd $FORGE_SITE_PATH
$FORGE_PHP artisan inertia:stop-ssr || true
$FORGE_PHP artisan horizon:terminate || true
```

`cd $FORGE_SITE_PATH` a secas, **sin añadir `/current`**. En un sitio con
despliegues sin corte, Forge ya sustituye `$FORGE_SITE_PATH` por la ruta del
enlace `current`; escribir `$FORGE_SITE_PATH/current` da
`…/goliathdispatch.com/current/current`, que no existe, y el despliegue muere en
la última línea con el release ya activado — el peor momento posible.

**En `deploy/forge/deploy.sh`** (versionado) van los pasos de construcción:
composer, npm, build, migraciones, seeders y cachés.

Cuatro cosas que no son evidentes:

- **`set -e` al principio.** Sin él, un `npm run build` roto seguiría adelante y
  se activaría un release sin assets: la página cargaría sin estilos ni
  JavaScript, que es peor que no desplegar.
- **Todo lo que prepara el release va ANTES de `$ACTIVATE_RELEASE()`.** Mientras
  corre el script, `current` todavía apunta al release viejo. Si algo falla, el
  release no se activa y el sitio sigue sirviendo lo anterior.
- **Los directorios de `storage/` se crean en cada despliegue.** El directorio
  compartido que Forge aprovisiona trae solo `logs/`, y `view:cache` llama a
  `realpath()` sobre `storage/framework/views`: si no existe, `realpath()`
  devuelve false y el comando muere con «View path not found» sin decir qué
  falta. Hacerlo a mano una vez en el servidor deja un despliegue roto esperando
  a que alguien recree el sitio.
- **Lo que reinicia procesos va DESPUÉS.** `inertia:stop-ssr` y
  `horizon:terminate` no matan nada: le dicen al proceso que termine, y el
  gestor de Forge lo vuelve a levantar con el código nuevo. Hacerlo antes de
  activar reiniciaría el proceso del release que está a punto de desaparecer.

Con despliegues sin corte **no hace falta recargar PHP-FPM**, y conviene no
hacerlo: en este servidor FPM lo comparten otros cuatro sitios en producción.

## Migraciones y DDL

`php artisan migrate --force` ejecuta 99 tablas, 246 claves foráneas y 47
triggers de DDL en crudo. **MySQL no tiene DDL transaccional**: una migración que
falla a la mitad deja el esquema a medias y no se revierte sola.

Por eso el `set -e`: el despliegue se detiene ahí, `$ACTIVATE_RELEASE()` nunca
corre y el release anterior sigue sirviendo. Para arreglarlo hay que mirar el
esquema a mano; no basta con volver a desplegar.

## Cuentas y datos de demostración

`db:seed --force` corre en cada despliegue y siembra solo lo que debe existir en
cualquier entorno: el catálogo de permisos y los planes. Los datos de
demostración van aparte y hay que pedirlos a la cara, una vez, desde el
servidor:

```bash
cd /home/forge/goliathdispatch.com/current
php artisan db:seed --class=DemoUsersSeeder --force   # una cuenta por rol
php artisan db:seed --class=DemoDataSeeder  --force   # transportistas, flota, cargas
```

Ambos son idempotentes: se pueden repetir sin duplicar nada.

Están fuera de `DatabaseSeeder` a propósito, y no por comodidad. `DemoUsersSeeder`
crea cuentas con una contraseña conocida; si corriera en cada despliegue, esas
cuentas volverían a existir cada vez que alguien las borrase. Para cambiarla:

```bash
DEMO_PASSWORD='…' php artisan db:seed --class=DemoUsersSeeder --force
```

**Estas cuentas no deben sobrevivir a la salida a producción de verdad.** La
contraseña es conocida y los seis roles están representados, incluido el
administrador.

Los datos que siembra `DemoDataSeeder` son inventados: nombres de ficción,
dominios `.test` (RFC 6761, no resuelven nunca), teléfonos del rango 555 y
números USDOT que no son de ninguna empresa real. Las verificaciones FMCSA
llevan `provider = mock` y lo dicen dentro de su propio payload — no se ha
consultado nada en FMCSA.

## Comprobación después de desplegar

```bash
curl -sI https://goliathdispatch.com/                 # 302 -> /en o /es
curl -s  https://goliathdispatch.com/en | grep -o '<title>[^<]*'
curl -s  https://goliathdispatch.com/es | grep -o '<h1[^>]*>[^<]\{0,40\}'
```

Si el `<h1>` sale vacío pero la página carga en el navegador, el demonio de SSR
no está corriendo (paso 3).
