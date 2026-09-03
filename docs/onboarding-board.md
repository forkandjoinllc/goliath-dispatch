# El tablero de incorporación

`/onboarding` es un tablero canban: una columna por estado del alta y una
tarjeta por transportista. Arrastrar una tarjeta a otra columna **ejecuta la
transición de verdad**.

## A dónde puede ir una tarjeta lo dice el servidor

Cada tarjeta llega con sus `moves`, que el controlador calcula con
`Transitions::graph()` y con el permiso ya resuelto. La pantalla **no lleva
ninguna copia** de las siete aristas del flujo.

Esto no es puritanismo. La ficha del transportista ya lleva un espejo del grafo
en TypeScript —lo dice su propio comentario— para no pintar un botón que va a
fallar. Una segunda copia en el tablero habría sido la tercera, y el día que
alguien añadiera una arista en PHP el tablero seguiría ofreciendo las de antes.

En un tablero eso se nota más que en un botón, porque **arrastrar invita**: la
columna se ilumina, el usuario suelta, y el servidor dice que no. Una columna
que no está en `moves` ni siquiera acepta la tarjeta, y lo dice mientras se
arrastra («No se puede desde aquí»).

El espejo de la ficha queda atado al grafo por
`tests/Unit/Suite/OnboardingBoardTest.php`, que lo parsea y lo compara.

## El servidor sigue mandando

Soltar hace un `POST` a `carriers/{carrier}/onboarding/{action}` — el mismo
endpoint de siempre, con sus tres puertas: existe la transición, el actor tiene
el permiso sobre ESTE transportista, y trae el motivo si hace falta. Si otra
persona movió el alta desde otra pestaña, la suelta se rechaza con un 422 y el
mensaje sale arriba del tablero.

Los tres pasos que perjudican al transportista —correcciones, rechazo,
suspensión— abren el diálogo del motivo antes de confirmar, y el botón está
deshabilitado mientras esté vacío.

## Arrastrar no puede ser la única forma

Cada tarjeta lleva un botón **Mover** con los mismos destinos, sacados de la
misma lista. Un tablero que solo funcione con el ratón deja fuera a quien
navegue con el teclado, y aquí no hay excusa: los destinos ya están calculados.

## El filtro NO es por estado

Antes había un filtro por estado (`?status=submitted`). Se fue con el tablero:
las columnas SON los estados, así que filtrar por estado es enseñar una sola
columna — una pregunta que el propio tablero contesta de un vistazo.

El filtro es ahora `?ready=ready|blocked`: **puede llevar carga / bloqueado**.
Es lo que el tablero no contesta solo, y contiene el caso que esta pantalla
existe para encontrar — el aprobado con un documento vencido, al que ninguna
lista por estado enseña porque sigue en `approved`.

Un valor de filtro que no esté en la lista se ignora y se ve todo. Tratarlo
como «no coincide con nada» dejaría el tablero vacío ante una URL vieja, y
quien lo mire creería que no hay transportistas.

Los recuentos de los chips salen de las filas ya calculadas, no de una consulta
`group by` aparte: con dos consultas el chip diría un número y el tablero
enseñaría otro en cuanto el filtro estuviera puesto.

## Lo que la tarjeta NO enseña

`carrierNotApproved` no se pinta. En la lista de antes el estado era una
etiqueta al lado del nombre y ese motivo añadía algo; aquí el estado es la
columna, así que la tarjeta repetía en rojo lo que su cabecera ya decía —y
salían así **todas** las tarjetas de seis de las siete columnas. Un aviso que
aparece siempre deja de leerse y arrastra consigo a los que sí importan, que
estaban al lado.

## Las columnas

`OnboardingController::COLUMNAS` fija el orden: el recorrido del alta de
izquierda a derecha, con los dos terminales al final. No se deriva de
`OnboardingStatus::cases()` —el orden de un enum es el orden en que alguien
escribió los casos— pero el guardián exige que la lista cubra todos los casos,
ni uno más ni uno menos. Un estado sin columna no sale mal: sale **invisible**,
y quien mire el tablero creerá que no hay ninguno.

## Lo que sigue abierto

- **El tablero no reordena dentro de una columna.** No hay prioridad manual, y
  el orden dentro de cada columna es el de la cola (lo que lleva más tiempo
  esperando, primero).
- **No se enseña un despachador dueño de la ficha.** El bloque `board` del
  diccionario llevaba escrito desde el principio «Despachador asignado» y «Sin
  asignar», para un tablero que nadie había construido. El esquema no lo
  modela: `dispatcher_resource_assignments.resource_type` admite camión,
  remolque, conductor o grupo, pero no transportista. Pintarlo habría exigido
  inventar la asignación, así que esas dos claves —y otras tres del mismo
  bloque que describen cosas que el tablero deliberadamente no enseña— se
  borraron. Cuando exista la asignación por transportista, se vuelven a
  escribir.
- **No hay actualización en vivo.** Dos personas trabajando el mismo tablero se
  enteran de lo del otro al recargar; entretanto, la suelta que llegue tarde se
  rechaza con el 422 de siempre, que es la parte que importa.

## Guardianes

- `tests/Unit/Suite/OnboardingBoardTest.php` — que el tablero no vuelva a llevar
  copia del flujo, que el espejo de la ficha coincida con el grafo, que haya una
  columna por estado y rótulo para cada una en los dos idiomas, y que los tres
  pasos que perjudican sigan pidiendo motivo.
- `tests/Feature/Onboarding/BoardTest.php` — el circuito: los destinos que trae
  cada tarjeta recorriendo el grafo entero, que el permiso los recorte, que
  soltar mueva de verdad, que un destino ilegal se rechace aunque se mande a
  mano, y que los recuentos del filtro cuadren con las tarjetas.
