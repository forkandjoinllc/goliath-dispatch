# Los paneles del tablero

Pulsar una carga o un conductor abre su panel **en el sitio de su tarjeta**, y
no en otra pantalla. Mirar una carga sin soltar el mapa es la mitad del trabajo
de despachar: se abre, se mira dónde va, se mira quién está cerca, se cierra.
Mandar a `/loads/{id}` a cada clic obliga a volver, y al volver el tablero está
en la primera pestaña y el mapa en el encuadre inicial.

Arriba, dos acciones rápidas: **agregar carga** y **agregar conductor**, en una
ventana.

## La selección viaja en la URL

`?load=` y `?driver=`, no el estado del componente. Cuesta un parámetro y paga
tres cosas: el enlace se pega en un mensaje y abre lo mismo, el botón de atrás
cierra el panel, y un refresco no pierde lo que se estaba mirando. El refresco
automático de cada minuto tampoco: pide cuatro propiedades por su nombre y las
del panel no están entre ellas, así que lo abierto se queda abierto.

La **pestaña va siempre** en esa dirección, y por eso se construye en un solo
sitio —`components/App/Board/href.ts`—. Son seis enlaces: la tarjeta, el
conductor, la cronología, los dos cierres y la carga en curso. El séptimo es el
que se olvida, y olvidarlo devuelve el tablero a «sin asignar» al cerrar el
panel: la lista de debajo ya es otra sin que nadie haya tocado nada.

Fuera de alcance devuelve **nulo, no 403**. Decir «no puede verla» ya diría que
existe, y con eso se enumeran las cargas de la competencia de una en una.

## Tres pestañas y tres puntos

**Detalle** es la carga: quién la lleva, con qué, y sus paradas con la hora del
muelle —la del muelle, resuelta en el servidor, con su huso escrito al lado—.
Cada parada dice además si ya se **llegó**, que no es lo mismo que «iba a las
ocho».

**Cliente** es con quién se habla: el contacto **de esta carga** y no el primero
de la ficha del cliente. Una empresa con seis contactos tiene uno por carga, y
llamar al que no es cuesta una llamada y media.

**Historial** junta cinco tablas en una sola lista ordenada:
`load_status_history`, `load_assignments`, las llegadas y salidas de
`load_stops`, los papeles de `load_documents` y las posiciones de
`tracking_events`. Ninguna es la historia; la historia es el orden en que
pasaron. Quien despacha no pregunta «¿qué dice `load_status_history`?»,
pregunta «¿qué ha pasado con esta carga?», y hasta ahora eso se contestaba
abriendo cinco sitios y ordenando de cabeza.

Cada suceso se enseña en la hora del muelle al que pertenece, y los que no
pertenecen a ninguno —una posición del proveedor, un cambio de estado— en la
del origen. Es el mismo criterio que `Tracking\Timeline`, y por el mismo
motivo: sin él, la parada dice «llegó a las 09:04» y la cronología «13:04» del
mismo suceso, en la misma pantalla.

Una posición **escrita a mano por despacho** no es un GPS por mucho que ocupe la
misma línea. La cronología las distingue: una dice dónde está el camión, la otra
dice dónde dijo alguien que estaba.

### El menú de los tres puntos

Tres acciones, y **las tres las decide el servidor** en `can`. Un menú que
ofrece lo que luego devuelve 403 al pulsar es peor que un menú corto: hace creer
que se puede, y solo se descubre que no después de intentarlo.

- **Editar** abre la ventana. Ver abajo.
- **Reasignar conductor** lleva a la ficha, a propósito. Asignar de verdad
  comprueba licencias, tarjetas médicas, inspecciones anuales y solapes de
  agenda, y los enseña uno a uno. Una ventanita con una lista de nombres sin esa
  comprobación ofrecería conductores que el servidor va a rechazar.
- **Cancelar** pide un motivo y no pregunta «¿seguro?». El motivo es lo que
  exige el servidor —diez caracteres— y además es lo que se le dice al cliente
  tres semanas después; un «¿seguro?» no deja nada escrito.

## La ventana de edición manda la carga entera

Enseña cuatro campos y **devuelve todas las columnas**. No es redundancia:
`PATCH /loads/{id}` no es un parche. `loadColumns` escribe cada columna con
`$data[...] ?? null` y `syncStops` **reemplaza** las paradas por las que le
llegan. Una ventana que mandara solo la mercancía y dos ciudades dejaría la
carga sin número de PO, sin peso, sin millas, sin instrucciones y con las
paradas reducidas a dos —sin contactos, sin código postal y sin el sitio del
cliente al que apuntaban—. Nada de eso daría un error: la pantalla diría
«guardado».

