# El tipo que no tenía nombre

## El defecto, tal como se veía

`t()` devuelve **la clave** cuando no encuentra el rótulo. Está escrito así a
propósito en `resources/js/lib/i18n.tsx` —una excepción dejaría la página en
blanco, y eso es peor— y la consecuencia es que un valor sin rótulo no rompe
nada: sale a pantalla tal cual.

En la lista de documentos, medido en el navegador sobre los datos de
demostración:

| Columna | Lo que se leía |
|---|---|
| Tipo | `documents.types.rate_confirmation` |
| Pertenece a | `—` y debajo `documents.owners.load` |

En la **ficha** de ese documento, esa misma clave era el `<h1>` y el título de la
pestaña del navegador:

```
documents.types.rate_confirmation · Goliath Dispatch
```

Ocho filas con `rate_confirmation`, diez con dueño `load`, ocho con dueño
`expense`. En los dos idiomas, porque falta en los dos.

## Tres listas que debían decir lo mismo

| Lista | Tipos |
|---|---|
| CHECK de `documents.document_type` | 27 |
| `App\Enums\DocumentType` | 27 |
| `DocumentTypes::CATALOG` | **22** |
| `types` de `lang/<idioma>/documents.json` | **22** |

Los cinco que faltaban —`rate_confirmation`, `permit`, `route_survey`,
`escort_document`, `invoice`— no eran tipos muertos. **Cuatro los escribe la
propia aplicación:** `Loads\RateConfirmation` el primero, y `Oversize\Papers`
los tres siguientes. El docblock de `DocumentTypes` dice, desde el primer día,
que «la lista de tipos la impone el esquema con un CHECK». No le hacía caso.

Con los dueños, peor: `documents.owner_type` **no tiene ni CHECK**, y la firma de
`Attachment::store()` enumera en su propio `@param` los que escribe —`'load'`,
`'expense'`, `'permit'`, `'escort'`—. Ninguno estaba en ningún catálogo, ninguno
tenía rótulo, y `ownerNames()` sabía buscar el nombre de cuatro dueños de los
nueve. De ahí el guion.

## El barrido: solo aquí

Se comparó **cada dominio cerrado del esquema** —67 pares tabla/columna con
CHECK enumerado— contra el diccionario que lo pinta, en los dos idiomas. El
resto de la aplicación está sano: estados de carga, de factura, de firma,
métodos de pago, acciones de auditoría, papeles, todo tiene rótulo. El único
agujero era el de documentos, y era doble.

## Por qué hizo falta un tercer eje

`forOwner()` contesta a «¿qué puede **elegir** una persona en el formulario?»
—alimenta el `Rule::in` de `LoadDocumentController` y los desplegables— y a la
vez se usaba como si contestara a «¿qué tipos existen?». No es la misma
pregunta, y confundirlas es lo que produjo una pantalla incapaz de nombrar sus
propias filas.

Añadir los cinco sin más habría abierto una puerta de verdad: un despachador
podría subir un fichero declarándolo `rate_confirmation`, y
`RateConfirmation` busca exactamente por ese tipo para decidir si el
transportista aceptó la tarifa. Un fichero cualquiera pasaría por la
confirmación firmada.

Por eso cada entrada del catálogo dice además **quién la crea**:

- `PERSONA` — sale en los formularios de subida.
- `SISTEMA` — solo lo escribe código de la aplicación. Existe, tiene nombre, se
  lee y se filtra; **no se elige**.

`forOwner()` devuelve solo `PERSONA`, y se comprobó que su salida es **idéntica
byte a byte** antes y después: ninguna superficie de subida cambia.

## La regresión que el arreglo introdujo, y quién la cazó

`DocumentController::store` guardaba la puerta con `isKnown()`. Con veintidós
tipos daba lo mismo. Al completar el catálogo a veintisiete, los cinco del
sistema se volvieron «conocidos» y **esa puerta los habría dejado pasar**.

