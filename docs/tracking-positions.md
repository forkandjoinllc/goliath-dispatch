# Dónde va el camión

Este documento explica de dónde salen las posiciones que ve despacho y que ve el
cliente, qué se sabe de verdad y qué no, y qué cambia el día que haya un
proveedor de GPS conectado.

## El defecto que había

Tres pantallas —la ficha de la carga, el panel de rastreo y la página pública del
cliente— leían `load_stops.actual_arrival_at` y `actual_departure_at`. **No las
escribía nadie.** No es que estuvieran poco usadas: no había en todo el código
una sola escritura.

`tracking_events` estaba igual: vacía desde el primer día.

La consecuencia se veía entera desde fuera. Al cliente al que se le manda un
enlace con el logo y los colores de la casa de despacho —lote 61— se le enseñaba
una lista de paradas donde todas ponían «pendiente». Para siempre. También con la
carga ya entregada. Y arriba, «última actualización», salía la última llamada de
teléfono que alguien hubiera anotado a mano, o nada.

Encima de eso, al conductor se le pedía consentimiento —lote 58— para «enviar su
posición GPS a despacho y a los clientes que vean el enlace público». Un permiso
para algo que no ocurría.

## De dónde salen las posiciones

De dos sitios, y la pantalla dice siempre cuál:

| Origen | `provider` | Quién lo produce |
|---|---|---|
| Despacho documentando el viaje | `manual` | Una persona: marca la llegada o la salida de una parada, o anota dónde estaba el camión al colgar una llamada de control |
| Un proveedor de telemática | `trucker_tools`, `macropoint`, `highway` | Un aparato en el camión. **Hoy no hay ninguno conectado** |
| El simulador | `mock` | Herramienta de desarrollo. No existe en producción |

La distinción se le enseña también al cliente —«Anotado por despacho» frente a
«Reportado por el rastreo del vehículo»— y no es un detalle de implementación
que se le escape: es la diferencia entre «el camión reportó» y «alguien nos
dijo», y las dos son ciertas pero no valen lo mismo.

## No se inventa una coordenada. Nunca

En esta aplicación **no hay una sola coordenada**. `load_stops.latitude` y
`longitude` existen desde el primer día y no las escribe nadie, y
`StopDerivedRouteProvider` devuelve la ruta sin geometría a propósito: «inventar
una distancia en línea recta la haría parecer un dato».

De ahí se sigue todo lo demás:

- Una posición aquí es **un lugar con nombre** («Laredo, TX»), no un par de
  números. `PositionReport` admite coordenadas porque un proveedor de verdad las
  manda y la tabla las espera; el adaptador deducido las deja nulas siempre.
- **No hay mapa.** Un punto interpolado entre dos ciudades sin coordenadas sería
  una invención con forma de mapa, que es la manera más convincente que tiene un
  dato falso de parecer verdadero.
- **No hay llegada estimada.** `session.eta_at` se queda nula y la pantalla dice
  «no hay llegada estimada disponible». Sin millas de ruta ni velocidad, una
  estimación sería una hora inventada que alguien le promete a un cliente.
- **El avance se cuenta en paradas**, no en porcentaje de recorrido. «1 de 2
  paradas hechas» es lo que se sabe; «50 % del recorrido completado» con el
  camión recién llegado a la recogida es falso.

El guardián `TrackingIngestionSafetyTest` sujeta esto: el adaptador deducido no
puede producir una latitud, y la línea de tiempo no puede leer coordenadas.

## La ingesta

`App\Support\Tracking\Ingestion` es el **único** sitio que escribe en
`tracking_events`. Tres reglas:

1. **Sin consentimiento vigente no entra un parte de proveedor.** Se comprueba en
   cada parte, no una vez por lote: `Sessions::cerrarPorRetirada` cierra la
   sesión al retirarlo, y esto es el segundo cerrojo para el parte que llegue por
   webhook un segundo después.
2. **La idempotencia la impone el índice**, `unique (provider,
   raw_provider_reference)`, con `insertOrIgnore`. Un webhook que se reintenta y
   un botón que se pulsa dos veces son el camino normal, no una excepción.
3. **Solo se escribe lo que el parte trae.** Ninguna columna se calcula aquí.

Lo que anota una persona entra por `Ingestion::manual()` y **no** pasa por el
consentimiento, a propósito: el consentimiento es para que un aparato mande la
posición de alguien. Que un despachador escriba «llegó a Odessa a las 14:10» es
el registro de un hecho del viaje, y atarlo al permiso del conductor daría a
entender que sin ese permiso la carga tampoco se puede documentar.

### Un cero no quiere decir «ya estaba»

`insertOrIgnore` degrada a aviso **todos** los errores del INSERT, no solo el
choque contra el índice único. Una columna que no admite nulos, un CHECK que no
se cumple y un duplicado se ven exactamente igual desde el código.

Por eso, cuando la inserción devuelve cero, `Ingestion` comprueba por el índice
único que la fila esté; si no está, lanza. Costó un recorrido con navegador
descubrirlo: la llegada se guardaba en la parada, la pantalla decía «Anotado.», y
la línea de tiempo se quedaba vacía porque faltaba correr una migración.

