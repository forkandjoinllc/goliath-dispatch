# Confirmación de tarifa

El papel por el que se discute el dinero, y la fila que dice que el
transportista lo aceptó.

## Por qué esto NO es un enlace anónimo

La ceremonia de firma (`docs/signatures.md`) manda un enlace con token a alguien
que puede no tener cuenta. Esto no. La forma de la tabla lo decide:
`rate_confirmation_acceptances.actor_user_id` es **NOT NULL**, igual que
`document_version_id`.

Y tiene razón el esquema. Quien acepta una tarifa está comprometiendo dinero de
su empresa: hace falta saber **quién** de esa empresa fue, no solo que «alguien
con el enlace» dijo que sí. Un acuerdo marco se firma una vez y admite un
firmante externo; una tarifa se acepta en cada carga y la acepta alguien que ya
trabaja con la casa todos los días.

El permiso es `load:rateconf:respond`, y en `RoleMatrix` **solo lo tiene el rol
transportista**, con alcance de transportista. Quien pone la tarifa no puede
además aceptarla en nombre de quien la cobra.

## Qué lleva el papel, y qué no

Lleva: el corredor, el transportista con su USDOT y su MC, la mercancía, el
peso, las millas, **la tarifa que se le paga al transportista**, las paradas con
sus ventanas, y las instrucciones especiales.

**No lleva lo que la casa le cobra al cliente.** Es un papel para el
transportista; el margen de la casa no es asunto suyo y meterlo ahí sería
regalarlo en cada carga. Hay una prueba que lo comprueba.

## Reemitir crea un documento nuevo

Cada emisión escribe una fila de `documents` **nueva**, no una versión más del
documento anterior. Una confirmación reemitida con otra tarifa es otro papel;
encadenarlas como versiones haría que una aceptación apuntara a un `document_id`
cuyo contenido vigente ya no es el que se aceptó.

De ahí sale el caso que más caro cuesta contar mal: **despacho reemite después
de que el transportista aceptara**. La respuesta anterior sigue siendo cierta
—aceptó aquel papel— pero ya no vale para este. La pantalla lo dice
explícitamente y marca esa respuesta como hecha «sobre una confirmación
anterior», en vez de dejar una marca verde de «aceptado» encima de un papel que
nadie vio.

La comparación se hace por **huella**, no por identificador: `document_sha256`
de la decisión contra el `sha256` del fichero vigente.

## Qué se guarda de cada decisión

| Columna | De dónde sale |
|---|---|
| `decision` | `accepted`, `rejected` o `changes_requested` |
| `decision_reason` | Obligatorio salvo al aceptar — un «no» sin motivo obliga a despacho a llamar |
| `actor_user_id` | El usuario que decidió. NOT NULL por diseño |
| `document_sha256` | Los bytes del PDF **que tuvo delante**, no los de ahora |
| `rated_amount_cents` | La tarifa **congelada** en ese momento |
| `ip_address`, `user_agent` | Desde dónde |

## Lo que no se afirma

El PDF y la pantalla dicen, en los dos idiomas, que esto registra quién aceptó,
cuándo, desde qué IP y con qué huella — y que **por sí solo no constituye un
contrato ni asesoría legal**. Que un registro sea comprobable no lo convierte en
un acuerdo ejecutable, y decir lo contrario sería vender lo que este software no
puede dar.

## Lo que falta

- **Nadie avisa al transportista.** La confirmación se emite y aparece en su
  pantalla, pero no sale un correo. Engancharlo al `Notifier` sí es posible aquí
  —a diferencia de la ceremonia de firma— porque el destinatario **sí** tiene
  cuenta.
- **El estado de la carga no cambia al aceptar.** Aceptar la tarifa y despachar
  la carga siguen siendo dos gestos. Atarlos es una decisión de flujo que
  conviene tomar mirando cómo trabaja de verdad una oficina, no de programa.
- **No hay caducidad.** Una confirmación emitida hace tres meses se puede
  aceptar hoy.

## Dónde vive

| Fichero | Qué hace |
|---|---|
| `app/Support/Loads/RateConfirmation.php` | Emitir, buscar la vigente, anotar la decisión, y el HTML del papel |
| `app/Http/Controllers/App/RateConfirmationController.php` | Las tres rutas, y quién puede cada cosa |
| `resources/js/pages/App/Loads/RateConfirmation.tsx` | La pantalla, la misma para los dos lados |