Cada parada vuelve **con su `id`**. Sin él, `syncStops` no la reconoce: borra la
de verdad y crea una nueva, y con ella se van las horas de llegada reales y las
detenciones.

Los guardianes leen las columnas **del otro lado** —del propio `syncStops`— en
vez de llevar una lista copiada: una lista copiada envejece sola en cuanto
`syncStops` gane una columna.

Lo que **no** viaja: `requirements` —`syncRequirements(null)` deja lo que
hubiera, que es justo lo que queremos de una ventana que no los enseña— y las
dos cifras en céntimos, porque `loadColumns` ya no las pisa cuando no vienen
(ver abajo). Los dos porcentajes del reparto sí, y solo si quien mira puede
tocar dinero: su valor por omisión no es nulo sino *la política de la empresa*,
pensada para cargas nuevas; aplicada a una que ya existe devolvería al 25 % una
comisión pactada al 18 %.

## Dos defectos de dinero que salieron por el camino

**`?? 0` convierte «este formulario no enseña el importe» en «el importe es
cero».** `loadColumns` escribía `customer_charge_cents` y
`carrier_gross_rate_cents` así. Un guardado que no trajera la cifra dejaba una
carga de 2.500 dólares a cero sin un error ni un aviso, y se descubría al
facturar semanas después. Ahora la ausencia significa «no lo toques»
—`array_key_exists`, igual que ya hacía `dispatcher_user_id`— y el cero
explícito sigue siendo un cero.

**La acción de cancelar estaba escrita con dos nombres.** `cancelled` es el
último segmento de la URL —`/loads/{id}/status/cancelled`— y la clave que mira
`Transitions::allowedFrom`. En el tablero estaba escrita «cancel», y
`allowedFrom` contestaba que no sin equivocarse: no existe ninguna arista con
ese nombre. El resultado era un menú que **nunca** enseñaba la opción, para todo
el mundo, sin un solo error en ningún sitio. Ahora se escribe una vez, en
`BoardController::CANCELAR`, y un guardián comprueba que la pantalla publique en
esa misma palabra.

## El panel del conductor

Los datos personales, el estado con su **motivo** cuando lo hay —«en pausa» sin
decir por qué obliga a preguntar por teléfono a quien lo puso—, el equipo
**habitual** (no el de la carga de hoy: la pregunta es «¿con qué anda?», que se
contesta igual esté llevando algo o no), la carga en curso si la hay, y una
cronología.

La cronología junta sus asignaciones con las posiciones de las cargas que llevó,
**y nada más**. No hay registro de dispositivos: las posiciones entran por
carga, así que un conductor sin carga en curso no tiene posición y la lista se
queda corta en vez de colocarlo donde estuvo ayer. Es la misma regla que sigue
el mapa.

## Las altas rápidas

Cada ventana pide **lo mínimo** que el servidor exige para que la cosa exista:
una carga necesita cliente y dos paradas; un conductor, nombre y apellidos. Al
guardar, el servidor lleva a la ficha —lo que ya hacían `LoadController::store`
y `DriverController::store` antes de que estas ventanas existieran— y ahí se
rellena lo demás con sitio para hacerlo.

La alternativa era meter el formulario entero en una caja más pequeña. Un alta
de carga tiene treinta campos; en una ventana se abandona a la mitad, y media
carga no se guarda.

Van por **las puertas de siempre**: `POST /loads` y `POST /drivers`. No hay un
camino de creación «del tablero», porque un segundo camino es un segundo sitio
donde olvidarse de un límite de plan, de un permiso o de una regla de
validación. Por eso tampoco hay validación propia en la ventana: los errores que
se pintan son los que devuelve el servidor, con sus mismas claves.

Las listas de clientes y transportistas viajan **solo si la persona puede
crear**. Un conductor tiene tablero, pero no da de alta ni cargas ni compañeros:
mandarle la lista de clientes de la empresa es un dato que nadie pidió.

## La ventana modal

Cuatro cosas, y las cuatro juntas son lo que hace que una caja con sombra sea
una ventana y no una trampa para quien usa el teclado: el foco **entra** al
abrirse, **no sale** mientras está abierta, **Escape** cierra, y el foco
**vuelve** al botón que la abrió.

El fondo cierra con `mousedown` y no con `onClick`: arrastrar para seleccionar
un texto del formulario y soltar un pixel fuera tiraba lo escrito.

## Los filtros

El periodo y el transportista, y el panel de la campana, están en
**`docs/board-filters.md`**.

## Lo que hay que hacer en el servidor

Nada nuevo. Ver `docs/dispatch-board.md` para `GOOGLE_MAPS_KEY`.