## Las reglas de las paradas

Están en `StopProgress` y son del mundo, no del código:

- **No se sale de donde no se ha llegado.** Guardado, hace que la duración de la
  parada salga negativa y que el avance cuente una parada que nadie vio hacer.
- **No se llega a la segunda sin pasar por la primera.** Marcadas al revés, lo
  que hay es un error de tecleo o unas paradas mal ordenadas.
- **No se fecha hacia adelante.** Una llegada futura se queda arriba del todo en
  la línea de tiempo del cliente hasta que el reloj la alcanza.

La pantalla ofrece **solo el botón que la puerta va a aceptar**: la llegada
aparece únicamente en la primera parada sin llegar. Un control que el servidor va
a rechazar no es una comodidad, es una trampa.

El lugar del suceso sale de la ubicación del cliente cuando la parada apunta a
una, y de la dirección escrita a mano cuando no —la misma regla que sigue el
resto de la aplicación—. Leyendo solo la columna suelta, el lugar salía en blanco
justo en las cargas que usan ubicaciones.

## La salud de la sesión

`health_status` mide **el tiempo desde la última posición conocida**, que es lo
que quiere decir «señal perdida»:

| Estado | Cuándo |
|---|---|
| `unknown` | Sesión abierta y ninguna posición todavía |
| `healthy` | Menos de 2 horas desde la última |
| `stale` | 2 horas o más |
| `lost` | 6 horas o más |
| `ended` | La sesión se cerró |

Los umbrales no salen de ninguna norma: salen de que un camión que lleva dos
horas sin reportar puede estar sin cobertura, y uno que lleva seis ya es asunto
de alguien. Están en constantes de `Ingestion` para que el día que se afinen se
afinen en un sitio.

Un «rastreo iniciado» es un suceso y **no** es una posición: no cuenta para la
salud. Contarlo producía un panel que decía «aún no se ha reportado ninguna
posición» y a la vez «saludable».

## El resumen de la sesión es una caché

`tracking_sessions.last_location_label`, `last_event_at`,
`route_progress_percent` y `health_status` son derivables de los eventos. Se
mantienen al escribir porque la página pública los lee en cada visita, y
recalcular el avance recorriendo todos los eventos en una página sin sesión de
usuario y con un token en la URL es donde menos conviene una consulta que crece.

Como es una caché, se puede reconstruir: `Ingestion::resumir($tenantId,
$sesionId)`.

Se resume **por carga** y no por sesión. Lo que se anota antes de abrir la sesión
—que es el orden normal— se guarda sin sesión, y una sesión abierta después no lo
veía: el panel decía «aún no se ha reportado ninguna posición» justo encima de la
línea de tiempo que sí la enseñaba.

`route_progress_percent` se llama «route» y guarda paradas. El nombre de una
columna no es una especificación: nació esperando un porcentaje de ruta que nadie
ha calculado nunca, y dejarla vacía por respeto a su nombre no habría hecho más
honesta a la aplicación. Lo que se ENSEÑA son las paradas.

## El simulador

`session.simulateButton` avanza un camión imaginario por la **secuencia de
paradas** —no hay geometría de ruta que seguir— y escribe los sucesos que se
hagan visibles. Cada suceso queda con `provider = 'mock'` y la pantalla lo dice.

Está cerrado por **dos** condiciones:

1. El proveedor atado tiene que ser el deducido.
2. **No puede ser producción.**

La segunda importa más de lo que parece: mientras no exista un adaptador de GPS
real, el proveedor atado es el deducido *también en producción*. Con solo la
primera, cualquier administrador tendría en su servidor de verdad un botón que
mete sucesos inventados en la línea de tiempo que su cliente está mirando por un
enlace. Una herramienta de desarrollo que existe en producción no es una
herramienta de desarrollo.

## El día que haya un proveedor de verdad

Cambia **una línea** en `AppServiceProvider`:

```php
$this->app->singleton(TrackingProvider::class, StopDerivedTrackingProvider::class);
```

El adaptador nuevo implementa `TrackingProvider` —`name()` tiene que devolver uno
de los cinco valores de `chk_tracking_events_provider` o el INSERT lo rechaza la
base de datos, que es donde se quiere que se rechace— y entrega sus partes por
`Ingestion::ingest()`. Si empuja por webhook, `poll()` devuelve la lista vacía y
el webhook llama a la ingesta; si hay que consultarlo, consulta en `poll()`.

No cambia nada más: ni la línea de tiempo, ni la página del cliente, ni la
puerta del consentimiento, ni el resumen de la sesión. En cuanto `isLive()`
devuelva verdadero, el panel deja de decir que no hay proveedor conectado y el
simulador desaparece.

Lo que sí queda pendiente ese día:

- Las coordenadas empezarán a llegar. La página del cliente sigue sin
  enseñarlas —`Timeline::paraCliente` ni las selecciona— y conviene que siga así.
- `eta_at` se podrá calcular de verdad, y `session.eta` ya está traducido.
- Habrá que decidir cada cuánto se consulta al proveedor, y `notifications:sweep`
  es el sitio natural.
