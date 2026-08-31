# Papeles de la carga

El albarán, el comprobante de entrega, los tiques de báscula y los recibos de un
viaje. Es el módulo que cierra el ciclo: sin comprobante de entrega no se puede
marcar `pod_received`, y sin `pod_received` no se factura.

## Lo que estaba roto

Este lote no añadió una función que faltara: **arregló una que existía y no
podía funcionar.**

`load_documents` está en el esquema desde el principio, con su `stop_id` para
decir de qué parada es cada comprobante. Hasta ahora la escribía únicamente el
sembrador de demostración —ninguna pantalla ofrecía subir nada— y la única
consulta que la leía, la puerta de `pod_received`, preguntaba por
`document_type = 'proof_of_delivery'`.

Ese valor **no está en el CHECK de `documents.document_type`**. El tipo se llama
`pod`. Ninguna fila podía tenerlo jamás.

Las dos mitades rotas se tapaban entre sí: nadie podía subir un comprobante, así
que nadie llegaba a descubrir que la puerta tampoco lo habría reconocido. El
resultado es que **el estado con el que se factura una carga era inalcanzable en
producción**, y la suite estaba en verde porque las pruebas que tocaban la
puerta escribían el mismo literal equivocado.

Lo guarda ahora `tests/Unit/Suite/DocumentTypeCheckTest.php`, que lee el CHECK
del DDL y falla nombrando cualquier literal del código que ninguna fila pueda
tener. Ver `docs/testing.md`.

## Dos filas, no una

Un papel de carga se guarda en **dos** tablas:

| Tabla | Qué guarda |
|---|---|
| `documents` + `document_versions` | El papel: versiones, revisión, hash del contenido, quién lo subió |
| `load_documents` | El enlace: de qué carga es, y de qué parada |

Meterlo todo en `documents` obligaría a añadirle un `stop_id` que no significa
nada para el certificado de seguro de un transportista. Meterlo todo en
`load_documents` dejaría los papeles de carga sin versiones ni revisión. El
esquema ya tenía la respuesta.

`document_type` se guarda en las dos, duplicado a propósito: el índice
`load_documents_load_type_idx (load_id, document_type)` es lo que hace barata la
pregunta «¿tiene comprobante esta carga?». `LoadFile::attach()` es el único
sitio que escribe las dos, y lo hace en una transacción — un `documents` sin su
enlace es un papel que no sale en ninguna lista, y un enlace sin su `documents`
revienta cualquier consulta que haga el JOIN.

## Los tipos

Cinco, todos del catálogo de `App\Support\Documents\DocumentTypes`:

`bol`, `pod`, `receipt`, `lumper_receipt`, `scale_ticket`.

**Ninguno es obligatorio**, y no por descuido. `requiredFor()` alimenta la puerta
de cumplimiento del transportista —«¿qué le falta para poder llevar carga?»— y un
comprobante de entrega no puede existir antes de la entrega. Declararlo
obligatorio bloquearía a todo transportista recién dado de alta por no tener el
papel de un viaje que aún no ha hecho.

Lo que exige el comprobante es la **puerta de `pod_received`**, que mira esta
carga y no este transportista.

## La parada

`stop_id` es opcional. Una carga con tres entregas tiene tres comprobantes, y
«el comprobante de la carga» no distingue si falta el de la segunda.

El controlador valida que la parada **sea de esta carga**. Sin eso, un id de
parada de otra carga —o de otra empresa— entraría en `load_documents` y el
comprobante saldría colgado de un sitio al que no pertenece.

La dirección de una parada suele vivir en `customer_locations`, no en la fila de
`load_stops`: las columnas `facility_name`/`city`/`state` de la parada quedan a
NULL cuando la parada apunta a una ubicación del cliente. Tanto
`LoadDocumentController::stops()` como `LoadFile::forLoad()` hacen el JOIN. Sin
él, el desplegable decía «Parada 1: recogida».

## Descolgar borra el enlace, no el documento

Son cosas distintas y confundirlas borraría historia. El papel se subió, alguien
lo miró, quedó en la bitácora. Lo que se deshace al descolgar es «este papel
pertenece a esta carga» —que puede haberse colgado de la carga equivocada—, y el
documento sigue existiendo con sus versiones y su revisión.

Borrado suave, como todo lo demás: `deleted_at` con quién y por qué.

## Permisos

| Acción | Permiso |
|---|---|
| Ver la pantalla | `load:read` |
| Subir y descolgar | `load:document:upload` |
| Descargar el fichero | `document:download` |

El ámbito lo aplica `LoadScope::apply()`, igual que el resto de pantallas de
carga: una carga de otra empresa devuelve **404 y no 403** —un 403 confirmaría
que existe—.

Para subir por el formulario genérico de documentos con `owner_type=load`,
`DocumentScope::ownsTarget()` comprueba la carga por su transportista. Nótese la
asimetría deliberada: **leer** la lista de documentos de un transportista NO
incluye los de sus cargas —eso se ve desde la carga—, pero **subir** el
comprobante de una carga suya sí tiene que poder hacerlo.

## Límites

25 MB por fichero. Un comprobante de entrega es una foto hecha con el móvil desde
la cabina, y las de un móvil moderno pasan de 10 MB sin esforzarse. Cortar más
abajo obligaría al conductor a buscar cómo reducirla, que es lo que hace que el
papel no llegue nunca.

El tipo MIME se comprueba **por contenido** con finfo, no por la extensión del
nombre. Un `.pdf` que por dentro es otra cosa no pasa.

Sin antivirus configurado, `malware_scan_status` queda en `pending`. No se dice
que un fichero está limpio sin haberlo mirado.

## Dónde está

| | |
|---|---|
| Pantalla | `resources/js/pages/App/Loads/Documents.tsx` |
| Controlador | `app/Http/Controllers/App/LoadDocumentController.php` |
| Escritura y lectura | `app/Support/Documents/LoadFile.php` |
| La puerta | `app/Support/Loads/Guards::forPod()` |
| Rutas | `loads.documents.{index,store,destroy}` |
| Diccionario | `lang/{es,en}/loads.json` → `documents.*` |
| Pruebas | `tests/Feature/LoadDocuments/` |
