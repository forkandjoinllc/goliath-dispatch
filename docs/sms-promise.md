# El SMS que nadie manda

## Lo que decía la política de privacidad pública

En los dos idiomas, en la página que lee quien todavía no es cliente:

> Puede retirar su consentimiento en cualquier momento respondiendo STOP a
> cualquier mensaje, lo que **suprime de inmediato** el envío de más SMS a ese
> número; responder HELP devuelve la información de contacto de soporte.

No hay envío. Ninguna clase de la aplicación manda un mensaje de texto, no hay
proveedor atado a nada, y **no existe ruta de entrada** que pueda escuchar un
STOP ni un HELP: si alguien contestara STOP, no habría nada al otro lado.

No es una frase de más en un folleto. Es un compromiso escrito sobre cómo se
tratan los mensajes de una persona, hecho en el documento donde se explica qué
se hace con sus datos.

## Los otros cinco sitios que decían lo mismo

| Dónde | Qué decía | Qué pasaba |
|---|---|---|
| Alta (`auth.consent.sms`) | «Acepto recibir mensajes SMS operativos… Responda STOP para cancelar» | Copia muerta: no la pintaba ninguna pantalla |
| Ficha del conductor | «Mensajes de texto: No otorgado» | Para todos, siempre: `drivers.sms_consent_granted_at` no lo escribe nadie |
| Panel de proveedores | SMS → «Real» con `TWILIO_SID` escrito | Escribir la variable no manda un solo mensaje |
| Descripción para buscadores | «…incluido el consentimiento de SMS y de rastreo» | La mitad cierta es la que hacía creíble la otra |
| Lista de subencargados | «entrega de SMS» entre los proveedores que reciben datos | Ningún proveedor de SMS recibe nada |

## Lo que encontró el guardián al escribirlo

Al recorrer los dos diccionarios buscando promesas de SMS, la lista de
subencargados saltó por una frase que yo no venía a mirar. Verificada entera,
nombraba **cuatro** categorías de proveedor que no reciben un solo dato:

- **entrega de SMS** — no hay emisor;
- **extracción de texto de documentos** — no hay OCR, y la propia clase lo dice:
  «las columnas `extracted_vins`, `ocr_provider` y `ocr_confidence` existen y se
  quedan vacías»;
- **mapas y rutas** — `RouteProvider` está atado a `StopDerivedRouteProvider`:
  la ruta se calcula con las paradas que se escriben en la aplicación;
- **proveedores de datos de rastreo** — igual, `StopDerivedTrackingProvider`.

Decirle a alguien que sus datos van a cuatro empresas a las que no van no le
hace daño directo —es lo contrario de ocultar un destinatario— pero convierte
el documento entero en algo que no se puede usar para saber dónde están sus
datos. La lista ahora nombra los cuatro que sí operan la plataforma
(alojamiento, correo transaccional, pagos y FMCSA) y dice explícitamente que
rutas y rastreo se calculan dentro.

**Esto no es asesoramiento legal, y corregir el texto no valida nada.** Lo que
he hecho es que la política diga lo que el código hace. Que la redacción
cumpla lo que exigen las reglas de mensajería o de privacidad que te apliquen
—y que la lista de subencargados case con tus contratos reales, no solo con el
código— es una revisión con abogado, y la página sigue llevando su aviso de que
el texto necesita esa revisión.

## Lo que ya estaba diagnosticado y no se aplicó

`Notifier` llevaba escrito, en un comentario:

> Canales que este lote entrega de verdad. `sms` está declarado y suprimido.

Cierto, y guardado en una clase interna que no lee nadie más, mientras cinco
pantallas decían lo contrario. Es la forma que se repite en este proyecto: **el
defecto ya estaba diagnosticado por escrito, y el diagnóstico no se aplicó en
todas partes.** Ahora el motivo vive en `Channels::SUPRIMIDOS`, donde un
guardián puede leerlo — y donde cambiarlo obliga a revisar la copia.

## El hueco por el que pasó el guardián que ya existía

