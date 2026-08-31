# Cobro de la suscripción

Cómo se le cobra a una empresa por usar Goliath Dispatch.

> **Esto no certifica el cumplimiento de ninguna norma sobre datos de tarjeta.**
> Que los datos de tarjeta no pasen por este servidor es una condición necesaria
> y no suficiente. Qué obligaciones tiene una empresa que cobra suscripciones las
> determinan su proveedor de pagos y su asesor, no este documento. Ver **Lo que
> esto NO es** al final.

## Lo que arregla

El arco terminaba en un callejón. Alguien se daba de alta, `ProvisionTenant` le
creaba una suscripción en `trialing`, el barrido diario movía la suscripción a
`past_due` cuando la prueba acababa… y ahí se quedaba para siempre, porque **no
había forma de pagar**.

`stripe_events` y `payment_attempts` vacías, `stripe_customer_id` nunca escrito.
La pantalla de ajustes lo decía con estas palabras:

> Cambiar de plan pasa por cobrar, y cobrar es otro lote con su pasarela; poner
> aquí un botón que no cobra sería peor que no ponerlo.

Nota sobre `payment_attempts`: **no es de aquí.** Cuelga de `invoices`, que son
las facturas que la casa de despacho le pasa a SUS clientes. Es el libro de
intentos de cobro de una factura de flete, no de una suscripción. Sigue vacía y
sigue esperando su propio lote.

## Ningún dato de tarjeta pasa por este servidor

No hay formulario de tarjeta y no lo habrá. El botón lleva a una **página
alojada por el proveedor** y el pago ocurre allí. Este servidor no ve el número,
no lo registra y no lo guarda.

Es lo que hace que la conversación sobre seguridad de tarjetas sea corta. Meter
un formulario de tarjeta en la aplicación —aunque «solo» reenviara los datos—
convertiría todo este código, sus registros y sus copias de seguridad en asunto
del cumplimiento de tarjetas. No lo son porque no lo tocan.

Lo vigila una prueba: `BillingTest` recorre los cuatro ficheros del módulo
buscando `card_number`, `cvc`, `cvv` y `autocomplete="cc-`.

## El webhook es la fuente de la verdad

Es la decisión que gobierna todo lo demás y la más fácil de equivocar.

Lo tentador es activar la suscripción cuando la persona vuelve de pagar: el
navegador aterriza en `/billing/done`, se marca `active`, y listo. Funciona el
95% de las veces, que es justo lo que lo hace peligroso.

El otro 5% es: paga, se le va el móvil, cierra la pestaña. El pago SÍ ocurre y su
suscripción se queda en `past_due` para siempre. **Nos ha pagado y le hemos
dejado sin sistema.** Se descubre por una llamada furiosa, no por un registro.

Así que `/billing/done` no cambia nada: solo enseña una página, y su texto lo
dice —«no hace falta que esperes aquí; si cierras la ventana, se aplica igual»—.
Quien mueve la suscripción es el suceso del proveedor, que llega aunque no haya
nadie mirando y se reintenta si fallamos.

## La idempotencia la da el índice, no una comprobación

Un proveedor de pagos reenvía: es su comportamiento normal. El mismo suceso
llega dos y tres veces, a veces a la vez.

La forma ingenua —«mira si ya está, y si no, insértalo»— falla justo cuando
importa: dos entregas simultáneas consultan a la vez, las dos ven que no está, y
las dos activan la suscripción. Con un pago eso es un cobro doble; con un fallo
de pago, un cliente suspendido dos veces.

Aquí se INSERTA y decide el índice único de `stripe_events.stripe_event_id`. Si
revienta por duplicado, el suceso ya estaba. Es la base de datos quien resuelve
la carrera, que es el único sitio donde se puede resolver.

`attempts` cuenta los reenvíos, y no es decoración: un suceso que llega catorce
veces significa que algo nuestro contestó mal catorce veces.

## Qué se contesta y por qué

| Situación | Respuesta | Por qué |
|---|---|---|
| Firma inválida | 400 | Que no vuelva. No hay nadie a quien pedirle credenciales. |
| Suceso repetido | 200 | Ya lo procesamos. Un error haría que reenviara para siempre. |
| Suceso que no interesa | 200 | Se guarda igual —el libro es completo— pero no hay nada que hacer. |
| Fallo nuestro al aplicarlo | 500 | Que vuelva. El proveedor sabe reintentar mejor que nosotros. |

## Los estados

`tenant_subscriptions.status` admite seis. Las transiciones:

