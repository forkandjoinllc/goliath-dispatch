# La ficha que el cliente lee entre llaves

## El defecto

La pantalla de Marca deja editar dos correos, y los dos **no ofrecen las mismas
fichas**:

| Evento | Fichas |
|---|---|
| `invoice.sent` | `{tenant}`, `{invoice}`, `{amount}`, `{url}` |
| `tracking.link` | `{tenant}`, `{url}` |

Están uno debajo del otro, en el mismo formulario, con el mismo aspecto. La
lista de fichas de cada uno aparece en su nota. Nadie impedía copiar el texto de
arriba en el campo de abajo.

Al guardar se comprobaba `max:4000` y nada más. Y `sustituir()` reemplaza
**únicamente las fichas que recibe**: cualquier otra sobrevive tal cual. Medido:

```
entra: «Enlace de {tenant}: {url}. Factura {invoice} por {amount}.»
sale:  «Enlace de Demo Dispatch: https://… . Factura {invoice} por {amount}.»
```

Eso es lo que se manda. El cliente de la casa de despacho recibe un correo con
llaves dentro, firmado por ellos. Nadie avisaba: ni al guardar, ni al enviar.

## Dos sitios, porque son dos momentos distintos

**Al guardar** hay alguien delante que puede arreglarlo. `TenantSettingController`
recorre las dos plantillas y los dos campos **antes de escribir ninguna** —
guardar la primera y rechazar la segunda dejaría la pantalla a medias sin
decirlo— y devuelve 422 nombrando lo que sobra y lo que admite:

> Esta plantilla usa {amount}, {invoice}, que este correo no sabe rellenar:
> saldría con las llaves puestas en el correo que lee su cliente. Las que admite
> son {tenant}, {url}.

**Al enviar** no hay nadie a quien preguntar. `Templates::utilizable()` descarta
la plantilla propia y manda **el texto de siempre**, que siempre es correcto, con
una `Log::warning` que lleva `tenant_id`, `event_key`, `field` y
`unknown_tokens`. Es el único camino que alcanza a las plantillas guardadas
**antes** de que existiera la validación: en la base de datos de producción puede
haber alguna, y una migración que las borrara le quitaría a alguien su texto sin
avisar.

El descarte cae al texto por defecto y no a una cadena vacía. Un correo sin
cuerpo es peor que uno con el texto estándar.

## Lo que faltaba y solo se vio en el navegador

Con las dos capas puestas, la vuelta por el navegador enseñó otra cosa: el 422
llegaba, la pantalla no guardaba nada… y **no pintaba una sola línea**.

La causa es que el servidor nombra el error `templates.0.body`, una ruta con
puntos que no es una clave del formulario. `form.errors.body` no existe. Los dos
`<Campo>` de plantilla eran los únicos del fichero sin `error=`, así que el
rechazo se quedaba en la respuesta.

Desde la silla del usuario eso es indistinguible de «se guardó»: su texto sigue
ahí, no hay mensaje, y el correo que sale es el de siempre. Un servidor que
rechaza bien y una pantalla que se calla dan el mismo resultado que no
comprobar nada.

`errorDe(i, campo)` lee la clave con puntos y los dos campos la pintan.

## Detección

`Templates::fichasDesconocidas()` acepta las dos formas de llave, `{ficha}` y
`{{ficha}}`, porque `sustituir()` acepta las dos: el diccionario usa una y el
esquema documenta la otra, y comprobar solo una dejaría pasar justo la que
alguien copia del esquema.

Lo que no encierra un nombre no es una ficha. `{}`, `{9to5}` y `{ }` se dejan en
paz: un texto puede llevar llaves por mil motivos, y avisar de todas convierte
la comprobación en ruido, que es como se acaba desactivando.

## Lo que NO se toca

- Las plantillas ya guardadas siguen en la base de datos. No se borran ni se
  reescriben; dejan de usarse hasta que alguien las corrija.
- `EDITABLES` sigue siendo la lista corta. Este lote no abre plantillas nuevas.
- El resto de eventos de correo no son editables por la empresa y no pasan por
  aquí.

## Guardianes

`tests/Unit/Suite/TemplateTokensTest.php` (12) y
`tests/Feature/Branding/TemplateTokensTest.php` (8). **18 sabotajes, 18
cazados**, incluido mover el bucle que escribe por encima del que comprueba.

Los tres del final valen la pena por separado: quitar `error=` de cualquiera de
los dos campos, o buscar el error por la clave llana en vez de por la ruta con
puntos, deja la pantalla muda otra vez sin romper nada más.