No lo vio el guardián de código —el fichero seguía diciendo lo mismo— sino
`tests/Feature/Documents/DocumentNamesTest.php`, que hace el POST de verdad. La
puerta ahora pregunta «¿puede elegirlo una persona **para este dueño**?», lo que
de paso cierra algo que llevaba abierto desde el principio: con `isKnown()` se
podía colgar un `cdl_front` de un camión.

## Tres copias de la misma lista

Los cuatro dueños de siempre estaban escritos a mano en **tres** sitios: el
desplegable del componente, el `in_array` del filtro en el servidor, y el
diccionario. La del servidor era la peor:

```php
if (in_array($filters['owner'], ['carrier','driver','truck','trailer'], true)) {
```

Aunque el desplegable ofreciera «Carga», el servidor lo descartaba **en
silencio** y devolvía la lista entera. Un filtro que no filtra y no lo dice es
peor que uno que falta, porque quien lo usa cuenta las filas y se cree el
número. Ahora las tres salen de `DocumentOwners`.

## Lo que se construyó

| Pieza | Qué contesta |
|---|---|
| `DocumentTypes::CATALOG` (27) | qué tipos hay, de quién, si son obligatorios y **quién los crea** |
| `DocumentTypes::all()` | qué existe — para NOMBRAR y FILTRAR |
| `DocumentTypes::forOwner()` | qué puede elegir una persona — para los formularios |
| `DocumentOwners` (9) | qué dueños hay, cuáles se eligen y **en qué tabla vive su nombre** |

`DocumentTypes::isRequired()` **lanza** con un tipo desconocido. Antes devolvía
`false` en silencio: una respuesta tranquilizadora sobre un valor que no
reconoce, que es la forma exacta del defecto de este lote.

Diez rótulos nuevos —cinco tipos y cinco dueños— en los dos idiomas.

## El guardián

`tests/Unit/Suite/UnnamedValuesTest.php`, 11 comprobaciones, **22 sabotajes**:

1. El catálogo de tipos cubre el CHECK **entero**, y el enum dice lo mismo. El
   esquema manda: es la única de las tres listas que no se puede convencer — el
   mismo argumento que ya usa `DocumentTypeCheckTest`.
2. Las dos columnas de tipo (`documents` y `load_documents`) admiten lo mismo.
3. El catálogo de dueños conoce **todas** las ranuras de `Papers` y todos los
   literales que llegan a `Attachment::store()`, leídos del fichero.
4. Los cinco del sistema siguen sin poder elegirse a mano.
5. **Todo** valor de un dominio cerrado tiene rótulo en los dos idiomas — 39
   pares dominio/diccionario, no solo los documentos.
6. No queda ninguna copia a mano de la lista de dueños.

Y `tests/Feature/Documents/DocumentNamesTest.php` (8 pruebas) pide las páginas
de verdad: que cada fila traiga tipo con rótulo y dueño **con nombre**, que el
filtro filtre, y que las dos puertas de subida sigan cerradas.

## Deuda que queda, con nombre

- **`documents.owner_type` no tiene CHECK.** `document_type` sí. Ponérselo es lo
  correcto y es una migración sobre una tabla viva; el lote anterior ya pide una
  al desplegar. Mientras tanto, el catálogo y el guardián cubren lo mismo desde
  PHP.
- **`invoice` está declarado y no lo escribe nadie.** Se queda porque el CHECK lo
  acepta: el día que algo escriba una factura como documento, la pantalla ya
  sabrá nombrarla.
- **El filtro de estado de revisión sigue con su lista a mano** en el
  controlador. Hoy coincide exactamente con el CHECK —comprobado— así que no hay
  defecto, solo una copia que podría separarse.
- **122 familias de clave dinámica** hay en el front. El guardián cubre las que
  salen de un dominio cerrado, que son las únicas cuyo conjunto de valores se
  puede enumerar sin adivinar. Declarar las demás a mano y declararlas mal sería
  peor que no declararlas — al montar el registro declaré dos pares equivocados
  y el guardián pidió diez rótulos inexistentes para dos pantallas que estaban
  bien.
