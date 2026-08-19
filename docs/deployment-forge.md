# Despliegue en Laravel Forge

Guía para servir Goliath Dispatch (Next.js) desde un servidor gestionado por
Forge, con despliegue automático en cada push a GitHub.

> Esta guía cubre la aplicación Next.js actual. Cuando la migración a Laravel
> esté lista, el script de despliegue cambia pero los pasos de Forge —
> repositorio, Quick Deploy, variables, programador — son los mismos.

---

## 0 · Lo que Forge no hereda de Vercel

Tres cosas dejan de funcionar solas al salir de Vercel. Las tres se resuelven
en esta guía, pero conviene saber por qué existen los pasos:

| En Vercel | En Forge |
|---|---|
| `vercel.json` define 8 tareas programadas | Nadie lee ese archivo: se configuran en el **programador** (paso 6) |
| La aplicación corre como funciones serverless | Corre como un proceso Node persistente bajo **PM2** (paso 4) |
| Nginx y TLS son invisibles | Se configura el **proxy inverso** a mano (paso 5) |

---

## 1 · Crear el servidor

En Forge, **Create Server**. Recomendado para empezar:

- Proveedor: DigitalOcean, Hetzner o AWS — cualquiera sirve.
- Tamaño: 2 vCPU / 4 GB es holgado. Con 1 vCPU / 2 GB el `next build` durante
  el despliegue puede quedarse sin memoria.
- Base de datos: **PostgreSQL** (la aplicación actual la usa; la migración a
  Laravel cambiará esto a MySQL).
- PHP: la versión que Forge ofrezca. No se usa, pero Forge la instala igual.

Anota la contraseña de la base de datos que Forge muestra **una sola vez**.

## 2 · Instalar Node y PM2

Forge no instala Node por defecto. En la pestaña **Server → Packages**, o por
SSH:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# Que PM2 reviva los procesos al reiniciar el servidor
pm2 startup systemd -u forge --hp /home/forge
# Ejecuta el comando que imprima la línea anterior, con sudo
```

Verifica: `node -v` debe dar v20.11 o superior — es lo que exige `package.json`.

## 3 · Crear el sitio y conectar el repositorio

1. **Sites → New Site**. Dominio, tipo *Static HTML / Nginx*, sin base de datos
   nueva (ya la creó el servidor).
2. En el sitio, **Git Repository**: `forkandjoinllc/goliath-dispatch`, rama
   `main`. **Desmarca "Install Composer dependencies"** — esto no es un proyecto
   PHP.
3. En **Apps**, activa **Quick Deploy**.

   Esto es literalmente lo que pediste: Forge instala un webhook en GitHub y
   cada push a `main` dispara el despliegue. No hace falta GitHub Actions.

## 4 · Configurar el script de despliegue

En **Apps → Deploy Script**, reemplaza todo el contenido por:

```bash
cd $FORGE_SITE_PATH && bash deploy/forge/deploy.sh
```

El script real vive en el repositorio (`deploy/forge/deploy.sh`), así que los
cambios al procedimiento de despliegue pasan por revisión de código en vez de
quedar solo en la interfaz de Forge, donde nada registra por qué cambiaron.

Lo que hace: trae la rama, `npm ci`, migraciones, `npm run build`, `pm2 reload`,
y finalmente pide la portada para confirmar que la aplicación responde de
verdad. Si no responde, el despliegue **falla en rojo** en vez de reportar éxito
sobre un sitio caído.

## 5 · Configurar Nginx como proxy inverso

**Sites → tu sitio → Edit Files → Edit Nginx Configuration**. Sustituye el
bloque `location /` por el contenido de `deploy/forge/nginx-proxy.conf`,
cambiando `YOUR_SITE_DOMAIN` por tu dominio real.

No toques los marcadores `# FORGE CONFIG (DO NOT REMOVE!)` ni el bloque SSL:
Forge los reescribe al renovar el certificado y se llevaría por delante
cualquier cosa que esté entre ellos.

## 6 · Configurar las tareas programadas

**Server → Scheduler → New Scheduled Job**. Ocho entradas, todas con usuario
`forge`. El comando en todas es el mismo salvo el último argumento:

```bash
cd /home/forge/TU_DOMINIO && bash deploy/forge/run-cron.sh <trabajo>
```

