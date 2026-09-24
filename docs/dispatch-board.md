# El tablero de despacho

Lo que se abre por la mañana y se queda abierto todo el día. Ocupa la raíz —
`/home`— y el panel de siempre, el de lo pendiente y lo que el rol alcanza, se
fue a **Análisis**, que es donde se mira de vez en cuando.

Tres columnas que contestan la misma pregunta por tres caminos: qué hay que
mover, dónde está, y quién puede moverlo. Están juntas porque la respuesta a una
lleva a la siguiente.

Las cargas van pegadas al borde izquierdo y los conductores al derecho,
separadas del mapa por una **línea** y no por aire: en una pantalla que se mira
de reojo todo el día, el borde es lo que dice dónde acaba una cosa y empieza
otra. Todo lo que queda entre las dos columnas es mapa, de línea a línea. Cada
columna se desplaza sola — si la lista de cargas arrastrara la página, el mapa
se iría hacia arriba al bajar por las cargas, en la pantalla donde se mira el
mapa MIENTRAS se lee la lista.

## El menú está recogido

No es el patrón de móvil aplicado a todo: es que el ancho de la pantalla se lo
lleva el trabajo, y aquí las dieciséis rem que ocupaba el menú fijo son
dieciséis rem de mapa. Se abre con el botón de la barra superior, **delante del
logo**, y entra deslizándose de izquierda a derecha por debajo de la barra.

Tres cosas que no se ven y tienen que seguir siendo ciertas: el cajón se **pinta
siempre** aunque esté cerrado —una animación necesita un estado del que salir—,
cerrado queda **fuera del recorrido del tabulador** —un menú escondido por el
que se puede tabular atrapa a quien navega con teclado en veinte enlaces que no
ve— y el botón **no se esconde** en pantalla ancha, porque es el único camino
para abrirlo. `ShellChromeTest` las vigila.

El logo se mudó del cajón a la barra: con el menú recogido, el logo se iba con
él y la aplicación se quedaba sin nombre en pantalla.

## 1. Las cargas, en tres pestañas

**Sin asignar** no es un estado de la carga: es la **ausencia de conductor** en
`load_assignments`. Una carga despachada a la que alguien le quitó el conductor
sigue sin asignar —conserva el camión puesto— y es justo la primera que hay que
ver. Medirlo con «no tiene ninguna asignación» habría dado lo mismo en la
demostración y otra cosa el día que importa.

**Completadas** empieza en `delivered`. Para quien despacha, la carga se acabó
cuando se entregó; el comprobante, la factura y el cobro los mira finanzas en su
pantalla. Por eso esta lista **no** es la de `OpenWork::CARGAS_CERRADAS`, que
contesta otra pregunta —«¿se puede borrar este cliente?»— y solo cierra en
`paid` y `cancelled`.

Las tres son una partición: cada carga viva cae en una y solo una. Una prueba lo
comprueba sumando las tres contra las cargas vivas de la base.

Cada tarjeta lleva el conductor con su avatar, la **combinación** de camión y
remolque tal como se dice en la radio —«C-07 · R-14»—, el cliente, y la fecha de
la **siguiente** parada **diciendo si es recogida o entrega**. La siguiente es la
primera a la que no se ha llegado: quien mira quiere saber qué falta, no qué ya
pasó.

La hora es la **del muelle**, resuelta en el servidor con `LoadClock::previsto`.
Una recogida a las 02:00 en Laredo pintada con el reloj de quien mira sale con la
fecha del día anterior.

## 2. El mapa

Se refresca solo cada minuto, con una recarga **parcial** de Inertia: vuelven las
cargas, el mapa, los conductores y las cuentas, y no vuelve el armazón.

Las recogidas son un PIN naranja con una **P** dentro y las entregas uno azul
marino con una **D**. Los camiones son un círculo con la **silueta del conjunto
según el tipo de remolque** —una cama baja no se dibuja igual que una caja
seca—: en un mapa con treinta puntos el dibujo se lee antes que el texto.

### Con clave de Google y sin ella

`MapProvider` es una interfaz, como `FmcsaDirectory` o `TrackingProvider`. Con
`GOOGLE_MAPS_KEY` en el servidor se ata Google; sin ella se ata el de **fondo
liso**, que hace de verdad lo que un mapa del tablero tiene que hacer —cada
punto en su sitio, con su zoom— y solo le falta la carretera. La pantalla lo
dice con esas palabras en vez de dejar un rectángulo gris que parece que está
cargando.