`PublicClaimsTest` lleva lotes comprobando que «cada promesa de la página
pública declara qué la sostiene». Esta promesa pasó por delante durante meses.
Dos motivos, los dos arreglados en este lote:

1. **El detector de promesas es una lista de palabras**, y ninguna de las suyas
   estaba en ella: *suprime*, *de inmediato*, *responda STOP*, *suppress*,
   *immediately*, *reply STOP*. Lo que no está en la lista no es una promesa
   para el detector, por mucho que lo sea para quien lo lee. Ampliada la lista,
   salió también `forClients.tracking.body` —cierta, pero sin declarar—.
   Y para que nadie vuelva a estrecharla sin darse cuenta, hay un corpus de
   frases que el detector **tiene** que reconocer, con las dos originales
   dentro.

2. **El registro solo miraba el castellano.** `compromisosPublicos()` se
   llamaba sin argumento. Una promesa escrita únicamente en la página inglesa
   —la que lee un comprador en Estados Unidos— no tenía que declarar nada.

## Lo que este lote NO decide: ¿debería mandarse SMS?

**Esto te toca a ti.** El lote dice la verdad sobre lo que hay; no construye
nada ni lo impide.

A favor: un conductor en la cabina tiene teléfono y no tiene correo abierto. Un
aviso de documento caducado que bloquea el despacho le llega hoy por un canal
que no mira.

En contra: construirlo no es atar Twilio. Es proveedor, número, coste por
mensaje, consentimiento pedido y guardado de verdad, manejo de STOP y HELP con
su ruta de entrada, y una revisión legal de la redacción. La mitad fácil
—mandar— es la que deja el sistema peor que no tener nada: mensajes que salen y
un STOP que no para nada.

Si decides que sí, el sitio por donde se empieza es `Channels::SUPRIMIDOS`:
quitar `sms` de ahí pone en rojo el guardián que exige que la política vuelva a
explicar STOP y HELP **antes** de que salga el primer mensaje.

## Ficheros

| Fichero | Qué |
|---|---|
| `app/Support/Notifications/Channels.php` | El registro: entregados, suprimidos y el motivo |
| `app/Support/Notifications/Notifier.php` | Su lista de canales sale del registro |
| `app/Support/Platform/Providers.php` | SMS informa `unbuilt`; deja de mirar `TWILIO_SID` |
| `app/Support/Marketing/PublicClaims.php` | Tres promesas declaradas con su respaldo |
| `resources/js/pages/Platform/Health.tsx` | Pinta el estado «sin construir» |
| `resources/js/pages/App/Drivers/Show.tsx` | Fuera la fila de consentimiento que nadie puede dar |
| `app/Http/Controllers/App/DriverController.php` | Deja de mandar `smsConsentAt` a una pantalla que no lo enseña |
| `lang/{es,en}/marketing.json` | Sección de SMS, lista de subencargados y descripción para buscadores |
| `lang/{es,en}/auth.json`, `drivers.json`, `platform.json` | Fuera la copia falsa; dentro el estado nuevo |
| `tests/Unit/Suite/SmsPromiseTest.php` | 9 guardianes, condicionados al registro |
| `tests/Unit/Suite/PublicClaimsTest.php` | Vocabulario ampliado, corpus, y el registro bilingüe |
| `tests/Feature/Marketing/SmsClaimTest.php` | Pide la página y lee lo que llega |

## Deuda vecina, nombrada y no tocada

- La columna `notification_preferences.sms` y `drivers.sms_consent_granted_at`
  siguen ahí, vacías. Son datos dormidos, no una afirmación en pantalla; se
  quedan hasta que se decida lo de arriba.
- `auth.json` conserva el resto del bloque `consent`, que tampoco lo pinta
  nadie. Entra en el lote de las 3.044 cadenas muertas.
- El panel llama «Simulado» a `FileScanner` cuando lo que hay es
  `UnavailableFileScanner`: no simula nada, rechaza. Es el mismo defecto que
  acabo de corregir en SMS, una fila más abajo.
