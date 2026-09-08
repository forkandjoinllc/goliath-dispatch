# La hora que el cliente leía mal

## El defecto

En la misma lista, una al lado de la otra y sin etiqueta, se pintaban dos horas
que **no estaban en el mismo reloj**:

| Columna | Quién la escribe | En qué reloj |
|---|---|---|
| `window_start` / `window_end` | el despachador, en un `datetime-local` | la hora **del muelle** |
| `actual_arrival_at` / `actual_departure_at` | `StopProgress`, con `CarbonImmutable::now()` | **UTC** (`config('app.timezone')`) |

Y `load_stops.timezone` —que existe por decisión deliberada, con
`docs/customer-places.md` explicando que «una cita puede pactarse en otro huso…
es una decisión de esa carga»— **no se usaba en ninguna parte**. Solo se pasaba
al formulario para poder editarlo.

## Medido, no razonado

Anotando una llegada por el camino real sobre una parada de `America/New_York`:

```
huso de la parada : America/New_York
ventana guardada  : 2026-09-16 08:00
llegada guardada  : 2026-09-08 13:04
hora local        : 2026-09-08 09:04
```

Un camión que llegó a las **09:04 locales** —una hora dentro de una ventana de
08:00 a 12:00, o sea **puntual**— se pintaba como llegado a las **13:04**: una
hora después de cerrarse la ventana. Cuatro horas de error en verano, cinco para
una parada de Chicago en invierno.

Y se leía así en la **página pública de rastreo**, la que abre el cliente sin
cuenta desde un enlace.

## Lo que se hizo

`App\Support\Loads\StopClock` es el único sitio que sabe la regla:

- `window()` **no convierte**: esa hora ya es del muelle. Existe como método
  —en vez de dejar el `substr` suelto— para que quede escrito que no se toca a
  propósito, y para que el guardián pueda exigir que se pase por aquí.
- `moment()` convierte un instante en UTC al huso del muelle.
- `label()` da la abreviatura —CDT, EST— **a partir de la fecha**, porque la
  misma parada es CST en enero y CDT en julio.

Y todas las horas se etiquetan. Convertir sin decir en qué reloj está lo que se
enseña deja el problema a medias: quien lee «8:00» sigue sin saber si es su hora
o la del muelle.

Cinco superficies: la página pública de rastreo, la de despacho, la ficha de la
carga, la cronología de sucesos y el **PDF de la confirmación de tarifa** — el
papel que compromete dinero y se le manda a un transportista que puede estar en
otro huso.

## Por qué NO se migró la ventana a UTC

Era la otra salida: guardar las dos en UTC y convertir las dos al pintar.
Habría que reinterpretar cada `window_start` que ya existe como si estuviera en
el huso de su parada y reescribirlo — y **si el huso de alguna fila está mal,
eso mueve una cita de verdad sin forma de saber cuál se movió**.

Se hizo lo contrario: la ventana sigue siendo hora del muelle, que es lo que
`load_stops.timezone` significa, y lo que se convierte al enseñarlo es el
instante, que es el que sí está en UTC.

## El susto del recorrido

Al arreglar la lista de paradas y abrir la página del cliente, la **cronología
de más abajo seguía en UTC**. La misma página decía «llegó a las 09:04» arriba y
«13:04» abajo, del mismo suceso.

Eso es peor que el defecto original: antes era una hora mala, después eran dos
horas que se contradicen y quien lee no sabe cuál creerse. Se arregló la
cronología y la última posición, y hay una prueba que exige que las dos digan lo
mismo en la misma respuesta.

## Lo que queda fuera, y se dice

- **Un suceso sin parada se enseña en el huso del ORIGEN.** Una posición del
  proveedor a mitad de camino no cuelga de ninguna parada, y una carga cruza
  husos. Se elige el del origen porque es el criterio que usa quien despacha, y
  va etiquetado como todos los demás para que se vea cuál es. No es una verdad:
  es una convención dicha en voz alta.
- **La ventana sigue sin validarse contra el huso.** Nada comprueba que el
  despachador escribiera la hora del muelle y no la suya. El sistema lo asume,
  como lo asumía antes; la diferencia es que ahora lo dice.
- **`dt()` en la ficha de la carga formatea con `Intl` en la hora del
  navegador.** Sobre una cadena sin zona eso no mueve el número, pero tampoco lo
  explica: la etiqueta del huso es lo que quita la ambigüedad ahí.
- **Nada corrige el pasado.** Las llegadas guardadas siguen en UTC —y así deben
  seguir—; lo que cambia es cómo se enseñan. Ninguna cifra histórica se toca.
- **El huso del usuario (`users.timezone`) sigue sin usarse.** Se decidió
  enseñar la hora del MUELLE y no la de quien mira, porque una cita es del
  muelle. Queda escrito por si algún día se quiere ofrecer las dos.

## Ficheros

| Fichero | Qué hace |
|---|---|
| `app/Support/Loads/StopClock.php` | **Nuevo.** El único sitio que sabe en qué reloj está cada hora. |
| `app/Support/Tracking/Timeline.php` | La cronología, en el huso de cada suceso. |
| `app/Support/Loads/RateConfirmation.php` | El PDF lleva el huso de cada ventana. |
| `app/Http/Controllers/Public/TrackingController.php` | La página del cliente: paradas, cronología y última posición. |
| `app/Http/Controllers/App/TrackingController.php` | La de despacho. |
| `app/Http/Controllers/App/LoadController.php` | La ficha de la carga. |
| `resources/js/pages/{Public/Tracking,App/Tracking/Show,App/Loads/Show}.tsx` | La etiqueta del huso junto a cada hora. |
| `lang/{en,es}/tracking.json` | Los seis rótulos, con `{zone}`. |
| `tests/Unit/Suite/StopClockTest.php` | **Nuevo.** 13 guardianes, 14 sabotajes en rojo. |
| `tests/Feature/Tracking/StopClockTest.php` | **Nuevo.** 6 pruebas, con la llegada anotada por el camino real. |