- `trialing` → `active` al primer pago.
- `active` → `past_due` cuando un cobro falla. **NO se suspende.** Cortarle el
  acceso a una empresa porque su tarjeta caducó un martes es una decisión de
  negocio y no le toca tomarla a un webhook. Suspender sigue siendo un acto
  humano y explícito desde la pantalla de plataforma — la misma decisión que
  tomó el barrido de avisos, por la misma razón.
- `past_due` → `active` cuando el pago siguiente entra.
- cualquiera → `cancelled` cuando el proveedor dice que se acabó. Cancelar no
  borra nada: las cargas, las facturas y los documentos siguen siendo suyos.

`past_due_since` guarda la fecha del **primer** impago, no la del último. Es lo
que contesta «¿cuánto lleva debiendo?», que es la pregunta con la que alguien
decide suspender.

`tenants.status` se mantiene en paralelo, con una excepción: **`suspended` no se
toca nunca desde aquí.** Una empresa puede estar suspendida por un motivo que no
tenga nada que ver con el dinero; lo pone una persona y solo una persona lo
quita.

## Sin credenciales funciona igual

Como FMCSA: sin las dos claves de Stripe se ata `MockBillingProvider` y el arco
entero corre —ir a pagar, pagar, que llegue el suceso, que se active la
suscripción—.

**Hacen falta las dos.** Con solo `STRIPE_SECRET` el adaptador real cobraría y no
se enteraría nunca de que le pagaron: los sucesos llegan por el webhook y sin su
secreto no se pueden verificar. La persona pagaría y seguiría en `past_due`.
Faltando cualquiera de las dos se ata el simulacro, que al menos no cobra.

La página de pago simulada tiene **dos botones, pagar y fallar**, y el segundo es
el importante: el camino del pago rechazado es el que casi nadie prueba y el que
más se sufre, porque es el que deja a un cliente sin sistema. Con un proveedor de
verdad hace falta una tarjeta de prueba especial para provocarlo; aquí es un
botón.

El simulacro **también firma y también verifica**. Si se saltara la comprobación,
el camino de «firma inválida» no se probaría nunca y el día de conectar Stripe se
descubriría que no funcionaba.

Y **no se llama a sí mismo por HTTP**. La primera versión hacía
`Http::post(url('/billing/webhook'))`, que es lo que haría el proveedor de verdad
y parecía lo más fiel: el servidor se quedaba treinta segundos colgado. Una
petición que llama por red a su propio servidor espera a un trabajador que está
ocupado siendo ella misma. Ahora invoca el controlador del webhook, que recorre
el mismo camino en todo lo que importa.

Que el cobro está simulado **se dice en la propia pantalla de facturación**, no
solo en la salud de la plataforma: quien la abre quiere saber si al pulsar
«Pagar» se le va a cobrar, y esa pregunta no se contesta en otra sección.

## Lo que esto NO es

- **No es asesoramiento sobre cumplimiento de pagos.** Que los datos de tarjeta
  no toquen este servidor reduce mucho la superficie; no la elimina como
  obligación, y no la evalúa este documento.
- **No hay prorrateo ni facturas de la suscripción.** Cambiar de plan crea una
  sesión de pago nueva; lo que el proveedor haga con el periodo en curso es cosa
  suya. Los recibos están en su portal.
- **No se aplican los topes del plan.** `max_users`, `max_carriers` y
  `max_loads_per_month` se enseñan y no se impiden. Empezar a bloquear cambiaría
  cómo trabajan empresas que ya están por encima, y eso lo decide el negocio.
- **No hay reclamación de impagos.** Una empresa en `past_due` recibe el aviso
  del barrido y nada más: nadie la persigue ni la suspende sola.
- **`stripe_price_id` de los planes está vacío.** Con Stripe de verdad hay que
  crear los precios allí y anotar sus identificadores aquí, o la sesión de pago
  no sabrá qué cobrar.

## Dónde está

| | |
|---|---|
| Interfaz | `app/Services/Billing/BillingProvider.php` |
| Simulado | `app/Services/Billing/MockBillingProvider.php` |
| Stripe | `app/Services/Billing/StripeBillingProvider.php` |
| Libro de sucesos | `app/Support/Billing/EventLedger.php` |
| Ciclo | `app/Support/Billing/Subscriptions.php` |
| Webhook | `app/Http/Controllers/Public/BillingWebhookController.php` |
| Pantalla | `resources/js/pages/App/Billing/Index.tsx` |
| Credenciales | `STRIPE_SECRET`, `STRIPE_WEBHOOK_SECRET` — en el `.env` del servidor |
| Pruebas | `tests/Feature/Billing/`, `tests/Unit/Suite/BillingStatusTest.php` |
