# El bloqueo legal que protegía una fila

## El defecto, escrito en el mismo fichero

`App\Support\Retention\Holds` describe su alcance `record` en su propia
cabecera:

> `record` — una carga concreta **y lo que cuelga de ella**.

Y un párrafo antes, por si quedaba duda:

> Llega una reclamación por una carga —una detención discutida, un daño, un
> accidente— y a partir de ese momento todo lo relacionado tiene que dejar de
> envejecer: **los papeles, la conversación con el transportista, las horas del
> viaje, la factura**. Sin esto, la política de retención hace su trabajo
> puntualmente y borra la prueba.

`stamp()` marcaba una fila:

```php
if ($scopeType === 'record' && $entityId !== null) {
    $q->where('id', $entityId);
}
```

Los papeles, la conversación, las horas y la factura seguían con
`legal_hold = 0`. El barrido pregunta a esa columna fila por fila, así que los
purgaba en su fecha. **El bloqueo protegía la carga y dejaba borrar la prueba.**

## La otra mitad de la escalera sí estaba

`Storage\CascadedFiles::heldParentIds()` resuelve la dirección contraria —un
hijo bloqueado impide borrar a su padre, porque MySQL se lo llevaría en
cascada— y su cabecera dice la misma frase: «el bloqueo protegía la fila y no
protegía nada». Media escalera construida hacia arriba y ningún peldaño hacia
abajo.

## Por qué hay que declararlo

Casi nada de lo que cuelga de una carga cuelga por una clave foránea en
cascada, así que `information_schema` no lo sabe:

| Enganche | Ejemplo | Forma |
|---|---|---|
| el hijo guarda el id del padre | `conversations.load_id` | `por` |
| el padre guarda el id del hijo | `invoices.pdf_document_id` | `desde` |
| polimórfico | `documents.owner_type` + `owner_id` | derivado |
| polimórfico, no de papeles | `notifications.subject_type` + `subject_id` | `cuando` |

`Retention\HeldTogether::CUELGA` declara las dos primeras y la cuarta. **Los
papeles no se declaran**: `Documents\DocumentOwners` ya dice qué tipo de dueño
vive en qué tabla, y repetirlo sería la segunda lista que contesta la misma
pregunta — la forma exacta del defecto que este lote arregla. Se derivan con
`DocumentOwners::tiposDeTabla()`.

El guardián que importa es el de la **tabla veintidós**: toda tabla de
`Policy::ENTITIES` con una columna `load_id` tiene que estar colgando de la
carga, o la suite se pone roja. Una tabla nueva que no esté ahí se purgaría con
un pleito abierto, en silencio.

El recorrido se para en las tablas de la política: `legal_hold` existe en
treinta tablas y el barrido toca veintiuna. Marcar fuera no protege de nada y
deja escrita una columna que nadie lee — que es de donde venía el defecto
anterior de este módulo.

## Lo que encontró el recorrido por el navegador

Aplicar el bloqueo desde la pantalla funcionó. **Levantarlo reventó:**

```
SQLSTATE[45000]: 1644 signature_audit_events is append-only: rows cannot be updated
```

`signature_audit_events` lleva un disparador `before update` **sin condición**.
`Holds::rebuild()` limpia las veintiuna tablas de la política antes de volver a
marcar, y `Sweeper::archive()` hace un `update` por tabla. Mientras esa tabla
estuvo vacía no se notó: un `update` que no toca ninguna fila no dispara el
disparador.

Dos consecuencias, las dos graves y ninguna rara:

1. **Levantar cualquier bloqueo legal** revienta en cuanto la empresa tiene una
   sola fila de auditoría de firma.
2. **El barrido nocturno** revienta en cuanto hay una fila más vieja que la
   ventana activa — o sea, a los dos años de funcionamiento — y revienta a
   mitad, arrastrando lo que llevara hecho.

`Policy::NEVER_PURGE` existe precisamente porque «el esquema se contradice a sí
mismo»: unas columnas dicen «puedes purgar esto» y un disparador dice «no
puedes borrar esto jamás». La misma contradicción existía para el `update` y
nadie la había escrito. Ahora es `Policy::NEVER_UPDATE`, comprobada contra el
DDL de los disparadores por el mismo guardián que ya comprobaba el borrado.

Distinguir es lo que tiene miga: `signature_records`, `financial_snapshots` y
`stripe_events` también llevan `before update`, pero el suyo va dentro de un
`if` que mira columnas y deja pasar las de retención **a propósito** — el DDL lo
dice con todas las letras: «so the archival job can do its work without needing
to bypass the guard».

### El invariante que hace honesto saltárselas

`NEVER_UPDATE ⊆ NEVER_PURGE`, comprobado. Una tabla que no se puede **marcar**
tiene que ser una tabla que no se puede **borrar**, o el bloqueo legal sobre
ella sería una promesa vacía. Archivarla era marcarla para una purga que nunca
llega.

## La pantalla

«Un registro concreto» describía exactamente lo que el código hacía y
exactamente lo contrario de lo que prometía. Ahora la etiqueta dice «un registro
y lo que cuelga de él», y debajo del selector va la enumeración: quien aplica un
bloqueo por una reclamación tiene que poder saber si la factura entra sin leer
el código.

## Lo que esto NO dice

Que el bloqueo sea legalmente suficiente. Alcanza lo que el registro declara,
que es lo que se ha decidido que cuelga de una carga en este esquema. Si eso
cubre lo que pide una citación concreta lo decide un abogado, no este código.

## Guardianes

- `tests/Unit/Suite/HeldScopeTest.php` — doce comprobaciones sobre el registro,
  el recorrido y la pantalla.
- `tests/Unit/Suite/PurgeableTablesTest.php` — la mitad nueva: los disparadores
  que prohíben escribir, y el invariante.
- `tests/Feature/Retention/HeldTogetherTest.php` — el alcance, lo que NO se
  marca, levantar, dos bloqueos solapados, el barrido que ya no se lleva la
  prueba, y las dos formas de reventar que ya no revientan.

Dieciocho sabotajes verificados uno a uno.
