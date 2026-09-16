# Las listas que se desfiltraban solas

## El defecto

Se pulsa «Facturas vencidas: 7» en el panel. La lista sale con siete filas y dos
sumas de dinero calculadas sobre ese filtro. Se teclea una letra en la búsqueda
y, sin nada que lo explique, la lista pasa a **todas** las facturas y los totales
saltan.

La causa cabe en una línea:

```tsx
router.get('/invoices', { search, status: e.target.value }, …)
```

`overdue` no está ahí. Cada control reconstruía la consulta con la lista de
filtros que su autor tenía delante, y el que llega por la dirección no lo tenía
delante nadie. El **paginador** de esa misma pantalla sí lo conservaba
—`params={{ ...filters }}`— así que la pantalla se contradecía consigo misma
según por dónde se tocara.

Tres pantallas, la misma forma:

| Pantalla | Qué perdía | Qué había encima |
|---|---|---|
| Facturas | `overdue`, al buscar o al cambiar el estado | «Facturado» y «Pendiente de cobro» |
| Liquidaciones | `search`, al cambiar el estado | «Neto a transportistas» y «Tarifas» |
| Gastos | nada, pero `load` no se podía quitar | «Pendiente» y «Contando» |

La versión cara es la de Facturas, y es la que `docs/list-totals.md` ya señalaba
en otro contexto: **un recuento desconcierta, una suma se apunta**. Quien cuadra
el mes se lleva $22.500 como la cartera entera.

## La regla ya estaba escrita en la pantalla de al lado

El listado de cargas tiene el mismo caso —`?uninvoiced=1`, también desde el
panel— y lo resuelve, con el motivo escrito encima del chip:

> Este filtro no tiene control propio: se llega a él desde la tarjeta… Sin
> decirlo, quien aterriza aquí ve una lista corta y no sabe que está recortada —
> que es la otra forma de que un número y una lista se contradigan.

Esa pantalla además parte siempre de todos los filtros y borra los vacíos. Las
otras tres nunca lo copiaron, y copiarlo tampoco era la respuesta: cuatro copias
de la misma función es como se llega aquí.

## La pieza

`resources/js/lib/filters.ts`:

- `navegar(ruta, filtros, cambios)` — parte de **todos** los filtros y aplica el
  cambio encima. Lo que no se toca, no se pierde. Quita las claves vacías, porque
  una dirección con `?status=&search=` se comparte mal y se lee peor.
- `hayFiltros(filtros)` — decide si se ofrece el botón de quitarlos.

El guardián prohíbe la forma del defecto: un `router.get('/invoices', { …` con un
objeto literal que enumera filtros. Se permite `{}`, que es justamente el botón
de limpiar.

## Y el filtro invisible se dice

Facturas pinta «Solo vencidas» cuando llega de la tarjeta; Gastos, «Lista
filtrada» cuando arrastra un `load`. Es el mismo chip que Cargas ya tenía. Sin
él, la lista corta se lee como la lista entera.

## El tipo también mentía

`Props.filters` de Facturas declaraba `{ search, status }` y el servidor mandaba
tres. Un filtro que el tipo no nombra es un filtro que nadie recuerda al escribir
la siguiente navegación — así que el guardián exige que esté declarado y que el
servidor lo siga devolviendo.

## Los guardianes

`tests/Unit/Suite/ListFiltersTest.php` — 6 comprobaciones: que ninguna pantalla
reconstruya la consulta a mano, que el ayudante parta de todos los filtros y
limpie los vacíos, que los filtros sin control propio se digan en pantalla, que
las tres ofrezcan quitarlos, que el tipo declare lo que el servidor manda, y que
el paginador y los controles usen la misma lista.

`tests/Feature/Lists/ListFiltersTest.php` — 5 pruebas que entran por el destino
que declara `Panel::DESTINOS` —no por una ruta inventada en la prueba— y miden
las dos mitades: que el filtro vuelve en `filters` para que la pantalla pueda
conservarlo, y que los totales son los de **esas** filas ($22.500) y no los de
todas ($180.000).

**12 sabotajes, 12 rojos.**

Recorrido en los dos idiomas: se llega con `?overdue=1`, sale el chip, se teclea
en la búsqueda y la dirección queda en `?overdue=1&search=INV`.
