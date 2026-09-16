# Los tres relojes de la ficha de la carga

## El defecto

Cuatro filas seguidas, en la misma tarjeta, sin una sola etiqueta de huso:

```
Recogida planificada    16 sep, 1:00      (se guardó 06:00)
Recogida real           16 sep, 6:05      (se guardó 11:05 UTC)
```

**Cinco minutos de retraso, leídos como cinco horas.** En la pantalla más usada
de la aplicación.

Las dos columnas no están en el mismo reloj y nunca lo estuvieron:

- `planned_pickup_at` / `planned_delivery_at` las teclea el despachador en un
  `datetime-local` y se guardan tal cual. El propio formulario lo demuestra: las
  devuelve con `value.slice(0, 16)`, sin convertir nada. Son **hora de pared**.
- `actual_pickup_at` / `actual_delivery_at` las escribe el servidor con `now()`,
  y `config('app.timezone')` es `UTC`.

La pantalla les aplicaba a las cuatro el mismo `new Date(...)` del navegador.

Y en el listado, la fecha prevista salía de `new Date(instante)`: una recogida
planificada a las **02:00** aparecía con la fecha del **día anterior** para
cualquiera al oeste de Greenwich.

## La decisión ya estaba tomada, justo encima

`App\Support\Loads\StopClock` razona este mismo defecto para `load_stops`, en la
misma pantalla, unos centímetros más arriba. Incluye la medición —«ventana 08:00,
hora local 09:04, se guardó 13:04… cuatro horas de error en verano; cinco para
una parada de Chicago en invierno»— y la alternativa que se descartó:

> Era la otra salida: guardar las dos en UTC y convertir las dos al pintar.
> Habría que reinterpretar cada `window_start` que ya existe… y si el huso de
> alguna fila está mal, eso mueve una cita de verdad sin forma de saber cuál se
> movió.

Las paradas quedaron arregladas. Las columnas de la carga, que son lo mismo un
nivel más arriba, no entraron en aquel lote. `App\Support\Loads\LoadClock` aplica
la misma regla sin inventar ninguna: se apoya en `StopClock` para todo, y hay un
guardián que exige que sea así — dos piezas contestando «¿en qué reloj está esta
hora?» acaban contestando distinto, y el día que pase, las paradas y la carga
dirán horas diferentes de la misma recogida.

## Qué reloj lleva cada hora

| Hora | Reloj | Por qué |
|---|---|---|
| `planned_pickup_at` | muelle de la **recogida** | es la cita, y una cita es del muelle |
| `actual_pickup_at` | muelle de la **recogida** | para que la comparación con la fila de arriba sea la que el ojo espera |
| `planned_delivery_at` | muelle de la **entrega** | |
| `actual_delivery_at` | muelle de la **entrega** | |
| `pod_received_at` | **quien mira** | no es una hora de muelle: es cuándo llegó el papel a la oficina |

El huso sale de la parada que corresponde, no de una sola para las dos: en una
carga de Laredo a Nueva York, la entrega en hora de Texas llegaría una hora antes
de lo que dice el muelle que la recibe. Hay una prueba con esos dos husos.

Una carga **sin paradas** —un borrador recién creado— cae al por omisión de
`StopClock`, que es `America/Chicago` y no el del reloj general. Son dos valores
distintos a propósito.

## Las tres cosas que no se han tocado

**El valor crudo sigue saliendo.** `plannedPickupAt` en ISO se queda en el
payload porque ese mismo payload alimenta el formulario de edición, y ahí la hora
tiene que volver tal cual salió. Es exactamente la razón por la que `windowStart`
de las paradas va sin recortar. Un sabotaje que lo quita pone la suite en rojo.

**Las dos llevan etiqueta.** Convertir sin decir en qué reloj está lo que se
enseña deja el problema a medias: quien lee «6:00» sigue sin saber si es su hora
o la del muelle. Dos relojes en la misma tarjeta se pueden leer; dos relojes sin
etiqueta, no.

**Nada se migra en la base de datos.** Por el motivo que `StopClock` ya dejó
escrito: reinterpretar horas ya guardadas mueve citas de verdad sin forma de
saber cuáles.

## El listado, en una consulta

La fecha prevista de cada fila necesita el huso de su parada. Una consulta por
fila serían veinticinco por página; `LoadClock::muellesDe()` las pide todas de
una vez y el guardián exige que el listado use esa forma y no la del singular.

## Los guardianes

`tests/Unit/Suite/LoadClockTest.php` — 6 comprobaciones: que lo previsto no se
convierta y lo real sí, que la maquinaria sea la de las paradas y no una copia,
que el huso salga de la parada que corresponde, que el listado pida los husos en
bloque, que la ficha mande las cinco resueltas **y** el crudo del formulario, y
que ninguna de las dos pantallas vuelva a construir una fecha.

`tests/Feature/Loads/LoadClockTest.php` — 6 pruebas con el caso exacto: previsto
06:00 de Chicago, llegada real guardada como 11:05 UTC. Sale 06:05. Más el huso
de la entrega, el comprobante en el reloj del que mira —con el usuario puesto en
Los Ángeles—, el crudo del formulario, el día del listado y la carga sin paradas.

**12 sabotajes, 12 rojos.** Uno se cayó por el camino y merece contarse: quitar
de `LoadClock` la comprobación del huso vacío no cambiaba nada, porque
`StopClock` ya lo hacía. Era la segunda pieza contestando la misma pregunta, así
que se quitó en vez de blindarla — y en su lugar entró un sabotaje que sí
importa: coger el huso de la parada equivocada.

Recorrido con el navegador puesto en `America/Los_Angeles`, en los dos idiomas:
«2026-08-08 06:00 CDT» y «2026-08-08 06:05 CDT», cinco minutos.
