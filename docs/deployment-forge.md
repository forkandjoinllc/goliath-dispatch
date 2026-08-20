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

Está en `deploy/forge/deploy.sh`. Se pega tal cual en la pestaña Deploy Script.

Dos cosas del script que no son evidentes:

- **`set -e` al principio.** Sin él, un `npm run build` roto seguiría adelante y
  activaría un release sin assets: la página cargaría sin estilos ni JavaScript,
  que es peor que no desplegar.
- **El orden alrededor de `$ACTIVATE_RELEASE()`.** El sitio tiene Zero Downtime
  activado, así que mientras corre el script `current` todavía apunta al release
  VIEJO. Todo lo que prepara el release nuevo va antes; todo lo que reinicia
  procesos va después. Recargar FPM antes de activar recargaría el release que
  está a punto de desaparecer.

## Migraciones y DDL

`php artisan migrate --force` ejecuta 99 tablas, 246 claves foráneas y 47
triggers de DDL en crudo. **MySQL no tiene DDL transaccional**: una migración que
falla a la mitad deja el esquema a medias y no se revierte sola.

Por eso el `set -e`: el despliegue se detiene ahí, `$ACTIVATE_RELEASE()` nunca
corre y el release anterior sigue sirviendo. Para arreglarlo hay que mirar el
esquema a mano; no basta con volver a desplegar.

## Comprobación después de desplegar

```bash
curl -sI https://goliathdispatch.com/                 # 302 -> /en o /es
curl -s  https://goliathdispatch.com/en | grep -o '<title>[^<]*'
curl -s  https://goliathdispatch.com/es | grep -o '<h1[^>]*>[^<]\{0,40\}'
```

Si el `<h1>` sale vacío pero la página carga en el navegador, el demonio de SSR
no está corriendo (paso 3).
