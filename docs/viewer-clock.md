# La hora que nadie resolvía

## La regla estaba escrita desde el puerto

`docs/mysql-port.md`, en la sección de fechas:

> MySQL no tiene equivalente de `timestamptz`: no guarda la zona. La aplicación
> almacena UTC y **resuelve la zona al presentar**. Esto importa especialmente
> en las paradas de carga, donde la cita se muestra en la zona local de la
> instalación y no en la del tenant.

La primera mitad se cumplía: todo es `datetime(3)` y todo entra en UTC. La
segunda **no se hacía en ningún sitio** fuera de las paradas de carga, que se
arreglaron el día anterior (`docs/stop-clock.md`).

## El censo

Con la aguja que hoy vigila el guardián —`substr((string) …_at…, 0, 10|16|19)`
sobre el fichero sin comentarios— en `app/Http/Controllers` y `app/Support`:

| | |
|---|---|
| Sitios que sacaban la hora en crudo | **60** |
| Ficheros | **28** |
| Copias idénticas de una `private function minute()` | **3** (Permit, Onboarding, Signature) |
| Veces que se leía `users.timezone` | **0** |
| Pantallas donde se podía cambiar `users.timezone` | **0** |

`users.timezone` existe desde el primer esquema, con `America/New_York` por
omisión, y se carga en el `Actor`. Nadie lo leía. Y sin pantalla donde cambiarlo,
tampoco era un ajuste mal aplicado: era una **columna muerta**, como
`tenant_settings.support_email` antes de `InertSettingsTest`.

Para una casa de despacho de Chicago eso son **todas** las horas de la
aplicación una hora por delante en verano. Para una de Los Ángeles, tres.

## Lo que se construyó

### `App\Support\Time\Clock`

No sabe de nadie: recibe un huso y convierte. Cuatro puertas, y cada una dice
una cosa distinta:

| Método | Qué significa |
|---|---|
| `at($utc, $huso)` | el instante, en ese huso, al minuto |
| `label($huso, $cuando)` | la abreviatura para esa fecha: `CDT` en julio, `CST` en enero |
| `literal($valor)` | **no se convierte**: lo escribió una persona y significa la hora del sitio |
| `utc($valor)` | **se queda en UTC** a propósito, porque la superficie pone «UTC» al lado |

Que `literal()` y `utc()` sean métodos —en vez de dejar el `substr` suelto— es
el punto: así **no convertir es una decisión escrita**, no un olvido, y el
guardián puede exigir que las llamadas pasen por ahí.

### `App\Support\Time\Viewer` y el trait `PresentsTime`

`Viewer` resuelve *quién mira* —`users.timezone` a través del `Actor`— y es la
puerta para las ayudas estáticas (`Inbox::messages()`, `Readiness`). El trait
`PresentsTime` da `$this->hora($x)` a los controladores y delega en `Viewer`.

Dos puertas y **una sola regla**: si mañana el huso sale de otro sitio, se cambia
`Viewer::zone()`.

El trait existe porque el reemplazo tenía que ser **de uno por uno**:
`'sentAt' => substr((string) $f->sent_at, 0, 16)` → `'sentAt' => $this->hora($f->sent_at)`
se revisa leyendo la línea. Pasar el huso como argumento habría exigido tocar
cada firma y cada `map()` intermedio, y en un cambio de sesenta sitios la
diferencia entre mecánico y no mecánico es la diferencia entre revisable y no
revisable.

### La pantalla donde se cambia

`POST /timezone`, hermano de `POST /locale`, y el selector va **en la barra
superior** junto al de idioma. No en una pantalla de ajustes: cambia lo que
dicen *todas* las pantallas, así que tiene que estar donde se vea siempre.

Sin permiso, igual que el idioma: nadie decide en qué reloj lee otro. La
frontera es la identidad, no el catálogo de permisos.

La ruta valida contra `Clock::opciones()` —ocho husos de Estados Unidos— y no
contra `timezone_identifiers_list()`. Aceptar los cuatrocientos permitiría dejar
una cuenta en un huso que ninguna pantalla vuelve a ofrecer, y del que ya no se
puede salir sin tocar la base de datos.

### La abreviatura se dice una vez

