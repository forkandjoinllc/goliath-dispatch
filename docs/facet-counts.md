# Los atajos que contaban otra cosa

## El defecto

Cinco pantallas —cargas, documentos, transportistas, conductores y equipo—
llevan una fila de atajos con su recuento al lado: «Pagadas (3)», «Pendientes
(8)». Ese recuento se calculaba con el ámbito del actor y **sin ninguno de los
demás filtros activos**. Pulsar el atajo, en cambio, los conserva todos.

Medido sobre los datos de demostración, en la pantalla de cargas con un cliente
elegido:

| chip | dice | al pulsarlo salen |
|---|---|---|
| Todas | 11 | **3** |
| Facturadas | 3 | **1** |
| Pagadas | 3 | **0** |
| En tránsito | 1 | 1 |

«Pagadas (3)» llevaba a **cero filas**. Y «Todas (11)» estaba escrito encima de
una lista de tres.

En documentos, con el dueño filtrado a transportista: «Todos (32)» sobre una
lista de 14.

No es un caso raro. Pasa en cuanto hay dos filtros a la vez, que es el uso
normal de esas pantallas: se busca algo y luego se acota por estado.

Es la misma promesa que el lote anterior arregló en el panel —**el número que se
pulsa tiene que ser el número que sale**— un nivel más abajo.

## Cinco copias del mismo error no son mala suerte

Las cinco pantallas escribían su propio `facets()`, y las cinco lo escribían
igual de mal:

```php
$counts = $this->scoped($checker, $actor, $scope)   // el ámbito, pelado
    ->select('status', DB::raw('count(*) as total'))
    ->groupBy('status')
    ->pluck('total', 'status')
    ->all();
```

Cuando cinco sitios cometen el mismo error, el error no está en los cinco: está
en que la regla no vive en ninguno. Por eso el arreglo no es corregir cinco
métodos, sino que no haya cinco.

## La regla, en una frase

> El recuento de un atajo se cuenta con **todos** los filtros activos menos los
> que esa misma fila de atajos controla, más los que ese atajo concreto pone.

Las dos mitades importan:

- Sin la primera, el número ignora la búsqueda que el usuario acaba de
  escribir — el defecto de partida.
- Sin la segunda, «Pagadas» se contaría con el «Pendientes» que estaba puesto y
  daría cero siempre.

## `FacetCounts::fila()`

Recibe el mapa de filtros **entero** y la lista de qué claves controla la fila.
Vaciarlas es lo primero que hace:

```php
foreach ($controla as $clave) {
    $base[$clave] = '';
}
```

Ese vaciado vive dentro del ayudante **a propósito**. Es la mitad que se olvida:
un ayudante al que se le pasa la consulta «ya preparada» deja el vaciado en
manos de cinco pantallas, y basta con que una lo haga distinto para que vuelva
el defecto sin que nada se ponga rojo. Hay una guarda que fija que el vaciado
ocurre y que ocurre **antes** de contar.

### Una fila puede controlar dos claves

En documentos, conductores y equipo los atajos son excluyentes entre sí: pulsar
un estado apaga «vence pronto», y pulsar «vence pronto» apaga el estado. La fila
controla `status` **y** `expiring`, y así se declara:

```php
['status', 'expiring'],
```

Declarar solo `status` haría que «Vence pronto», estando en «Aprobados», contara
la intersección de los dos — que no es lo que sale al pulsarlo. Tiene sabotaje
en las tres pantallas.

### «Todas» suma los grupos, no los atajos

```php
$salida = ['all' => (int) array_sum($agrupado)];
```

Un estado que no tenga atajo propio sigue estando en la lista, y «Todas» tiene
que contarlo. Sumar los valores enseñados dejaría el número por debajo de lo que
la lista devuelve — el mismo defecto, más pequeño.

### Y no cuesta más consultas que antes

Los atajos que solo cambian el valor de una columna salen de **una** consulta
agrupada. Los que encienden otro filtro necesitan la suya, que es exactamente lo
que ya hacían. El coste por pantalla no se mueve: cargas 1, las otras 2.

## Verificación

- **15 sabotajes, 15 cazados.** Los cinco primeros reponen el defecto original
  en cada una de las cinco pantallas, y los cinco tumban la prueba de
  funcionalidad — no solo la estructural.
- Suite completa en verde dos veces: **1834** pruebas, 10.935 aserciones.
- `tsc` limpio; `pint` limpio sobre lo del lote (`EquipmentController` y
  `CarrierController` conservan su deuda anterior, medida contra
  `git show HEAD:` — el mismo juego de reglas falla en las dos versiones).
- Recorrido por el navegador, con un segundo filtro puesto en cada pantalla:
  **21 atajos comprobados, 21 coinciden**. Antes, en cargas con un cliente
  elegido, tres de cuatro no coincidían.

## Tres sabotajes escaparon a la primera, y por qué

Los de conductores, equipo y transportistas. Sus pruebas buscaban por un valor
sacado de la única fila del escenario, así que **el filtro no dejaba fuera a
nadie**: contar con él y sin él daba lo mismo, y la prueba pasaba con el defecto
puesto.

Es la misma lección del lote anterior, cometida otra vez en el lote siguiente:
**medir con datos que no distinguen es no medir**. Se arregló plantando filas
que la búsqueda NO encuentra, y entonces los tres sabotajes cayeron.

## Lo que esto NO es

- **No cambia qué filas devuelve ninguna lista.** Solo los números de los
  atajos, y solo cuando hay otro filtro puesto. Sin filtros, los recuentos son
  exactamente los de antes — hay una prueba que lo fija, para que arreglar un
  caso no rompa el otro.
- **No toca el ámbito.** El recuento sigue contando solo lo que el actor puede
  ver: un despachador que viera el número de la empresa sabría cuántas cargas
  hay aunque solo pueda abrir las suyas. Tiene sabotaje propio.
- **No unifica las cinco pantallas en un componente.** Siguen teniendo su
  `facets()`; lo que comparten es la regla de cómo contar. Unificar las
  pantallas es otra cosa, y de diseño.
- **`FacetCounts` no sabe qué filtros existen.** Recibe las claves que la fila
  controla porque solo la pantalla lo sabe. Si alguien añade un filtro nuevo a
  una fila y no lo declara, el ayudante no puede avisar — lo avisará la prueba
  de funcionalidad, que compara contra el clic de verdad.
