# La ficha de la unidad: propiedad, medidas y ejes

Cuatro cosas pedidas juntas porque son la misma ficha, la del tractor o el
remolque:

1. El tipo de equipo de un tractor tiene que ser de tractor.
2. Se debe poder decir si es **propia**, **arrendada** o en **arrendamiento con
   opción a compra**.
3. Todas las medidas se dan en **pies y pulgadas por separado**.
4. Se guardan el **número de ejes** y la **distancia entre cada par**.

## 1. Un tipo de equipo se ofrece diciendo de qué clase es

`equipment_types` tiene una columna `category` —`truck` o `trailer`— desde el
primer día, y no la miraba nadie. El alta de un tractor ofrecía «Lowboy» y
«Plataforma escalonada», que son remolques. Elegirlo no daba ningún error:
guardaba una ficha que después no cuadra con nada, y la evaluación de
sobredimensión mira el tipo del REMOLQUE, así que un tractor con tipo de
remolque entra en un cálculo al que no pertenece.

Filtrar era una línea. Lo que costó fue encontrar **el otro sitio**: el alta de
una carga ofrecía los nueve tipos como «equipo requerido», incluidos los dos de
tractor. Toda carga necesita un tractor, así que pedir uno como requisito no
dice nada y además guarda un requisito que ningún remolque puede cumplir.

Los dos sitios están en un registro —`tests/Unit/Suite/EquipmentCategoryTest.php`—
con la categoría que ofrece cada uno, comprobado en las dos direcciones: una
consulta nueva sin declarar falla, y una declarada que ya no existe también. El
día que aparezca una tercera pantalla que ofrezca tipos, el guardián le pregunta
cuál.

Y `choices()` dejó de aceptar la clase como argumento opcional. Mientras lo fue,
olvidarse de pasarla devolvía los nueve tipos sin que nada fallara. La lista de
transportistas —que la validación necesita sin saber de qué clase es la unidad—
se fue a su propio método.

## 2. De quién es la unidad

Tres valores en `EquipmentOwnership`, y los tres se escriben desde el
formulario: no hay aquí ningún estado que el producto no sepa producir. La
columna lleva un `CHECK` en las dos tablas.

Lo que no es obvio: **pasar una unidad a propia borra el arrendador y la fecha
de vencimiento**. Si no, la ficha diría «Propia» con un arrendador debajo, y
quien lo lea después no sabrá cuál de los dos vale. El formulario lo dice antes
de guardar, en el sitio donde estaban los dos campos que desaparecen.

Un detalle que costó un defecto: la propiedad se leía tres veces en `columns()`
con tres valores por omisión distintos, así que una petición sin el campo
guardaba «propia» **con el arrendador puesto**. Ahora se lee una vez.

## 3. Pies y pulgadas por fuera, pulgadas por dentro

La pantalla pide las medidas como se leen de una cinta y como vienen en un
permiso —13 pies 6—, y la base guarda **una sola cifra en pulgadas**.

No son dos columnas por dos razones:

- Dos columnas admiten el estado imposible: 13 pies y **14** pulgadas.
- Todo lo que ya compara medidas —`Oversize\Evaluator` contra `oversize_rules`—
  trabaja en pulgadas desde el primer día. Una segunda unidad en la base
  obligaría a convertir en cada comparación, y el día que alguien olvide una
  conversión el resultado no es un error de pantalla: es un permiso mal
  evaluado.

La suma vive en `App\Support\Equipment\Measure` y el camino de vuelta —partir
una cifra para enseñarla y para rellenar las casillas— en
`resources/js/lib/measure.ts`. Están escritas dos veces porque el navegador no
puede leer una constante de PHP; `MeasureUnitsTest` comprueba que **las dos
digan doce** y que el tope de la casilla de pulgadas salga de esa constante y no
esté escrito a mano.

Las casillas guardan lo que se escribió en ellas, sin sumar: si la pantalla
sumara, dejar las pulgadas en blanco después de escribir los pies las rellenaría
sola con un cero y la casilla se movería sin que nadie la tocara.

**Un tractor no tenía ni una medida.** `trailers` llevaba largo, ancho, altura
de plataforma, largo del pozo y capacidad; `trucks` no llevaba ninguna. Ahora
lleva largo, ancho y alto.

## 4. Los ejes y lo que hay entre ellos

El número de ejes ya estaba (en remolques). Lo que decide cuánto peso admite
legalmente un conjunto no es cuántos ejes tiene sino **cómo están repartidos**:
dos ejes a 40 pulgadas y dos a 120 admiten pesos distintos, y la fórmula federal
del puente se calcula sobre esas distancias.

Por eso van en su propia tabla, `equipment_axle_spacings`, una fila por HUECO y
ordenadas de delante atrás. La invariante que lo sostiene todo:

    distancias = ejes - 1

Y se guardan **enteras o nada**. Tres huecos de cuatro no sirven para calcular
nada y parecen un dato. «Nada» tiene que seguir valiendo, además, porque las
fichas que ya existen tienen número de ejes y no tienen distancias —la tabla
acaba de nacer—: exigirlas dejaría esas fichas sin poder guardarse.

Bajar el número de ejes **borra** las distancias sobrantes, en la pantalla y al
guardar. Un hueco número cuatro de una unidad que ya solo tiene tres ejes no es
un dato que se pueda conservar por si acaso: es basura que después se enseña.

Y un hueco de cero pulgadas no existe. Se escribe cuando alguien pone un cero en
las dos casillas creyendo que así lo deja en blanco.

## Lo que ve la demostración

Las seis unidades de cada clase salen repartidas entre las tres propiedades, con
arrendadores inventados y su fecha de vencimiento, con las medidas de un tractor
de verdad y con sus distancias entre ejes —un hueco largo del direccional al
primero de tracción y uno corto entre los dos de tracción—. Si todo fuera
propio, el arrendador y el vencimiento no se verían en ninguna ficha y la
primera vez que alguien los mirara sería en producción.

Tres invariantes nuevas en `DemoInvariantsTest` lo sujetan: que las distancias
cuadren con el número de ejes, que un camión lleve un tipo de camión, y que las
tres propiedades estén representadas.

## Lo que hay que hacer en el servidor

`php artisan migrate`. La migración añade las columnas, el `CHECK` de propiedad
y la tabla de distancias; es reversible y no toca ninguna fila existente más que
para ponerles `ownership = 'owned'`, que es lo que todas eran.
