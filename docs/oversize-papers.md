# Los papeles de una carga sobredimensionada

## El defecto

Una carga sobredimensionada no se despacha hasta que alguien con
`permit:approve_ready` declara que **los papeles están todos**. Esa puerta
existe y funciona desde el lote 55.

Lo que no existía era el papel:

| Columna | Estado antes |
|---|---|
| `permits.document_id` | En el esquema desde el primer día. **Sin escribir.** |
| `permits.route_survey_document_id` | Igual |
| `escorts.document_id` | Igual |
| `permits.expires_at` | Se guardaba. **No lo miraba nadie.** |

Y los tres rótulos ya estaban escritos en el diccionario **vivo** —«Documento
del permiso», «Documento del estudio de ruta», «Documento de la escolta»— sin
que ninguna pantalla los pidiera.

O sea que la oficina marcaba el permiso como emitido, declaraba los papeles
completos, y el conductor salía sin ninguno. Un permiso de sobredimensión es
exactamente el papel que le piden en una báscula.

## Qué exige ahora la puerta

Además de lo de siempre —evaluación validada y ningún permiso pendiente—:

1. **Un permiso `issued` tiene que tener su documento.** Los pendientes no: ya
   los cuenta la comprobación anterior, y pedirle el papel a algo que ni se ha
   solicitado sería pedir el justificante de un trámite que nadie ha hecho.
2. **Un permiso no puede vencer antes de la entrega planificada.** Un permiso
   válido hasta el jueves en una carga que entrega el sábado no es un permiso:
   es un permiso vencido esperando a que lo paren.

Un permiso `not_required` no necesita nada. El estado dice que el trámite no
aplica, y exigirle papel sería contradecirlo.

Sin fecha de entrega planificada **no se dice nada** sobre el vencimiento. Es lo
único honesto: no hay contra qué comparar, y avisar «por si acaso» convierte el
aviso en ruido.

## Los motivos salen de un solo sitio

`Papers::faltan()` devuelve claves de motivo, no frases. Las traduce la pantalla,
y el error del servidor usa las mismas.

Que salgan del mismo sitio es lo que impide que la pantalla diga una cosa y la
puerta otra — el defecto que este proyecto ha encontrado ya cuatro veces.

## Las ranuras son una lista cerrada

La ruta es `POST /loads/{load}/papers/{slot}/{row}`, y `{slot}` viene del
navegador. Sin `Papers::RANURAS` —una lista cerrada de tres— ese valor decidiría
**qué tabla y qué columna se escriben**, y `status` sería tan válido como
`document_id`.

No es una comprobación de forma. Es la frontera.

La fila tiene que ser además **de esta carga y de esta empresa**: las dos cosas
se comprueban en la consulta, porque el identificador de la fila también viene
del navegador.

## La escritura del documento vive en un solo sitio

Era la tercera vez que hacía falta: cargas (`LoadFile`), recibos de gasto
(`ExpenseFile`) y ahora papeles. La regla de la casa dice que antes de copiar
una escritura por tercera vez hay que comparar las dos que existen.

Comparadas, la parte común resultó ser exactamente esto —fila en `documents`,
fila en `document_versions`, puntero a la versión vigente y anotación en la
bitácora— y vive ahora en `App\Support\Documents\Attachment`. Lo que cambia en
cada caso es **a qué se cuelga**: la carga añade una fila en `load_documents`
con su parada; el gasto y el permiso escriben una columna en su propia tabla.

`Attachment` no decide permisos, ni qué tipos de fichero se aceptan, ni quién
puede subir. Eso lo decide cada controlador, que es quien sabe de qué habla: un
recibo lo puede adjuntar quien presenta el gasto, y el papel de un permiso no.

## Un papel, y el anterior se guarda

Sustituir un papel borra el anterior **en suave**. Alguien pudo mirarlo antes de
tomar una decisión, y ese documento tiene que poder seguir viéndose.

Quitar un papel **no desaprueba** nada. La aprobación se dio con el papel
delante; lo que cambia es que ahora falta, y la pantalla lo dice en ámbar sobre
los permisos emitidos.

## Lo que sigue faltando

- **`escorts.escort_type` no tiene restricción en la base.** El controlador
  valida contra una lista cerrada, pero cualquier otra vía de escritura puede
  meter un tipo inventado — y entonces la pantalla enseña la clave en crudo.
  Se descubrió sembrando datos de prueba a mano durante este lote. Es la misma
  asimetría que el lote 65 encontró con el índice del contacto principal: lista
  cerrada en el código, abierta en el esquema.
- **Nadie avisa de un permiso que va a vencer.** La puerta lo mira al aprobar;
  si la fecha de entrega se mueve después, nada lo vuelve a comprobar. El
  barrido diario sería el sitio.
- **No hay antivirus.** `malware_scan_status` queda en `pending`, igual que en
  el resto de los documentos.
- **Los `*_document_id` que quedan**: `invoices.pdf_document_id`,
  `carrier_settlements.pdf_document_id` y los dos de `factoring_assignments`.
