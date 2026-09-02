# El recibo del gasto

## El defecto

Tres piezas que existían y no se tocaban entre ellas:

| Pieza | Estado antes |
|---|---|
| `expenses.receipt_document_id` | La columna existía. **No la escribía nadie.** |
| `expense_categories.requires_receipt` | Sembrada con valores de verdad, consultada en la pantalla de alta, y **tirada en el `map()`** justo antes de mandarla al navegador |
| «El revisor no puede aprobar un gasto al que le falte un recibo obligatorio» | En el diccionario portado desde el primer día. **Sin nada detrás.** |

No había forma de adjuntar un recibo a un gasto en toda la aplicación, y no
había ninguna puerta al aprobar.

Lo que lo separa de un ajuste inerte es qué guarda. Un gasto aprobado se rebota
al cliente en la factura o se descuenta de la liquidación del transportista, así
que aprobar sin papel es firmar un agujero que aparece meses después, cuando
alguien lo discute.

## La regla que se aplicó es la que estaba puesta entonces

`expenses.requires_receipt_snapshot` es una copia congelada, igual que
`treatment_snapshot` y por la misma razón.

Si mañana alguien marca «peajes» como categoría que exige recibo, sin esa copia
todos los peajes aprobados el año pasado pasarían a estar aprobados sin el papel
que ahora hace falta, y un informe de cumplimiento diría que se aprobó mal algo
que se aprobó bien.

La categoría dice **cómo se hacen los gastos de hoy**. El gasto guarda **cómo se
hacían el día que se presentó**.

## La puerta cierra al aprobar, y solo al aprobar

| Decisión | ¿Pasa por la puerta? | Por qué |
|---|---|---|
| Aprobar | **Sí** | Es la firma que convierte el gasto en dinero de alguien |
| Rechazar | No | Es exactamente lo que hay que hacer con un gasto sin recibo |
| Reembolsar | No | La decisión con papel ya se tomó al aprobar |

Una puerta que también cerrara el rechazo dejaría el gasto atascado para
siempre: no se podría aprobar por falta de recibo ni rechazar por lo mismo.

## Un documento como los demás

El recibo se escribe como una fila en `documents` con `owner_type = 'expense'`,
exactamente igual que `LoadFile` hace con las cargas.

Así hereda todo lo que ya está resuelto —el almacenamiento, la retención, el
barrido de huérfanos, el enlace firmado de vida corta para verlo— sin una línea
nueva en ninguno de los cuatro. `documents.owner_type` es un `varchar(20)` sin
restricción, así que `'expense'` cabe sin migración; lo que lo hace correcto no
es que quepa, sino que el resto de la maquinaria trata a `documents` por su dueño
y no por una lista cerrada.

`is_required` se deja en falso a propósito: esa columna alimenta la puerta de
cumplimiento del **transportista** —«¿qué papeles le faltan para poder llevar
carga?»— y un recibo no es eso. Lo exige la categoría de este gasto, no el
expediente de nadie.

## Un gasto, un recibo

Adjuntar uno nuevo sustituye al anterior, que se borra **en suave**: alguien
pudo haberlo mirado antes de decidir, y ese documento tiene que poder seguir
viéndose.

Quitar el recibo **no desaprueba** nada. Reescribir una decisión que alguien tomó
con el papel delante sería peor que dejar constancia de que el papel ya no está;
la pantalla lo enseña y la bitácora guarda quién lo quitó.

## Quién puede qué

- **Adjuntar**: quien aprueba, y quien puede presentar gastos. Los dos casos son
  reales — el conductor que se acuerda de la foto al día siguiente, y quien
  revisa y la recibe por WhatsApp.
- **Quitar**: solo quien aprueba.
- **Ver**: quien puede leer el gasto.

El estrechamiento por ámbito de la consulta es lo que impide colgar un recibo en
el gasto de una carga que no se lleva, o de otra empresa. No lo impide el
formulario: el formulario no es quien decide.

## Se avisa antes, no después

Que una categoría exige recibo se dice **al elegirla**, en el alta. Quien presenta
el gasto tiene el tique delante en ese momento y ya no lo tendrá cuando el
revisor se lo devuelva tres días después.

Y en la lista, un gasto al que le falta el papel lo dice **encima de los
botones**, no en el error de validación: quien va a aprobar tiene que verlo antes
de pulsar.

Un gasto que ni tiene recibo ni lo necesita no dice nada. Un aviso que sale
siempre deja de leerse, y entonces tampoco se lee el que importa.

## Lo que sigue faltando

- **No hay antivirus.** `malware_scan_status` queda en `pending`, igual que en
  los documentos de la carga. Es honesto —no se dice que esté limpio— pero
  alguien tendrá que escanearlos.
- **No hay OCR.** `equipment_verifications.ocr_provider` existe y sigue vacía.
  Leer el importe del tique y compararlo con el del gasto cazaría el dedo
  resbalado, que es el error más común aquí.
- **Los demás `*_document_id` siguen huérfanos**: `invoices.pdf_document_id`,
  `carrier_settlements.pdf_document_id`, `permits.route_survey_document_id` y
  los dos de `factoring_assignments`. Mismo patrón, otras pantallas.
