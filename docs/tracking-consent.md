# El consentimiento de rastreo

## La frase

La pantalla de rastreo decía esto, y lo decía desde el primer día:

> «El rastreo de ubicación envía la posición GPS de este conductor a despacho y a
> los clientes que vean el enlace público de rastreo mientras la carga está en
> tránsito. El rastreo **no puede iniciarse** hasta que el conductor otorgue su
> consentimiento, y **se detiene de inmediato** si el consentimiento se retira.»

No había puerta, ni registro, ni forma de retirarlo:

- `consent_records` — vacía.
- `drivers.tracking_consent_granted_at` — solo se pintaba; nadie la escribía.
- `errors.trackingConsentMissing` — el mensaje existía y no lo usaba nadie.
- `TrackingEventType::ConsentGranted` / `ConsentRevoked` — casos de enum que
  nadie escribía.
- `AuditAction::TrackingConsentChanged` — igual.
- `tracking:consent`, con ámbito propio y concedido SOLO al rol conductor — el
  permiso estaba en la matriz desde el principio, sin usar.

Todo estaba previsto. Nada estaba conectado. Es el mismo patrón de los tres lotes
anteriores en el sitio donde peor sienta: la ubicación en vivo de una persona,
enseñada además a terceros.

## Lo que este código es, y lo que no

Es **un registro y una puerta**. No es una afirmación de que esto satisfaga
ninguna obligación legal de ningún sitio, ni de que el texto que se enseña sea
suficiente donde se use. Qué hay que pedir, cómo y con qué redacción es una
cuestión legal que quien despliegue esto tiene que resolver con su abogado — y la
propia pantalla lo dice, no solo este documento.

Lo que sí se garantiza es más modesto y comprobable: sin consentimiento vigente
el rastreo no arranca, y al retirarlo se para.

## El consentimiento es sobre UN TEXTO

`consent_records.policy_version` no es burocracia. Alguien consintió una frase
concreta; si esa frase cambia, lo que consintió ya no es lo que se le pide ahora.

`Consent::VERSION` es la versión vigente, y la comprobación la exige. **Cambiar
`tracking.consent.description` obliga a subirla**, y al subirla todo el mundo
vuelve a «no otorgado» y hay que volver a preguntar. Es incómodo a propósito: es
lo que distingue pedir permiso de haberlo pedido una vez.

Se guarda además el idioma en que se leyó, la IP y el navegador. Lo del idioma no
es un detalle: un consentimiento sobre un texto que la persona no lee no vale
gran cosa, y aquí la mitad de los conductores trabajan en español.

## Solo el conductor

`tracking:consent` es `Scope::Own` y solo lo tiene el rol `driver`. El botón
aparece únicamente en la ficha de quien está mirando; un administrador con todos
los permisos ve el estado y no ve el botón.

Eso no es una limitación que haya que arreglar. Un despachador marcando la
casilla «porque el conductor lo dijo por teléfono» sería el despachador
afirmando algo, no el conductor consintiendo, y guardar lo segundo cuando pasó lo
primero es la clase de mentira que este lote existe para quitar.

Consecuencia aceptada: **un conductor sin cuenta de acceso no puede consentir, y
entonces no se le rastrea.** La ficha lo dice con todas las letras en vez de
dejar un botón que no hace nada.

### El vínculo es la afiliación, no `drivers.user_id`

Las dos columnas existen y **solo una la mantiene la aplicación**:
`user_tenant_memberships.driver_id`, que es la que rellena la invitación y la que
lee `ActorFactory` para dar `Actor::driverId`. `drivers.user_id` la escribe el
sembrador y nadie más.

Apoyarse en ella habría dejado la puerta cerrada para todo conductor invitado por
el camino normal, sin que nadie entendiera por qué. Y de paso destapó otra frase
falsa: `hasLogin` se calculaba con esa columna, así que un conductor con cuenta
salía en pantalla como «sin cuenta de acceso».

## Retirar lo para todo

Retirar el consentimiento hace **dos** cosas, y la segunda es la que se olvida:

1. Cierra las sesiones de rastreo abiertas de ese conductor, anotando en cada una
   `consent_revoked_at`.
2. **Revoca los enlaces públicos vivos de esas cargas.**

Un enlace público es cómo un cliente ve dónde está el camión. Parar el rastreo
por dentro y seguir enseñándolo por fuera sería no haberlo parado — y es
exactamente lo que la frase de la pantalla promete que no pasa.

## La sesión guarda bajo qué consentimiento se abrió

`tracking_sessions` lleva `consent_granted_at`, `consent_revoked_at` y
`consent_user_id` desde el primer día, y ahora se rellenan. La pregunta «¿con qué
permiso se siguió a esta persona el 12 de marzo?» se contesta mirando la sesión,
sin reconstruir el estado de otra tabla en esa fecha.

## Lo que falta

- **No hay posiciones.** El proveedor de GPS —Trucker Tools, MacroPoint,
  Highway— no está conectado, y la pantalla lo dice desde antes de este lote. Una
  sesión es el hecho de que la carga está siendo seguida, no un flujo de puntos.
  El panel lo repite para que nadie deduzca lo contrario al ver el botón nuevo.
- **`tracking_events` sigue vacía**, y con ella los casos `consent_granted` /
  `consent_revoked` del enum de sucesos. El rastro del consentimiento vive hoy en
  `consent_records` y en la bitácora; duplicarlo en la línea de tiempo de la
  carga es trabajo del lote que conecte el proveedor.
- **El consentimiento no caduca solo.** No hay renovación periódica ni aviso: se
  mantiene hasta que la persona lo retira o hasta que cambia la versión del
  texto.
- **`sms_consent_granted_at`** sigue exactamente igual que estaba el rastreo
  antes de este lote: se pinta y no lo escribe nadie. Es el siguiente de la misma
  familia.

## Dónde vive

| | |
|---|---|
| El consentimiento | `app/Support/Tracking/Consent.php` |
| Las sesiones y la cascada | `app/Support/Tracking/Sessions.php` |
| La acción del conductor | `app/Http/Controllers/App/DriverController.php@consent` |
| La puerta | `app/Http/Controllers/App/TrackingController.php@startSession` |
| Pantallas | `resources/js/pages/App/Drivers/Show.tsx`, `resources/js/pages/App/Tracking/Show.tsx` |
| Pruebas | `tests/Feature/Tracking/ConsentTest.php`, `tests/Unit/Suite/TrackingConsentTest.php` |