`shell.clock.zone` lleva `CDT`/`MST`/`EST` a la barra, en **todas** las páginas,
al lado del selector. No se repite en cada hora, y eso es deliberado: dentro de
una pantalla todas las horas del sistema están en el mismo huso, así que la regla
que el usuario aprende en dos segundos es

> **con abreviatura pegada al lado, es la hora del muelle** (la pone `StopClock`);
> **sin ella, la tuya**, la que dice la barra.

### El invitado nace en el huso de su empresa

`tenants.default_timezone` existía y tampoco lo leía nadie. Una casa de Chicago
que invitaba a diez personas las ponía a todas en Nueva York, y cada una tenía
que darse cuenta por su cuenta. `InviteUser` lo lee ahora — **solo al crear la
cuenta**. A quien ya tenía cuenta no se le toca: su huso es suyo y puede estar
trabajando además para otra empresa de otro sitio.

## Lo que se convirtió, y lo que no

Convertido (**24 sitios**): `SignatureController` (10), `PermitController` (7 de
10), `OnboardingController` (7), `MessageController` (2), `NotificationController`
(2), `Platform\HealthController` (2), `Inbox` (3), `Readiness` (2),
`RevalidationState` (1).

**No convertido a propósito, y con nombre:**

| Qué | Por qué |
|---|---|
| `permits.issued_at`, `permits.expires_at`, `escorts.scheduled_for` | las teclea una persona en un `datetime-local`: significan la hora del estado que emite el permiso, no la del servidor. Convertirlas las **movería** — un permiso emitido a las 08:00 diría 07:00 para quien mira desde otro huso, y no hay ningún sentido en el que eso sea más cierto. Pasan por `Clock::literal()`. |
| La cronología del certificado de auditoría de firma | un certificado se descarga, se archiva y se le enseña a un tercero. Si la hora dependiera de quién pulsó el botón, **dos copias del mismo documento dirían cosas distintas del mismo acto**. Pasa por `Clock::utc()`, y lo que estaba mal no era la hora: era que la columna se llamaba «Cuándo» a secas. Ahora dice **«Cuándo (UTC)»** en los dos idiomas. |
| `load_stops.window_start` / `window_end` | la cita del muelle. Ya iban por `StopClock::window()` desde el lote anterior. |

Ese descubrimiento es la mitad del valor del lote: **no todo `datetime` de la
base de datos es un instante en UTC**, y una migración que convirtiera los
sesenta sitios «por consistencia» habría roto tres columnas de verdad.

## Lo que falta, contado

`App\Support\Time\Pending::SIN_CONVERTIR` — **36 sitios en 20 ficheros**, cada
uno con su cuenta y su motivo escrito. Mismo patrón que
`Enforcement::SIN_APLICAR` (`docs/permission-enforcement.md`) y por el mismo
motivo: una deuda escrita en una lista que una prueba comprueba se paga; una que
solo vive en la cabeza de quien la contrajo, no.

Los dos casos que necesitan una decisión y no solo trabajo:

- **`Public/TrackingController`** — la página que abre el cliente **sin cuenta**.
  Ahí no hay actor del que sacar un huso. Necesita otra regla: ¿el de la empresa,
  el de la última parada? No es «convertir con `Viewer`».
- **`Platform/ScheduledRuns`** — quien mira esa pantalla compara con los
  registros del servidor, que están en UTC. Ahí UTC puede ser lo correcto, con
  la etiqueta, como el certificado.

## El guardián

`tests/Unit/Suite/ViewerClockTest.php`, 22 comprobaciones, **40 sabotajes**, uno
por aserción. Lo que compra:

1. **Un fichero nuevo que saque una hora en crudo falla**, porque no está en
   `Pending`. Es lo que de verdad se paga: que el defecto no vuelva a entrar.
2. Un fichero que se arregle y no se borre de `Pending` **también** falla. Una
   lista que exagera la deuda deja de leerse.
3. Las pantallas convertidas no vuelven atrás, con la cuenta exacta por fichero.
4. Lo que no se convierte a propósito sigue sin convertirse, y el certificado
   sigue diciendo «(UTC)».

Y `tests/Feature/Time/ViewerClockTest.php` (17 pruebas) hace lo que un guardián
que **lee** el código no puede: pedir las páginas de verdad. Ver
`docs/testing.md` para por qué eso hacía falta.