Los dos dibujan **el mismo PIN**: si cada mitad dibujara el suyo, la instalación
sin clave enseñaría un mapa que no se parece al de producción y nadie lo notaría
hasta llegar allí.

**La clave de mapas no es un secreto.** La API corre en el navegador y su clave
viaja con la página: es pública por diseño. Lo que la protege es restringirla por
dominio en la consola de Google, que es donde hay que hacerlo. Aun así entra por
el `.env` del servidor, porque una clave sin restringir se puede gastar.

### Las posiciones son las que hay

Hoy las posiciones entran **por carga**: `tracking_sessions` se abre para una
carga y `tracking_events` guarda lo que llega. **No hay registro de
dispositivos** —ni un GPS atado a un camión ni un ELD atado a un conductor—, así
que un conductor sin carga en curso no tiene posición.

El tablero no lo tapa: cuenta las cargas en curso sin posición y dice por qué. Y
cada punto viaja con su procedencia, porque `manual` —una persona de despacho
que colgó el teléfono y anotó dónde iba el camión— no es un GPS por mucho que
ocupe el mismo píxel.

Cuando exista el registro de dispositivos, `Support\Board\Positions` es el único
sitio donde hay que tocar además de aquí.

## 3. Los conductores

Avatar, nombre y apellido, su camión y su remolque, un punto de color con el
estado y el teléfono como enlace `tel:` — el tablero se mira desde el móvil y se
marca desde ahí.

El estado usa **las mismas palabras que la ficha del conductor**
(`drivers.status.*`). Un segundo juego de nombres para los mismos estados acaba
diciendo otra cosa. Son cuatro y no tres: `off_duty` existe en el producto y
esconderlo sería enseñar un conductor «inactivo» que no lo está.

**El avatar son las iniciales sobre un color estable.** No hay fotos de conductor
en el producto —`equipment_media` guarda fotos de UNIDADES— y una cara sacada de
un banco de imágenes sería una persona que no existe puesta donde va un
compañero de trabajo.

## El equipo habitual de un conductor

La columna de la derecha necesitaba una pregunta que el producto no sabía
contestar: **¿con qué anda este conductor?** `load_assignments` dice qué camión
llevó qué carga, y un conductor sin carga en curso no tenía equipo que enseñar.

`driver_equipment_assignments` lo contesta, con fechas de inicio y fin. Las
reglas:

- **Un conductor, una asignación a la vez.** Si no, «¿cuál es su camión?» tiene
  dos respuestas y la pantalla elige una al azar.
- **Un camión, un conductor a la vez.** Dos conductores con el mismo camión el
  mismo día no existe en la calle.
- **Un remolque, los que hagan falta.** En una flota los remolques se sueltan y
  se recogen; exigir exclusiva obligaría a inventar.
- **El camión sí hace falta.** Una asignación sin camión no asigna nada.

El solapamiento **no lo puede comprobar MySQL** —no hay tipo rango ni
restricción de exclusión— así que vive en `Support\Fleet\StandingAssignment`, en
un solo sitio, y un guardián comprueba que nadie más escriba en la tabla sin
pasar por ahí.

**Terminar no es borrar.** Una carga de marzo se mira con el camión que se llevó
en marzo; terminar pone fecha de fin y el historial queda en la ficha.

### Prerrellena la carga, no la decide

Poner al conductor en una carga trae su camión y su remolque. Con tres límites, y
los tres importan:

1. **No pisa lo que ya estaba puesto.** Prerrellenar es rellenar lo vacío.
2. **No se salta la puerta.** La unidad pasa el mismo `checkResource` que pasaría
   puesta a mano: del transportista de la carga, verificada, en servicio. El
   camión de siempre está en el taller y entonces **no entra** — que es
   exactamente lo que la demostración enseña con De la Torre y el C-12.
3. **Y cuando no trae nada, no dice que trajo algo.** El aviso nombra lo que de
   verdad entró.

`load_assignments` sigue mandando en lo que se despacha.

## Lo que pasa al pulsar

Pulsar una carga o un conductor abre su panel en el sitio de su tarjeta, con
tres pestañas y un menú de tres acciones; arriba hay dos altas rápidas en
ventana. Todo eso está en **`docs/board-panels.md`**, y los dos filtros de
arriba —periodo y transportista— en **`docs/board-filters.md`**.

## Lo que hay que hacer en el servidor

`php artisan migrate`, y —si se quiere carretera debajo del mapa—
`GOOGLE_MAPS_KEY` en el `.env`, restringida por dominio en la consola de Google.
Sin ella el tablero funciona igual y lo dice.
