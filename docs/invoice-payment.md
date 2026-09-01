# Cobrar una factura de flete

## El hueco

«Enviar factura» la marcaba como enviada y nada más. La pantalla lo decía con
cuidado —«la factura quedó MARCADA como enviada»— así que no mentía, pero era el
hueco funcional más grande que quedaba: **la factura no salía de aquí**. El
despachador la mandaba por su cuenta desde su correo, el transportista pagaba por
transferencia, y alguien lo apuntaba a mano.

## Cuidado con quién es «el cliente»

Esta factura es lo que la casa de despacho le cobra al **transportista** por su
tarifa de despacho — no lo que le cobra al dueño de la carga por el flete.
`invoices.carrier_id` es obligatorio y `customer_id` no. Quien abre la página
pública es el transportista.

## A quién va

Al contacto de **facturación** del transportista si lo tiene; si no, al principal;
si no, al correo de la empresa. Mandarle una factura al jefe de tráfico es cómo se
consigue que la pague nadie.

Y en el idioma de ESE contacto: `carrier_contacts.preferred_locale` existe y dice
literalmente «el idioma en el que se le escribe a esta persona». Es más fino de lo
que se pudo hacer con el enlace de rastreo, donde el cliente de la carga no tiene
columna de idioma y hay que caer en el de la empresa.

El correo lleva la cara y las palabras de la empresa: `invoice.sent` es un evento
reescribible, con sus fichas `{tenant}`, `{invoice}`, `{amount}` y `{url}`. Ver
docs/branding.md.

## El enlace

En `invoices`, no en una tabla aparte: una carga puede tener varios enlaces de
rastreo —uno por destinatario— y una factura tiene uno, que va a quien la debe.

Se guarda **solo el hash** del testigo, como en el rastreo y en las invitaciones.
Reenviar el enlace anterior es imposible por construcción; volver a mandar la
factura emite uno nuevo e invalida el viejo, que es lo correcto si se mandó a la
dirección equivocada.

**Caduca noventa días después del VENCIMIENTO**, no unas horas después de
emitirse. Un enlace de rastreo caduca pronto porque el viaje dura poco; una
factura hay que poder pagarla mientras se deba, y un enlace que caduca antes es
una llamada a soporte y una factura que se cobra más tarde. Sigue caducando: un
testigo al portador que no caduca nunca acaba viviendo para siempre en el
historial de alguien.

## Qué se enseña en la página pública

El número, a nombre de quién, las fechas, las líneas, el total y el saldo. **Nada
del margen de la casa de despacho.** La consulta pide las columnas una a una, y
`tests/Unit/Suite/InvoicePublicSafetyTest.php` falla si alguien la cambia por un
`first()` sin lista: la filtración no daría ningún error — saldría bien y de más.

## Intento y cobro son dos cosas

`payment_attempts` guarda TODO lo que se intentó; `payments`, solo el dinero que
llegó.

La diferencia importa el día que un transportista dice que lo intentó tres veces.
Con solo `payments` la respuesta es «no consta ningún pago», que es cierta y no
ayuda; con los intentos se ve cuántos hubo, con qué código fallaron y a qué hora —
y eso es lo que se le manda a la pasarela.

### La idempotencia identifica UN intento, no una factura

`payment_attempts_idempotency_uq` es único sobre `idempotency_key`, y la clave la
genera el arranque del cobro:

- si ya hay un intento **pendiente** por ese importe, se reutiliza su clave — dos
  pulsaciones del mismo botón son un solo cobro;
- si el anterior ya se resolvió, se abre uno **nuevo** — volver a intentarlo tras
  un rechazo es exactamente lo que toca.

La primera versión ataba la clave a la factura y el importe, y tenía las dos
propiedades al revés: el doble clic se colapsaba bien y **un pago rechazado dejaba
la factura impagable para siempre**. Lo encontró el navegador, porque el recorrido
probó el camino del fallo antes que el del éxito.

La ventana la cierra el ÍNDICE, no un `if`: entre un «¿ya existe?» y un insert hay
un hueco, y las pasarelas reintentan justo ahí. En un solo hilo las pruebas pasan
igual y el doble cobro aparece en producción.

### Marcar pagada la factura es del resultado, no del navegador

La vuelta del transportista a la página no cambia nada. Lo que mueve la factura es
lo que dice el proveedor. Misma decisión que el lote 54 para la suscripción: quien
paga y cierra la pestaña no puede quedarse sin que conste.

**Un pago parcial no da la factura por pagada.** Solo se cierra cuando el saldo
llega a cero; darla por pagada debiendo es cómo se pierde dinero sin que salte
ninguna alarma.

## Sin pasarela

`InvoicePaymentProvider` es una interfaz aparte de `BillingProvider`, y a
propósito: aquella es NOSOTROS cobrándole la suscripción a la casa de despacho —
el dinero llega a nuestra cuenta—; esta es la casa de despacho cobrándole a su
transportista, y con Stripe eso es Connect: otras credenciales, otra integración y
otra responsabilidad legal. Una sola interfaz habría dejado un `checkoutUrl` que a
veces cobra para nosotros y a veces para otro, decidido por un parámetro.

El adaptador simulado manda a una página propia con los dos botones —aceptado y
rechazado— para poder recorrer entero el camino del fallo. **La página pública
dice que el cobro es simulado**, encima del botón: quien pulsa va a mirar su
cuenta después.

Y no se llama a sí misma por HTTP: resuelve el intento invocando
`InvoicePayments` directamente. Es la lección del lote 54 — una petición que llama
por red a su propio servidor espera a un trabajador que está ocupado siendo ella
misma.

## Lo que falta

- **No hay adaptador real.** Stripe Connect, con las credenciales de cada empresa,
  es un lote propio — y hasta que exista, esto no cobra.
- **No hay PDF.** `invoices.pdf_document_id` sigue vacío: el correo lleva un
  enlace, no un adjunto, y el texto lo dice.
- **No hay recordatorios.** Una factura vencida avisa a la casa de despacho por el
  barrido; al transportista no le llega nada.
- **No hay devoluciones.** `refunded_amount_cents` y el estado `refunded` existen
  y no los escribe nadie.
- **No se comprueba que `amount_paid + balance = total`.** Hoy lo mantiene el
  código que suma; una fila descuadrada por otra vía no la detecta nada.

## Dónde vive

| | |
|---|---|
| El enlace y el correo | `app/Support/Finance/InvoiceLink.php` |
| Intentos y cobro | `app/Support/Finance/InvoicePayments.php` |
| La interfaz | `app/Services/Payments/InvoicePaymentProvider.php` |
| Sin pasarela | `app/Services/Payments/MockInvoicePaymentProvider.php` |
| La página del transportista | `app/Http/Controllers/Public/InvoiceController.php` |
| Emitir | `app/Http/Controllers/App/InvoiceController.php@send` |
| Pantallas | `resources/js/pages/Public/Invoice.tsx`, `Public/MockInvoicePayment.tsx` |
| Pruebas | `tests/Feature/Invoicing/PublicInvoiceTest.php`, `tests/Unit/Suite/InvoicePublicSafetyTest.php` |
