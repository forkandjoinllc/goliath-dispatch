# Los filtros del tablero, y el panel de la campana

Arriba del tablero, antes de las acciones rápidas: **el periodo** y **el
transportista**. Primero se decide qué se está mirando, y después se añade.

## Qué significa «hoy»

El tablero viene puesto en **hoy**, y «hoy» no quiere decir «las cargas cuya
fecha es hoy».

Una carga que recogió ayer en Laredo y entrega mañana en Gary está rodando
**ahora**: es exactamente la que hay que tener delante. Con el criterio literal
desaparecería del tablero justo los días en que está en la carretera. Así que
una carga entra en el periodo cuando **su tramo se cruza con él** — de su
primera cita a la última.

Los demás periodos son los de siempre: ayer, esta semana, la semana pasada,
este mes, el mes pasado, este año, el año pasado, y un rango a medida con dos
fechas. La **semana empieza en domingo**, que es como empiezan la semana de
trabajo y las hojas de horas en Estados Unidos.

Una carga **sin citas** —un alta a medio hacer— sale igual el día que se crea.
Sin esa segunda mitad del filtro desaparecería el mismo día que nace, que es
cuando más falta hace verla.

## El reloj es el de quien mira

«Hoy» empieza a medianoche, pero a la medianoche de quién. Todo se guarda en
UTC: resolver los límites en UTC daría un «hoy» que empieza a las siete de la
tarde del día anterior para alguien en Texas. Los límites se calculan en el huso
de quien mira y se convierten a UTC para preguntar.

Y el último día del rango entra **entero**. Con el otro extremo puesto a
medianoche, una carga de las cinco de la tarde del último día caía fuera del
rango que la nombra.

## Lo que no se arregla por dentro

Un rango a medida del revés —del 15 al 1— **no se intercambia en silencio**:
vuelve a «hoy», y el desplegable dice «hoy». Un periodo que no existe, igual. Un
desplegable que dice «marzo» sobre una lista de hoy es peor que uno que dice
«hoy»; lo que viaja a la pantalla es el periodo que **se está usando**, no el
que pidió la URL.

## El transportista

Desplegable con buscador: una empresa con cuarenta transportistas no recorre una
lista, escribe tres letras. Recorta **las cargas y los conductores**, porque
filtrar por un transportista y seguir viendo a los conductores de los demás no
contesta nada.

Se ofrecen **todos** los que existen y no solo los que tienen carga en el
periodo: un desplegable que cambia de contenido al cambiar la fecha obliga a
volver a buscar el mismo nombre cada vez, y esconde justo el caso que se quiere
ver — «¿este no tiene nada esta semana?».

El identificador que llega por la URL se comprueba contra la lista que esa
persona puede elegir. `LoadScope` ya impide ver cargas ajenas, pero sin esta
segunda comprobación el tablero saldría vacío **con el nombre de una empresa
que no es suya** en el desplegable, y eso ya confirma que existe.

## Lo que el periodo NO recorta

**La columna de conductores.** Existe para contestar «¿a quién se la doy?», y
esconder a los que hoy no han hecho nada la deja sin contestar nada.

**La carga que se abre por su enlace.** El filtro recorta lo que se LISTA, no lo
que se puede abrir: pegar en un mensaje el enlace de una carga de marzo tiene
que abrirla aunque el tablero esté puesto en «hoy». Son dos cosas distintas y
por eso son dos métodos — `scoped()` es la frontera del rol y no se negocia;
`filtradas()` es lo que además se ha pedido mirar, y se cambia con un
desplegable.

**Lo que sí recorta** es la cronología del panel del conductor, que es su
«actividad». Y con una lectura: una asignación entra si se hizo dentro del
periodo **o si seguía en pie durante él**. Preguntar «¿qué hizo esta semana?»
por alguien al que se le asignó una carga el lunes pasado y sigue con ella tiene
que contestar esa carga, no «nada».

## Una pregunta, un sitio

La lista, las cuentas de las pestañas y el mapa preguntan por las mismas cargas,
y las tres pasan por `filtradas()`. Con el filtro escrito en cada una, la que se
desviaría sería la cuenta de la pestaña: el número que dice «12» encima de tres
tarjetas, y quien lo mira concluye que faltan nueve. El mapa va detrás por el
mismo motivo — puntos sin tarjeta son puntos que se pulsan y no llevan a
ninguna parte.

Los dos filtros viajan en la URL, como la pestaña y la selección, y por lo
mismo: el enlace se pega en un mensaje y abre lo mismo, el botón de atrás
deshace el filtro, y el refresco de cada minuto no lo pierde. `boardHref` los
escribe una sola vez, porque son ocho enlaces y el noveno es el que se olvida.

## La campana ahora abre un panel

Durante mucho tiempo fue un enlace a secas, con este argumento escrito: un panel
flotante obliga a decidir cuáles caben y deja al resto detrás de un «ver todos»
que casi nadie pulsa. Sigue siendo verdad. Lo que ese argumento no pesaba es el
otro lado: sin panel, mirar de qué va un aviso cuesta salir de lo que se está
haciendo, cargar otra pantalla y volver — en el tablero de despacho, perder el
sitio.

El panel enseña seis y el **«ver todos» está arriba**, no escondido al final:
es la respuesta al defecto del argumento viejo, no una excusa para ignorarlo.

**Lo sin leer va primero**, aunque sea más viejo. Quien abre la campana viene a
ver lo que no ha visto; ordenar solo por fecha empuja lo nuevo fuera del panel en
cuanto llegan seis avisos ya leídos.

Reutiliza el `useMenu` de la barra superior —cierra al pulsar fuera, cierra con
Escape, devuelve el foco al botón— en vez de escribir un cuarto menú que acabaría
haciendo dos de las tres cosas.

### A dónde lleva, lo decide el servidor

La pantalla **no recibe la dirección** del aviso: solo si la hay. Publica en
`POST /notifications/{id}/open`, y el servidor marca el aviso leído y redirige.
Un aviso de firma va a la firma y uno de gasto a los gastos, y eso lo sabe quien
escribió el aviso, no la campana.

Es POST y no GET aunque «abrir» suene a mirar, porque marca leído: un GET que
cambia algo lo dispara cualquier cosa que adelante enlaces.

Y el destino **se comprueba antes de redirigir**. `action_url` la escribe la
aplicación y hoy siempre es una ruta de dentro, pero es una columna de texto: el
día que algo escriba ahí `//otro-sitio.example`, el servidor mandaría a la gente
fuera con la sesión abierta, porque el navegador lee esas dos barras como un
dominio. Se exige una barra y no dos. Un aviso de otra persona no se abre y —lo
que importa— **no se le apaga su campana**.

## Lo que hay que hacer en el servidor

Nada. Ver `docs/dispatch-board.md` y `docs/board-panels.md`.
