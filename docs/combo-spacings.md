# Los conjuntos: lo que mide un camión CON un remolque

## El hueco que no cabía en ninguna ficha

`equipment_axle_spacings` guarda las distancias entre ejes **de una unidad**, y
eso está bien: los dos huecos de un tractor son suyos lleve el remolque que
lleve, y los del remolque son del remolque lo arrastre quien lo arrastre. La
invariante que lo sostiene es `distancias = ejes - 1`.

Pero en una combinación de cinco ejes hay **cuatro** huecos, y solo tres caben
en las dos fichas. El que sobra —de la última tracción al primer eje del
remolque— no pertenece al camión ni al remolque: pertenece a la **pareja**.
Cambia el camión y cambia; cambia el remolque y cambia. Y es justamente el
hueco del que depende la fórmula federal del puente y el que pregunta toda
oficina de permisos.

Sin esta tabla, la suma de una ficha de camión se presentaba como «del primer
eje al último» —cierto de la unidad— mientras la distancia que pide un permiso
—del primer eje del tractor al último del remolque— no se podía calcular: le
faltaba el tramo del medio y no había dónde ponerlo.

Reparto de los seis huecos de una hoja de medidas real:

| Hueco | De quién es |
|---|---|
| Eje 1→2 (dirección → tracción 1) | del tractor |
| Eje 2→3 (tracción 1 → tracción 2) | del tractor |
| **Eje 3→4 (última tracción → primer eje del remolque)** | **de la pareja** |
| Eje 4→5, 5→6, 6→7 | del remolque |

## La regla: entera o nada, un nivel más arriba

`AxleSpacings::cuadran()` ya decide que unas distancias a medias no sirven para
calcular nada. `ComboSpacing::cadena()` aplica lo mismo a la combinación: la
cadena existe cuando existen **las tres piezas** —los huecos del tractor
completos, el enganche, y los del remolque completos— y no existe en cuanto
falta una.

Devolver una suma a la que le falta un tramo no sería una aproximación. Sería
un número que se parece a la distancia de un permiso sin serlo, y ese número
acabaría copiado en un papel que alguien firma.

Por eso `cadena()` necesita saber **cuántos ejes tiene cada unidad** y no le
basta con contar lo que hay guardado: un remolque de un solo eje tiene cero
huecos legítimamente, y una lista vacía sin el recuento al lado no distingue
«no tiene» de «nadie lo ha medido». Contar filas mide algo adyacente a la
pregunta.

## Lo que se guarda además

Las tres medidas que toda hoja de permisos lleva escritas al margen:

- **Parachoques a parachoques.**
- **Del kingpin al final del remolque.**
- **Del kingpin a los ejes del remolque.**

Son opcionales —no todas las oficinas las piden y no todo el mundo las ha
tomado—; el hueco del enganche no lo es, porque es la razón de que la fila
exista. Guardar las tres del margen sin él dejaría tres datos de permiso
colgando de nada.

Cada una se nombra por sus **dos** extremos. «Kingpin» a secas es media medida:
de la misma palabra salen el tiro desde el eje de dirección, la distancia al
grupo de ejes y la del final de la cama, y son tres cifras distintas que caben
en la misma casilla.

## Que el conjunto quepa dentro de sí mismo

Cada medida por separado es plausible; el par no siempre lo es. El parachoques
delantero y el trasero **no pueden** estar más cerca que el primer eje y el
último, porque los dos voladizos van por fuera de los ejes. Y los ejes del
remolque no pueden quedar por detrás de su final.

Lo destapó el propio sembrado de demostración: se tomaron las cifras de una
hoja real y se pegaron a otro conjunto —68′5″ de parachoques a parachoques en
una combinación cuya cadena mide 69′5″— y la pantalla lo enseñó sin quejarse.
Un permiso pedido con ese par se cae en la ventanilla.

La comprobación solo se hace **cuando se puede**: si a alguna de las dos fichas
le faltan sus huecos no hay cadena contra la que comparar, y negarse por no
poder comprobar dejaría sin guardar la única medida que alguien tiene.

## De dónde salen las parejas

De dos sitios, y se juntan:

1. Las que ya tienen medida tomada.
2. Las que alguien **conduce de verdad** — `driver_equipment_assignments`, la
   asignación habitual.

Las segundas salen aunque nadie las haya medido, marcadas como pendientes. Una
lista que solo enseñara lo medido no diría nunca lo que falta, y lo que falta
es justo lo que se descubre en la báscula.

Las parejas se buscan **por pares** y no con dos `whereIn` sueltos: con los
camiones por un lado y los remolques por otro saldrían también las parejas que
nadie ha formado —el camión de una con el remolque de otra— y la pantalla
enseñaría la medida de un conjunto que no existe, cuadrando.

## Una fila por pareja, no por carga

Un tractor y un remolque concretos miden lo que miden. Un RGN extensible cambia
de longitud de una carga a otra, y ese caso se anota en `notes` y se ajusta en
el permiso: la ficha guarda la medida **nominal** de la pareja, que es la que
se toma una vez con la cinta y sirve para las demás.

## Quién escribe

Solo `App\Support\Equipment\ComboSpacing`, y lo vigila un guardián. La unicidad
de la pareja vive en una columna generada que **solo cuenta las filas vivas**
(`live_pair_key`, igual que `vendor_carriers`), así que una medida retirada y
vuelta a tomar puede existir junto a la vieja. Un `insert` suelto en otro
controlador la duplicaría.

Retirar una medida es marcarla, no quitarla: por qué un permiso se pidió con
una cifra y no con otra es parte de lo que hay que poder explicar después.

## Dónde se mira

Pestaña **Conjuntos**, junto a Camiones y Remolques. Los tres son el mismo
dominio y se miran juntos; la ficha de cada unidad enlaza aquí, y su propia
suma dice ahora que es **de esa unidad sola**.

La pantalla no usa `EmptyState`: un conjunto no se da de alta en una lista
—nace de una asignación o de una medida—, así que la rama de «agregue el
primero» no diría la verdad. Lo que sí conserva es la lección que hizo nacer
aquel componente: quien tiene el alcance acotado lee que la lista está
**acotada**, y no que su empresa no tenga ninguno.

---

Ver también: [equipment.md](equipment.md) · [testing.md](testing.md)
