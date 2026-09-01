# El enlace de rastreo que se manda al cliente

## La promesa

El sitio público la hace en **cinco** sitios —el paso 4 de «cómo funciona», la
página de servicios, la de clientes y dos descripciones de SEO—:

> «Una vez despachada su carga, recibirá un enlace seguro por correo electrónico
> — no un usuario y contraseña. Ábralo cuando quiera para ver el estado desde la
> recolección hasta la entrega.»

No salía ningún correo. `public_tracking_links.recipient_email` se pedía en el
formulario, se guardaba y no lo leía nadie; nada se disparaba al despachar.

Lo que hace este caso distinto de los cuatro lotes anteriores de la misma familia
es a quién se le miente: **es un argumento de venta, y se lo hacemos a alguien que
no es nuestro usuario.** Un cliente de la casa de despacho lee la frase, no le
llega nada, y quien queda mal no somos nosotros.

## A quién va

Al **contacto principal** del cliente, y si no tiene, al correo del propio
cliente. En ese orden y no al revés: `customers.email` suele ser la dirección
general de facturación, y el enlace de una carga concreta le sirve a quien la
espera, no a contabilidad.

Si no hay ninguno de los dos no se manda y no pasa nada. Una carga sin dirección
de contacto es un dato que falta, no un error que haya que gritar en mitad de un
despacho.

## Cuándo

Al despachar, que es exactamente lo que dice el sitio público. **Una sola vez por
carga**: si vuelve a pasar por despachada —una corrección, una reasignación— no
sale otro. Dos correos con dos enlaces distintos para la misma carga es cómo se
consigue que el cliente abra el que ya no vale.

Y **no se manda si la empresa apagó los enlaces públicos**. `public_tracking_enabled`
ya existía y ya lo respetaba la creación manual; un ajuste que la creación manual
respeta y el envío automático se salta sería el mismo defecto de siempre por la
puerta de atrás.

## Qué pasa si el correo falla

Nada grave, y a propósito. El envío va **fuera de la transacción** del cambio de
estado —mandar un correo dentro de una transacción abierta la mantiene viva
mientras se habla con un servidor SMTP, y si luego algo la revierte el correo ya
se ha ido y no vuelve— y una excepción se registra y se traga.

La carga sale igual. El enlace queda creado y **sin marcar como enviado**, y se
puede mandar a mano desde la pantalla de rastreo. Impedir despachar porque el
servidor de correo tuvo un mal minuto sería mucho peor que el problema.

## `sent_at`, y por qué no basta con la dirección

La columna es nueva. La diferencia importa cuando un cliente llama diciendo que
no le llegó nada:

- con la dirección sola, solo se puede contestar «a esa dirección era»;
- con la fecha se contesta «salió el martes a las 9:14, mire en el correo no
  deseado» o «no salió, se lo mando ahora».

Son dos conversaciones completamente distintas.

## Mandarlo a mano

La pantalla de rastreo tiene un campo para mandarlo a una dirección concreta.
**Emite un enlace nuevo**, no reenvía el anterior: del anterior solo se guarda el
hash del token, así que reenviarlo es imposible por construcción — y esa
propiedad conviene conservarla, no rodearla. El texto de ayuda lo dice, para que
nadie crea que el enlace viejo dejó de valer.

## El idioma

`tenants.default_locale`, y **no** el idioma en que está trabajando quien
despacha: un despachador que tiene la aplicación en español no decide en qué
idioma lee su cliente. El prefijo del idioma va también en la URL, porque el
cliente abre el enlace desde un correo, sin sesión ni cookie.

## Qué NO lleva el correo

Solo la dirección. Ni adjuntos ni datos de la carga: quien abre el enlace ve lo
que la página pública decida enseñar, que es un sitio donde ya está pensado qué se
enseña y qué no. Meter aquí el número de carga o el nombre del transportista sería
filtrar por correo lo que la página controla.

## Lo que falta

- **El idioma es por empresa, no por cliente.** Ni `customers` ni
  `customer_contacts` tienen columna de idioma, así que una casa que trabaja en
  inglés escribe en inglés también a sus clientes hispanohablantes. `carriers` sí
  la tiene —«el idioma en el que se le escribe a esta persona»— y la asimetría no
  tiene ninguna razón de ser.
- ~~El correo no lleva la cara de la empresa.~~ Hecho en el lote 61: el asunto y
  el cuerpo los puede escribir la empresa, y su pie va al final. Ver
  docs/branding.md — el logo sigue sin viajar dentro del correo, y ahí se explica
  por qué.
- **No se avisa de nada más.** Solo el despacho manda correo al cliente. Ni la
  entrega, ni un retraso, ni el comprobante.
- **No hay reintento.** Si el correo falla, falla: queda el `sent_at` en nulo y
  alguien tiene que darse cuenta. La tabla `job_queue` existe y está vacía.

## Dónde vive

| | |
|---|---|
| El mensaje | `app/Support/Tracking/LinkMailer.php` |
| A quién y cuándo | `app/Support/Tracking/CustomerLink.php` |
| Los enlaces | `app/Support/Tracking/TrackingLinks.php` |
| El disparo | `app/Http/Controllers/App/LoadController.php@transition` |
| Mandar a mano | `app/Http/Controllers/App/TrackingController.php@sendLink` |
| Pantalla | `resources/js/pages/App/Tracking/Show.tsx` |
| Pruebas | `tests/Feature/Tracking/CustomerLinkTest.php`, `tests/Unit/Suite/TrackingLinkPromiseTest.php` |
