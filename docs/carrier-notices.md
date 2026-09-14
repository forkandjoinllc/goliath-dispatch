# Los diecisiete interruptores del transportista

## El defecto

Un transportista o un conductor abría «De qué se le avisa» y configuraba
diecisiete sucesos. **Ninguno podía llegarle.** `Notifier::recipients()` elige
destinatario por permiso con alcance de empresa o más, y esos dos roles lo
tienen todo con alcance de transportista (`Scope::Carrier`) o propio
(`Scope::Own`). Diecisiete casillas que no encendían nada.

Y la regla del emisor **era correcta**, con su motivo escrito allí mismo: el rol
transportista tiene `invoice:read` con alcance de transportista, y avisarle de
que «hay facturas vencidas» le contaría que existen las de los demás. No había
que ablandarla. Faltaba la otra mitad: **avisarle de lo suyo.**

## Los dos silencios que había detrás

**Al rechazarle un documento**, la pantalla de revisión le exige al revisor un
motivo de diez caracteres como mínimo, con este argumento escrito en la copia:

> «Diga qué le falta o qué está mal — al menos diez caracteres. **El
> transportista lo va a leer**, y "rechazado" a secas garantiza una segunda
> subida igual de mala.»

El motivo se guardaba, era legible en el historial de revisiones de la ficha del
documento… y nada se lo decía. Se enteraba si abría ese documento, y el motivo
por el que lo abriría era que alguien le hubiera dicho que lo mirara. El
producto le pedía trabajo a una persona en nombre de un lector al que nunca se
le anunciaba que existiera.

**Al pedirle correcciones en la incorporación**, lo mismo: `correction_notes` se
guarda, sale en su ficha, y nadie se lo cuenta.

## Qué se ha hecho

1. **Un registro de sucesos** (`App\Support\Notifications\Events`): cada aviso
   declara su permiso y su público —la oficina o un transportista concreto—. De
   ahí salen las dos cosas que antes se decidían por separado y podían
   contradecirse: a quién se le manda, y qué interruptores se le enseñan.

2. **Una vía nueva** (`Notifier::toCarrier`): los destinatarios son los usuarios
   de UN transportista, filtrando por las tres cosas juntas —empresa,
   `carrier_id` y rol— más la membresía activa y el permiso. El aislamiento vive
   en el emisor y no en quien llama: si el id fuera de otra empresa, el filtro
   por `tenant_id` devuelve a nadie en vez de devolver a los de la otra.

3. **Los dos avisos**, con su copia en los dos idiomas y su casilla para
   apagarlos.

4. **La pantalla dice la verdad**: a cada rol se le ofrecen los sucesos que
   pueden llegarle, y a quien no tiene ninguno se le explica en vez de
   enseñarle una tabla vacía.

La copia PORTADA de estos dos sucesos existía —`notification.json` la traía en
los dos idiomas— pero estaba escrita **para la oficina**: «El documento X de
{ownerName} fue rechazado». Aquí el que lee es el dueño del documento, y
decirle «el documento de Acme» cuando él ES Acme delata que el texto se copió
sin mirar. Se reescribió en segunda persona; hay un guardián que lo sujeta.

## Lo que esto destapó y NO arregla: el despachador recibe dos de diecinueve

Al derivar la lista por rol salió esto:

| Rol | Sucesos que puede recibir |
|---|---|
| Administrador | 17 |
| Contabilidad | 14 |
| **Despachador** | **2** |
| Transportista | 2 (los nuevos) |
| Conductor | 0 |

El despachador —quien mueve las cargas todos los días— solo puede recibir los
dos de la suscripción. No es un fallo nuevo: es la regla del emisor aplicada a
sus permisos, que son de alcance **asignado**. Quien puede leer un documento
debería enterarse de que caduca, dice el propio `Notifier`; el despachador puede
leerlo, pero con alcance asignado, y la regla lo deja fuera.

Arreglarlo es el mismo trabajo que este lote acaba de hacer para el
transportista, un nivel más arriba: una vía que mande **a los asignados** lo de
los recursos que llevan. No se ha hecho aquí porque es su propio lote y porque
decidir que el despachador reciba avisos de documentos es una decisión de
producto — hoy no los recibe y nadie se ha quejado, lo cual también es un dato.

**Queda abierto y es tuyo.**

## Lo que sigue sin tener aviso dirigido

De los diez sucesos que el original mandaba y este no (ver
`docs/ported-dictionaries.md`), este lote construye dos. Siguen fuera:
`expense.rejected` —un conductor presenta un gasto, se le rechaza con motivo, y
el motivo sí se le enseña en su lista, así que el silencio duele menos—,
`onboarding.approved`, `onboarding.rejected`, `load.assigned`, `export.ready`,
`invoice.sent`, `signature.requested` y `load.rate_confirmation_requested`.
Los cuatro últimos ya tienen su propio correo, que no es lo mismo que un aviso
dentro de la aplicación pero cumple.

## Ficheros

| Fichero | Qué |
|---|---|
| `app/Support/Notifications/Events.php` | El registro: suceso ⇒ permiso + público |
| `app/Support/Notifications/Notifier.php` | `toCarrier()`, con el aislamiento dentro |
| `app/Support/Documents/DocumentScope.php` | `carrierOf()`: el mapa leído al revés |
| `app/Http/Controllers/App/DocumentController.php` | Avisa al rechazar |
| `app/Http/Controllers/App/CarrierOnboardingController.php` | Avisa al pedir correcciones |
| `app/Http/Controllers/App/NotificationController.php` | La lista sale del registro, por rol |
| `resources/js/pages/App/Notifications/Index.tsx` | Sin sucesos, se explica |
| `lang/{es,en}/notifications.json` | Los dos avisos y el texto del caso vacío |
| `tests/Unit/Suite/CarrierNoticeTest.php` | 7 guardianes de estructura |
| `tests/Feature/Notifications/CarrierNoticeTest.php` | 9 que miden, incluido el aislamiento |
