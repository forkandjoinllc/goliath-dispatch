# La cara de la empresa

## Por qué existe

El lote 59 hizo que al despachar una carga le SALGA de verdad un correo al
cliente de la casa de despacho. Y su documento lo dejó escrito como hueco: ese
correo iba en texto plano y con nuestro nombre, cuando quien lo recibe no es
cliente nuestro sino de ellos. Lo mismo la página pública de rastreo, que el
cliente abre desde ese correo: decía el nombre de la empresa al pie y por lo
demás tenía nuestros colores.

`tenant_branding` y `notification_templates` llevaban en el esquema desde el
primer día y estaban vacías.

## Dónde se ve, y dónde NO

Se ve donde mira **alguien que no es usuario nuestro**:

- la página pública de rastreo — logo, color principal en la barra superior y
  color de acento en las paradas;
- el correo que reparte esa página — el asunto y el cuerpo que la empresa haya
  escrito, y su pie.

**No cambia nada dentro de la aplicación.** El equipo de la casa de despacho la
sigue viendo con nuestros colores, y eso es deliberado: repintar la aplicación
entera por empresa multiplica por N las combinaciones de contraste que hay que
sostener, y el beneficio se lo lleva quien ya nos ha comprado.

## Lo que se guarda es texto, aunque la columna se llame `_html`

Las columnas son `email_header_html` y `email_footer_html`. Aun así **no se
acepta HTML**, y no por pereza: ese texto lo escribe el administrador de una
empresa y viaja en un correo a un TERCERO que no nos conoce. Aceptar marcado
libre ahí es regalar un vector de suplantación —un bloque «confirme sus datos
bancarios» con el aspecto del resto del mensaje— a cambio de dejar poner
negritas.

Se limpia **al leer**, no solo al escribir: una defensa que solo está en el
formulario se salta con un `update`. Lo mismo el color, que se valida como
`#RRGGBB` en las dos direcciones. Lo fija
`tests/Unit/Suite/BrandSafetyTest.php`, verificado saboteando.

Los colores entran en la página como variables CSS aplicadas a elementos
concretos, no como una hoja de estilos de la empresa: un color mal puesto puede
dejar un texto feo, pero no puede ejecutar nada.

## El logo se sirve sin firma, y por qué

`GET /b/{tenant}/logo` es público. Una dirección firmada caduca en minutos y el
correo que la lleva puede abrirse días después; una ruta con sesión no sirve
porque el cliente no tiene cuenta. Y un logo es lo que esa empresa ya tiene en su
web y en la puerta de sus camiones.

Lo único que se cuida es que la dirección no diga nada más: contesta 404 igual
cuando la empresa no existe y cuando existe y no ha subido logo. Distinguirlo la
convertiría en una forma de enumerar empresas.

**El logo no viaja dentro del correo.** Incrustado engorda cada mensaje, y una
dirección firmada caduca mientras el correo vive para siempre. El logo vive en la
página, que es donde el cliente mira.

## Las plantillas: solo lo que sale fuera

`Templates::EDITABLES` tiene hoy un evento: el correo del enlace de rastreo. Los
avisos internos —documento que caduca, factura vencida— siguen saliendo del
diccionario.

La distinción no es técnica, es de responsabilidad: el texto que lee un cliente
ajeno lo firma la casa de despacho y tiene que poder escribirlo ella; el que lee
su propio equipo forma parte de la aplicación, y dejar que cada empresa reescriba
sus avisos internos convierte cada informe de soporte en una adivinanza sobre qué
decía realmente la pantalla.

### Una plantilla no puede romper un aviso

- Sin plantilla, el texto de siempre.
- Con plantilla pero sin asunto, el asunto de siempre. Un asunto propio con el
  cuerpo de siempre también es legítimo.
- Una ficha mal escrita **se deja como está** en vez de vaciarse:
  `{{tenatn}}` se ve en el correo y se arregla; sustituido por vacío, no se
  entera nadie.
- Borrar los dos campos borra la plantilla, que es la única forma de volver al
  texto de siempre sin tener que recordarlo y reescribirlo.

Se admiten `{{ficha}}` y `{ficha}`: el diccionario usa una llave y el esquema
documenta dos, y quien copie el texto de siempre en una plantilla no debería
encontrarse con que ya no se sustituye nada.

### Un idioma, no dos

La plantilla se guarda en `tenants.default_locale`, que es el idioma en el que
sale el correo. Un segundo editor para el otro idioma sería un campo que nadie
usa y que nadie sabría que existe. Cuando haga falta escribirle a cada cliente en
su idioma habrá que poner idioma al cliente primero —está en «lo que falta» de
docs/tracking-link.md— y entonces este editor crecerá con un motivo.

## Lo que falta

- **La cabecera del correo.** `email_header_html` sigue sin usarse: el correo es
  texto plano y una cabecera de texto encima del mensaje no aporta nada que no
  aporte el asunto. Entra el día que el correo sea HTML.
- **Las tipografías.** `heading_font` y `body_font` están en la tabla y no se
  usan. Cargar una tipografía de terceros en la página pública añade una petición
  a un dominio ajeno desde una página que abre un cliente; no compensa todavía.
- **Los otros tres colores.** `neutral_color`, `surface_color` e `ink_color`
  existen y no se editan: dos colores bastan para que la página se reconozca, y
  cinco son cinco formas de dejar un texto ilegible.
- **El favicon.** `favicon_storage_key` sigue vacío.

## Dónde vive

| | |
|---|---|
| La marca | `app/Support/Branding/Brand.php` |
| Las plantillas | `app/Support/Branding/Templates.php` |
| El logo público | `app/Http/Controllers/Public/BrandLogoController.php` |
| Se edita en | `app/Http/Controllers/App/TenantSettingController.php@branding` |
| Se ve en | `resources/js/pages/Public/Tracking.tsx`, `app/Support/Tracking/LinkMailer.php` |
| Pruebas | `tests/Feature/Branding/BrandTest.php`, `tests/Unit/Suite/BrandSafetyTest.php` |
