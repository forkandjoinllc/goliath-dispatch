# Firmas electrónicas

Qué hace este módulo, qué NO afirma, y qué hay que poner en el servidor.

## Lo que se afirma, y lo que no

Esto **registra** quién firmó, cuándo, desde qué IP y con qué navegador, junto
con huellas criptográficas del texto exacto que se mostró, de la firma capturada
y del PDF generado. Todo eso queda comprobable después, y el detalle de cada
solicitud lo vuelve a comprobar cada vez que alguien lo abre.

Esto **no garantiza** la validez legal de ningún acuerdo en ninguna
jurisdicción. La pantalla lo dice, en los dos idiomas, tanto al firmante durante
la ceremonia como en el certificado de auditoría. El texto vino del diccionario
portado y no se ha suavizado:

> Este proceso registra quién firmó, cuándo, desde qué dispositivo y dirección
> IP, y una huella criptográfica del documento exacto que usted vio. Por sí
> solo, no garantiza la validez legal de este acuerdo en su jurisdicción — se
> recomienda a las partes obtener asesoría legal propia sobre lo firmado.

Las tres plantillas de partida llevan además, dentro de su propio cuerpo, un
párrafo que dice que son un ejemplo del programa y que hay que revisarlas con un
abogado antes de mandárselas a nadie.

## Lo que hay que poner en el servidor

```
SIGNATURE_HASH_PEPPER=
```

Es la clave con la que se hace el HMAC del sello de integridad. Genera una con:

```
php -r "echo bin2hex(random_bytes(32));"
```

**Si se deja vacía, la aplicación funciona igual**: `App\Support\Signatures\Seal`
deriva una clave a partir de `APP_KEY`. Es una red de seguridad para que un
despliegue olvidadizo no tumbe nada, no la recomendación. Lo que cuesta dejarla
vacía: el día que se rote `APP_KEY`, **todos los sellos anteriores dejan de
validar**. El detalle de cada firma avisa en pantalla mientras se esté usando la
clave derivada.

La clave, una vez puesta, **no se cambia nunca**. Cambiarla invalida los sellos
igual que rotar `APP_KEY`.

## Por qué el sello lleva clave y la cadena no

Son dos defensas contra dos cosas distintas.

El **sello** (`signature_records.integrity_seal`) es un HMAC-SHA256 sobre la
huella de la plantilla, la del documento, la de la firma, la identidad del
firmante y el instante. Lleva clave —y la clave no está en la base de datos—
porque un sha256 a secas lo puede recalcular cualquiera que tenga la fila: quien
modificara el registro reescribiría el sello para que cuadrara. Con HMAC, un
atacante con MySQL o con una copia de seguridad robada puede alterar la fila
pero no puede volver a sellarla.

La **cadena** (`signature_audit_events.event_hash`) es
`sha256(hash_anterior || canónico del evento)`. No lleva clave, y por tanto quien
pueda escribir en la tabla y sepa cómo se calcula podría rehacerla entera. Sirve
para lo que sirve: detecta que falte un evento del medio o que esté desordenado,
que es lo que produce una manipulación torpe o una restauración parcial.

Además, MySQL tiene disparadores propios: `signature_audit_events` rechaza UPDATE
y DELETE; `signature_records` rechaza DELETE y rechaza cambiar sello, huellas,
nombre del firmante y fecha de firma.

## La verificación se recalcula, nunca se lee

El detalle de una solicitud recalcula las tres comprobaciones en cada visita:

| Pregunta | Cómo se contesta |
|---|---|
| ¿Los datos de esta fila son los que se sellaron? | Se recalcula el HMAC y se compara con `hash_equals` |
| ¿El fichero guardado sigue siendo el que se firmó? | Se lee el PDF entero del disco y se le saca el sha256 |
| ¿La bitácora está entera y en orden? | Se recorren todos los eventos rehaciendo la cadena |

No hay ninguna columna «verificado». La habría podido poner en verde el mismo
`update` que rompiera lo que dice proteger.

Un caso con nombre propio: si el fichero **no está**, eso no es «documento
alterado», es «no se puede comprobar». La pantalla lo distingue, porque decir
que algo falló cuando lo que pasa es que no se pudo mirar es mentir en la
dirección más cara.