| Trabajo | Frecuencia (cron) | Qué hace |
|---|---|---|
| `drain` | `* * * * *` | Vacía la cola de trabajos |
| `tracking-ingest` | `*/5 * * * *` | Ingesta eventos de rastreo |
| `tracking-link-expiry` | `0 * * * *` | Expira enlaces públicos de rastreo |
| `fmcsa-reverification` | `0 6 * * *` | Reverificación FMCSA de 7 días |
| `document-expiration` | `0 7 * * *` | Avisos de vencimiento de documentos |
| `invoice-overdue` | `0 8 * * *` | Marca facturas vencidas |
| `retention-archive` | `0 9 * * *` | Archiva registros fuera de ventana |
| `retention-purge` | `0 10 * * 0` | Borrado definitivo (semanal, domingos) |

Los horarios son UTC, igual que en Vercel — Forge configura los servidores en
UTC por defecto. Verifica con `timedatectl` si tienes dudas.

**El de cada minuto es el que más consume.** Si no necesitas esa latencia en los
trabajos de fondo, bájalo a `*/2` o `*/5`.

## 7 · Variables de entorno

**Sites → tu sitio → Environment**. Como mínimo:

```bash
NODE_ENV=production
APP_ENV=production
PORT=3000
NEXT_PUBLIC_APP_URL=https://tu-dominio.com

DATABASE_URL=postgres://forge:CONTRASEÑA@127.0.0.1:5432/goliath
DATABASE_URL_UNPOOLED=postgres://forge:CONTRASEÑA@127.0.0.1:5432/goliath

AUTH_SECRET=...
ENCRYPTION_KEY=...
SIGNATURE_HASH_PEPPER=...
PUBLIC_TRACKING_TOKEN_SECRET=...
CRON_SECRET=...

ALLOW_DEMO_SEED=false
```

Los cinco secretos se generan con:

```bash
for v in AUTH_SECRET ENCRYPTION_KEY SIGNATURE_HASH_PEPPER PUBLIC_TRACKING_TOKEN_SECRET CRON_SECRET; do
  echo "$v=$(openssl rand -base64 32)"
done
```

`ALLOW_DEMO_SEED=false` no es opcional: es lo que impide que alguien siembre
usuarios de demostración en producción.

Todo lo demás (Stripe, Mailgun, Twilio, Google Maps, FMCSA, OCR, rastreo)
funciona en modo simulado por defecto. Se activa poniendo su llave y cambiando
su interruptor `*_DRIVER`.

## 8 · Primer despliegue

1. **Deploy Now** en la pestaña Apps.
2. Cuando termine, aplica el esquema por SSH:

   ```bash
   cd /home/forge/TU_DOMINIO
   npm run db:migrate
   ```

3. Emite el certificado en **SSL → LetsEncrypt**.
4. Abre `https://tu-dominio.com` — debe redirigir a `/en` y mostrar la portada.

Desde aquí, cada `git push` a `main` despliega solo.

---

## Verificación

```bash
pm2 status                      # el proceso debe estar "online"
pm2 logs goliath-dispatch       # registros de la aplicación
bash deploy/forge/run-cron.sh drain   # probar una tarea a mano
```

## Cuando algo falla

| Síntoma | Causa habitual |
|---|---|
| 502 Bad Gateway | El proceso Node no está arriba: `pm2 status`, `pm2 logs` |
| El despliegue falla en `npm run build` | Memoria insuficiente. Añade swap o sube el tamaño del servidor |
| `DATABASE_URL is not set` | Falta en Environment, o el despliegue corrió antes de guardarla |
| Las tareas no corren | `CRON_SECRET` distinto entre el .env y el que espera la aplicación |
| Todo se registra desde 127.0.0.1 | Falta `X-Forwarded-For` en Nginx (paso 5) |

## Copias de seguridad

Forge ofrece copias de la base de datos en **Server → Backups**. Actívalas.
Ten presente que **no** respaldan los archivos subidos: si usas
`STORAGE_DRIVER=local`, la carpeta `.local-storage` queda fuera de la copia y
un restore dejaría la base apuntando a documentos que ya no existen. Para
producción usa `STORAGE_DRIVER=s3` contra un bucket privado.
