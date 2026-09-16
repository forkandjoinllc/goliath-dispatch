# Los estados que un desplegable ofrecía y el sistema no puede producir

## El defecto

La pantalla de comisiones ofrece cuatro estados:

> Debido · **Aprobado** · Pagado · **Anulado**

Y la aplicación escribe dos. No hay paso de aprobación de comisiones:
`CommissionLedger::accrue()` devenga en `accrued` y `markPaid()` pasa
directamente a `paid`. Y **no hay forma de anular una comisión**: una devengada
por error solo se puede pagar o dejarla ahí para siempre.

La de mensajes ofrece «Directo» y «Aviso general». `Messaging\Threads` es el
único sitio de toda la aplicación que crea conversaciones —no hay otro `insert`
sobre `conversations`— y solo crea `kind = load`.

Elegir cualquiera de esos cuatro devolvía siempre cero filas, con el texto
«Ningún hilo cuadra con lo que buscas» o un total de cero bajo el nombre del
estado. **Culpa al filtro de algo que es imposible.** Quien lo lee concluye que
hoy no hay nada en ese estado, no que ese estado no existe — y sobre comisiones
eso es peor que una molestia: «Aprobado: 0» se lee como «no queda nada por
pagar aprobado».

## Lo que apareció al buscar la misma forma

| Pantalla | Ofrecía | Puede pasar |
|---|---|---|
| comisiones | 4 | 2 — faltan `approved`, `voided` |
| mensajes | 3 | 1 — faltan `direct`, `broadcast` |
| facturas | 8 | 6 — faltan `due`, `uncollectable` |
| cobros | 8 | 6 — faltan `processing`, `cancelled` |
| gastos | 4 | **4** |
| liquidaciones | 4 | **4** |
| firmas | 7 | **7** |
| avisos | 5 | **5** |

Ocho opciones imposibles de treinta y nueve, repartidas por cuatro pantallas.
Las cuatro listas que están enteras se declaran igual: **una lista donde todo es
alcanzable es lo que demuestra que este registro mide algo** y no es solo un
inventario de averías.

## Producir no es siempre escribir una columna

Al declarar los productores aparecieron tres formas distintas, y las tres son
legítimas:

- **Una línea de código.** `SettlementBuilder` escribe `'status' => 'draft'`.
- **El valor por omisión de la columna.** Un aviso comercial nace `new` porque
  el esquema lo dice; los tres formularios públicos no escriben el estado.
- **Derivado al leer.** `Signatures\State` calcula `expired` de la fecha, porque
  nada corre a medianoche a ponerlo en las filas. La pantalla lo enseña, así que
  es alcanzable aunque ninguna fila lo tenga escrito.

Y una cuarta con trampa: **lo elige una persona en un formulario que valida
contra este mismo registro**. Es circular, y por eso se marca con su propio
prefijo en vez de disimularlo — el guardián comprueba que esa ruta valide de
verdad con `Rule::in`, que es lo único que impide que el círculo se abra por un
lado.

## El catálogo es el enum donde lo hay, y el diccionario donde no

Tres de las ocho listas tienen enum y CHECK en el esquema. Las otras cinco son
un `varchar` con un valor por omisión y **nada más**: `dispatcher_commissions.
status`, `conversations.kind` y `carrier_settlements.status` no tienen
restricción ninguna. Donde no hay enum, el único catálogo que existe es el
diccionario — que es exactamente lo que la pantalla puede llegar a escribir, y
un valor con etiqueta y sin productor es una opción que nombra un estado
imposible.

El guardián comprueba que las dos listas —lo que se produce y lo que no— sumen
**exactamente** el catálogo. Es la comprobación que caza el estado número
cuarenta.

## Las cláusulas que leen lo imposible

`markPaid()` filtraba así:

```php
->whereIn('status', ['accrued', 'approved'])
```

Una cláusula que lee un estado imposible no hace daño, pero **dice que existe** —
y la pantalla la creía. Ahora es `->where('status', 'accrued')`, con el motivo
escrito al lado.

Quedan dos parecidas, y se dejan a propósito porque son defensivas: `SIN_SALDO`
excluye `uncollectable` y la consulta de cartera también. Excluir algo que no
puede pasar no promete nada; incluirlo, sí.

## Y la validación

`pay()` validaba el estado contra los cuatro. Se podía pedir pagar las
comisiones «aprobadas» —un estado que nada escribe—, no se pagaba ninguna, y el
mensaje de éxito decía «0 comisiones marcadas como pagadas». Ahora valida contra
la misma lista que la pantalla ofrece, que es la única forma de que las dos no
puedan decir cosas distintas.

## Un desplegable de una opción tampoco dice nada

Con una sola clase de hilo, el filtro de mensajes no se pinta. Las siete listas
de estado sí: dos opciones ya son una elección.

## Lo que esto NO dice

Que esos ocho estados no debieran existir. Dice que hoy nada los produce.
Construir la aprobación de comisiones, la anulación, los hilos directos, los
avisos generales o el marcado de incobrable son decisiones de producto;
**enseñar sus filtros antes de construirlos no lo es**.

El día que alguien escriba uno de esos valores, el guardián se pone rojo y manda
a mover la entrada de `NO_SE_PRODUCEN` a `PRODUCEN` — que es lo mismo que
devolver la opción al desplegable.

## Guardianes

- `tests/Unit/Suite/ReachableOptionsTest.php` — diez comprobaciones: que cada
  productor produzca, que cada imposible siga siéndolo, que las dos listas
  cubran el catálogo, que ninguna pantalla se guarde su propia lista.
- `tests/Feature/Lists/ReachableOptionsTest.php` — ocho, con las pantallas.

Trece sabotajes verificados uno a uno.