## Versionar una plantilla

Publicar una versión **escribe una fila nueva** y retira la anterior. Nunca
edita. La razón está en `content_hash`, que viaja copiado dentro de cada
solicitud y de cada registro: si el texto de una versión ya firmada pudiera
cambiar, la huella guardada dejaría de coincidir con el texto y sería imposible
saber cuál de los dos se firmó.

Al publicar:

- Las solicitudes en `pending` o `viewed` sobre versiones viejas pasan a
  `superseded`. No se le pide a nadie que firme un texto que la casa ya retiró.
- Las **firmadas no se tocan**. Siguen siendo válidas para el texto que sí se
  firmó, y aparecen agrupadas bajo «requiere nueva firma», que es una decisión
  de la casa y no un borrado.

## Los correos

Salen dos, y **no pasan por `Notifier`**. Esa clase es el único sitio que
escribe en `notifications`, y esa tabla tiene `user_id` NOT NULL más un índice
único sobre `(dedupe_key, user_id, channel)`: toda su forma da por hecho que el
destinatario tiene cuenta, porque de ahí saca el idioma, las preferencias de
canal y el sitio donde deduplicar. El firmante de un acuerdo **no tiene cuenta**
— es la premisa entera de la ceremonia. Meterlo ahí habría exigido un usuario
falso o una columna nullable que rompe el índice.

`App\Support\Signatures\Mailer` manda el correo y nada más. El idioma sale de
`signature_requests.locale`, no de la petición: si lo cogiera de la petición, el
correo que sale de un despachador trabajando en inglés llegaría en inglés a
alguien al que se le escribió en español.

Un fallo de correo **no deshace nada**. La solicitud ya está creada, el enlace ya
se enseñó en pantalla para copiarlo a mano, y el evento `emailed` solo se anota
si el envío salió de verdad.

El aviso de copia firmada **no adjunta el PDF**. El diccionario portado promete
un adjunto (`email.signedCopyBody` dice «adjuntamos su copia firmada»); mandar
el acuerdo a un buzón que no controlamos y que se reenvía tres veces es una
decisión, no un efecto secundario de una frase. Se usa `email.signedCopyNotice`,
que dice la verdad, y la copia se descarga desde la aplicación.

## Las descargas

Los dos PDF son documentos normales del transportista, así que se bajan por
`/documents/{id}/download` — con su permiso, su comprobación de ámbito y su fila
en `document_access_logs`. Duplicar todo eso habría sido una segunda puerta a
los mismos ficheros, con sus propias comprobaciones que mantener.

El certificado tiene además su propia ruta, `/signatures/{id}/certificate`, que
anota `certificate_downloaded` en la bitácora antes de redirigir. Es un evento
de la ceremonia: forma parte de lo que hay que poder contar después.

## Lo que este lote NO construyó

- **`signature_requests.subject_type` solo se usa con `carrier`.** El esquema
  admite `load` y `tenant`; no hay pantalla que los cree todavía.
- **`notification_templates` sigue vacía.** Es la personalización de textos por
  empresa y necesita su propio editor.

## Dónde vive cada cosa

| Fichero | Qué hace |
|---|---|
| `app/Support/Signatures/Seal.php` | El HMAC, la forma canónica y la clave |
| `app/Support/Signatures/Ceremony.php` | La bitácora y su cadena |
| `app/Support/Signatures/Verifier.php` | Las tres comprobaciones, recalculadas |
| `app/Support/Signatures/Templates.php` | Sembrar, publicar versión, retirar |
| `app/Support/Signatures/TemplateBody.php` | Variables, huella y sustitución |
| `app/Support/Signatures/SigningLinks.php` | El token y los seis estados |
| `app/Support/Signatures/Signing.php` | Capturar, generar, guardar y sellar |
| `app/Support/Signatures/Renderer.php` | Los dos PDF, con dompdf |
| `app/Support/Signatures/DefaultTemplates.php` | Las tres plantillas de partida |
| `app/Support/Signatures/Mailer.php` | Los dos correos, en el idioma de la solicitud |
