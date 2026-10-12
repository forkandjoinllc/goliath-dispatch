# Filtrar el tablero por estado

Dos filtros más, además del periodo y el transportista: el **estado de la
carga** y el **estado del conductor**. Los dos admiten varios valores a la vez,
porque en despacho «en tránsito» y «en entrega» son una sola pregunta, igual
que «disponible» y «en carga».

## Solo se ofrece lo que se puede enseñar

Las tres pestañas dejan fuera el borrador y lo cancelado (`Tabs::fuera()`), así
que esos dos **no entran en el desplegable**. Ofrecerlos daría un filtro que no
puede encontrar nada nunca: se elige «Cancelada», salen cero cargas en las tres
pestañas, y no hay nada en la pantalla que explique por qué.

La lista se calcula **restando** el uno del otro, no escrita a mano. Así un
estado nuevo aparece solo, y uno que salga de las pestañas desaparece del filtro
el mismo día. Escrita a mano, cualquiera de los dos cambios deja el filtro
mintiendo hasta que alguien se da cuenta.

Un `?status=cancelled` escrito a mano en la URL **se ignora** en vez de dejar el
tablero en blanco con un filtro puesto que nadie ve.

## El estado de la carga vive dentro de la pestaña

Filtra lo que esa pestaña ya enseña, y **las tres cuentas lo reflejan**. Elegir
«entregada» estando en «sin asignar» da cero, y eso es cierto: no hay ninguna
así. Lo que lo hace legible es el número de al lado — la cuenta de
«completadas» dice dónde está lo que se buscaba. Las cuentas hacen de brújula.

El mapa sigue a la lista, como ya hacía con el periodo: dibujar cargas que la
columna de la izquierda no enseña deja puntos sin tarjeta, se pulsa uno y no hay
dónde ir.

## El conductor: el reparto por defecto se escribe al revés

La columna de conductores contesta «¿a quién le doy esta carga?», y enseñaba
también a los **dados de baja** y a los **inactivos**. Ahora no, salvo que se
pidan.

Lo que se escribe en el código es **quién no trabaja** (`NO_TRABAJAN`), y el
reparto por defecto es todo lo demás. Escrito al derecho —una lista de «los que
sí»— un estado nuevo quedaría fuera del reparto y esos conductores
desaparecerían del tablero sin que nadie lo hubiera decidido. Al revés, un
estado nuevo entra solo: ese es el error que se puede ver.

Y se dice **cuántos quedan fuera**, debajo del propio filtro. Esconderlos en
silencio sería el mismo defecto del revés: un conductor que falta de una lista
sin explicación se busca durante un rato. Es la misma razón por la que el alta
dice cuántos camiones no ofrece.

Lo que se esconde se cuenta con el **mismo alcance y el mismo transportista** que
lo que se enseña. Contar sobre la empresa entera daría un número que no cuadra
con nada de lo que se está mirando.

## Lo que el filtro no decide

**El panel que se abre por su enlace.** Pegar en un mensaje el enlace de un
conductor dado de baja tiene que abrir su panel, filtro o no filtro; si no,
quien lo recibe concluye que la ficha no existe. Lo mismo que ya hacía la carga
que se abre por su enlace.

## En la URL, como todo lo demás del tablero

`?status=` y `?driverStatus=`, separados por comas, y **siempre en el orden del
servidor** y no en el que vinieran escritos: dos direcciones con los mismos
estados tienen que ser la misma dirección, o el botón de atrás y el enlace
pegado en un mensaje llevan a dos sitios que se ven igual.

Basura en la URL no vacía nada: en cargas, vacío quiere decir *todos*; en
conductores, vuelve el reparto por defecto. Una columna vacía porque alguien
tecleó mal la dirección no es un filtro, es una pantalla rota.

## Cada control manda los cuatro filtros

Con dos filtros había dos ayudas —«el periodo que ya está puesto» y «el
transportista que ya está puesto»— para que tocar uno no borrara el otro. Con
cuatro harían falta doce, y la que faltara sería la que borra un filtro al tocar
otro. Ahora hay **una** función que devuelve los cuatro, y cada control
sobrescribe el suyo encima.

## Dos diccionarios, dos convenciones

`nav.status.load` escribe `enRouteToPickup` y `drivers.status` escribe
`on_load`. No es un descuido: `UnnamedValuesTest` lleva declarado cuál es cuál.
El componente **pregunta** en vez de adivinarlo — convertir siempre a camello
pintaba la clave cruda en los seis estados de conductor.

---

Ver también: [board-filters.md](board-filters.md) · [board-panels.md](board-panels.md) · [testing.md](testing.md)
