# ─────────────────────────────────────────────────────────────────────────────
# Goliath Dispatch — pasos de construcción del despliegue
#
# Lo invoca el script de despliegue de Forge, que ya ha hecho $CREATE_RELEASE()
# y ha entrado en $FORGE_RELEASE_DIRECTORY. Es decir: esto corre DENTRO del
# release nuevo, mientras `current` todavía apunta al viejo.
#
# Por eso aquí no hay $ACTIVATE_RELEASE() ni recarga de PHP-FPM: de la
# activación se encarga el script de Forge cuando este termina, y con
# despliegues sin corte la recarga de FPM no hace falta.
#
# Y por eso el orden importa: si algo de aquí falla, `current` no se mueve y el
# sitio sigue sirviendo el release anterior.
# ─────────────────────────────────────────────────────────────────────────────

# Cualquier orden que falle aborta el despliegue. Sin esto, un `npm run build`
# roto seguiría adelante y se activaría un release sin assets: la página
# cargaría sin estilos ni JavaScript, que es peor que no desplegar.
set -e

# Forge sustituye $FORGE_PHP y $FORGE_COMPOSER en SU script, no dentro de este
# fichero, así que se reciben por entorno y se cae a los del PATH si no vienen.
PHP="${FORGE_PHP:-php}"
COMPOSER="${FORGE_COMPOSER:-composer}"

echo "==> PHP: $($PHP -v | head -1)"
echo "==> Node: $(node -v)  npm: $(npm -v)"

# ── Dependencias de PHP ──────────────────────────────────────────────────────
# --no-dev: en producción no hay Pest, ni Pint, ni Larastan.
# --optimize-autoloader: mapa de clases completo, sin buscar en disco por PSR-4.
$COMPOSER install --no-dev --no-interaction --prefer-dist --optimize-autoloader

# ── Assets ───────────────────────────────────────────────────────────────────
# `npm ci` y no `npm install`: instala EXACTAMENTE lo del package-lock.json. Con
# `install`, una dependencia transitiva podría subir de versión entre el build
# que se probó y el que se despliega.
npm ci --no-audit --no-fund

# Cliente y servidor. El sitio público se renderiza en el servidor para que un
# buscador vea el texto y no un div vacío, así que el bundle de SSR no es opcional.
npm run build:ssr

# ── Base de datos ────────────────────────────────────────────────────────────
# --force porque en producción `migrate` pregunta y aquí no hay nadie que
# conteste.
#
# Estas migraciones ejecutan DDL en crudo: 99 tablas, 246 claves foráneas, 47
# triggers. MySQL NO tiene DDL transaccional, así que una migración que falla a
# la mitad deja el esquema a medias y no se revierte sola. El `set -e` de arriba
# es lo que evita que encima se active un release contra ese esquema roto.
$PHP artisan migrate --force

# Idempotente: sincroniza el catálogo de permisos y los planes con lo que dice
# el código. Reejecutarlo en cada despliegue es lo que impide que la tabla y el
# código se separen. Ver database/seeders/.
$PHP artisan db:seed --force

# ── Cachés ───────────────────────────────────────────────────────────────────
# Se reconstruyen dentro del release nuevo; las del anterior se quedan con él.
$PHP artisan config:cache
$PHP artisan route:cache
$PHP artisan view:cache
$PHP artisan event:cache

# El enlace de storage vive en un directorio compartido entre releases; si ya
# existe, `storage:link` sin --force falla y tumbaría el despliegue.
$PHP artisan storage:link --force || true

echo "==> Release preparado. Forge activará a continuación."
