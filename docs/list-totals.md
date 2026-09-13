# Las sumas de dinero que no eran de su lista

## El defecto

Cuatro pantallas de dinero —cobros, gastos, facturas y liquidaciones— enseñan
una fila de totales encima de la lista. Esas sumas no eran de la lista que
tenían debajo.

Medido sobre los datos de demostración:

| pantalla | filas | lo que ponía encima |
|---|---|---|
| `/payments?status=disputed` | **0** | «En casa **1.721,74 $**» |
| `/expenses?status=submitted` | **0** | «Ya cuenta en el cálculo **7.909,00 $**» |
| `/settlements?search=zzz` | **0** | «Neto a transportistas **14.874,00 $**» |
| `/invoices?search=INV-01001` | 1 | «Total **2.277,36 $**» (el de las tres) |

Tres pantallas enseñaban una cifra de dinero encima de una lista **vacía**.

Es la misma familia que los dos lotes anteriores —el número que se pulsa tiene
que ser el número que sale— pero en dinero, y eso lo empeora: **un recuento
desconcierta, una suma se apunta**. Alguien cuadra un mes con esa cifra.

## Por qué no era «a alguien se le olvidó»

Los filtros vivían **en línea** dentro de `index()`:

```php
$query = $this->scoped($checker, $actor, $scope);

if ($filters['status'] !== '') {
    $query->where('expenses.status', $filters['status']);
}
// … y así
```

La fila de totales se construye desde `scoped()` por su cuenta, y **no tenía
forma de reutilizar eso**. No es que a nadie se le ocurriera aplicarlos: es que
no había nada que aplicar.

Las dos pantallas que lo intentaron lo demuestran. Facturas y liquidaciones
pasaban `$filters` a `totals()`, y allí dentro había una **copia** de uno solo
de ellos:

```php
private function totals(Builder $query, array $filters): array
{
    if ($filters['status'] !== '') {
        $query->where('invoices.status', $filters['status']);
    }
    …
```

Media suma filtrada es peor que ninguna: la parte que sí responde al filtro hace
creer que la otra también.

## El comentario que afirmaba lo contrario de lo que hacía

Encima de esa llamada, en facturas:

> Los totales se calculan sobre **TODO el filtro**, no sobre la página. Una suma
> que cambia al pasar de página no es una suma.

Cierto para uno de sus tres filtros. La segunda frase es buena y sigue ahí; la
primera ahora también es verdad, y debajo queda escrito que no lo era.

## Lo que hace ahora

Los filtros de cada pantalla viven en su `applyFilters()`, y la suma pasa por el
mismo:

```php
'totals' => $this->totals(
    tap($this->scoped($checker, $actor, $scope), fn (Builder $q) => $this->applyFilters($q, $filters)),
),
```

Y `totals()` **deja de recibir `$filters`**. Es la parte que impide que vuelva:
mientras los reciba puede aplicar solo algunos, que es exactamente lo que
pasaba. Hay una guarda que falla si alguno vuelve a aceptarlos.

## Verificación

- **14 sabotajes, 14 cazados.** Los cuatro primeros reponen el defecto original
  en cada pantalla, y los cuatro tumban la prueba de funcionalidad.
- Suite completa en verde dos veces: **1847** pruebas, 11.025 aserciones.
- `tsc` limpio; `pint` limpio sobre lo del lote (`ExpenseController` conserva su
  deuda anterior, medida contra `git show HEAD:` — el mismo juego de reglas
  falla en las dos versiones, y este lote no le añadió ninguna importación).
- Recorrido por el navegador en los dos idiomas, sobre las mismas cuatro
  consultas que destaparon el defecto: las tres listas vacías llevan ahora un
  cero encima, y la búsqueda de una factura concreta enseña **399,36 $** en vez
  de la suma de las tres.

### Cómo miden las pruebas

Suman las filas que la pantalla **devuelve** y las comparan con el total que
pone encima. No repiten la consulta: una prueba que vuelve a consultar puede
equivocarse igual que el controlador, y entonces las dos coinciden y no se mide
nada.

Eso solo vale mientras las filas quepan en una página, así que el ayudante lo
comprueba y falla con un mensaje que lo dice — si algún día una prueba pasa de
la paginación, dejaría de medir el filtro sin avisar.

## Lo que esto NO es

- **No cambia ninguna lista.** Solo las sumas, y solo cuando hay un filtro
  puesto. Sin filtros, los totales son exactamente los de antes.
- **No toca el ámbito.** La suma sigue contando solo lo que el actor ve. Tiene
  sabotaje propio, y hubo que ampliarlo: la primera versión de la prueba de
  ámbito solo miraba facturas, y el sabotaje que quitaba `scoped()` en cobros se
  escapó.
- **No unifica las cuatro `totals()`.** Cada una suma cosas distintas —dinero en
  casa, gasto que ya cuenta, neto a transportistas— y unificarlas sería
  inventarse un total común que ninguna pantalla pide. Lo que comparten es de
  dónde sale la consulta.
- **Las cuatro siguen filtrando en línea… no.** Eso cambió: ahora cada una tiene
  su `applyFilters()`. Pero **no hay un `applyFilters` común**: los filtros de
  gastos no se parecen a los de facturas, y un método compartido con cuatro
  `if` por pantalla sería peor que cuatro métodos claros.
