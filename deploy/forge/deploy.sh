# ─────────────────────────────────────────────────────────────────────────────
# Script de despliegue de Goliath Dispatch en Laravel Forge
#
# Se pega en la pestaña «Deploy Script» del sitio. Forge lo ejecuta como el
# usuario `forge`, con el repositorio ya clonado en el nuevo release.
#
# El sitio tiene activado Zero Downtime Deployment, así que $FORGE_SITE_PATH
# apunta al RELEASE NUEVO mientras corre el script, y el enlace `current`
# todavía apunta al viejo. De ahí el orden: todo lo que prepara el release nuevo
# va antes de $ACTIVATE_RELEASE(), y todo lo que reinicia procesos va después —
# si no, se recargaría el proceso del release saliente.
# ─────────────────────────────────────────────────────────────────────────────

# Cualquier orden que falle aborta el despliegue. Sin esto, un `npm run build`
# roto seguiría adelante y activaría un release sin assets: la página cargaría
# sin estilos y sin JavaScript, que es peor que no desplegar.
set -e

cd $FORGE_SITE_PATH

# ── Dependencias de PHP ──────────────────────────────────────────────────────
# --no-dev: en producción no hay Pest, ni Pint, ni Larastan.
# --optimize-autoloader: mapa de clases completo, sin buscar en disco por PSR-4.
$FORGE_COMPOSER install --no-dev --no-interaction --prefer-dist --optimize-autoloader

# ── Assets ───────────────────────────────────────────────────────────────────
# `npm ci` y no `npm install`: instala EXACTAMENTE lo del package-lock.json. Con
# `install`, una dependencia transitiva podría subir de versión entre el build
# que se probó y el que se despliega.
npm ci --no-audit --no-fund

# El sitio público se renderiza en el servidor para que un buscador vea el texto
# y no un div vacío, así que hace falta el bundle de SSR además del de cliente.
npm run build:ssr

# ── Base de datos ────────────────────────────────────────────────────────────
# --force porque en producción `migrate` pregunta y aquí no hay nadie que
# conteste. Las migraciones de este proyecto ejecutan DDL en crudo (99 tablas,
# 246 claves foráneas, 47 triggers) y MySQL no tiene DDL transaccional: una
# migración a medias deja el esquema a medias. Por eso `set -e` de arriba
# importa tanto — el despliegue para aquí y el release viejo sigue sirviendo.
$FORGE_PHP artisan migrate --force

# Idempotente y reejecutable: sincroniza el catálogo de permisos y los planes
# con lo que dice el código. Ver database/seeders/.
$FORGE_PHP artisan db:seed --class=Database\\Seeders\\DatabaseSeeder --force

# ── Cachés ───────────────────────────────────────────────────────────────────
# Se limpian antes de reconstruir: una caché de configuración del release
# anterior apuntaría a rutas que ya no existen.
$FORGE_PHP artisan config:cache
$FORGE_PHP artisan route:cache
$FORGE_PHP artisan view:cache
$FORGE_PHP artisan event:cache

# ── Activación ───────────────────────────────────────────────────────────────
# A partir de aquí, `current` ya apunta al release nuevo.
$ACTIVATE_RELEASE()

# PHP-FPM recarga el opcache; sin esto seguiría sirviendo el bytecode del
# release anterior. `reload` y no `restart`: no corta las peticiones en curso —
# y en este servidor hay otros cuatro sitios en producción compartiendo FPM.
( flock -w 10 9 || exit 1
    echo 'Reiniciando FPM...'; sudo -S service $FORGE_PHP_FPM reload ) 9>/tmp/fpmlock

# El servidor de SSR ejecuta el bundle nuevo. Va DESPUÉS de activar, porque
# antes estaría arrancando el del release saliente.
$FORGE_PHP artisan inertia:stop-ssr || true

# Horizon recoge el código nuevo terminando sus workers; el supervisor los
# vuelve a levantar solos.
$FORGE_PHP artisan horizon:terminate || true
