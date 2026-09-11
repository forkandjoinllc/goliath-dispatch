# La escolta que no impedía nada

## Los dos agujeros

Los dos están en la misma puerta —la aprobación de «permisos listos», que es lo
que `Guards` exige para despachar una carga sobredimensionada— y los dos salieron
de la auditoría de la página pública.

### Uno: las escoltas no las miraba nadie

La página de Servicios decía:

> Una carga no puede despacharse con un permiso **o escolta** pendiente.

Lo del permiso era verdad. `Papers::faltan()` consultaba `permits` y solo
`permits`. **`escorts.status` no lo leía ningún guardián**: una escolta en
`pending` no impedía nada, y una carga sobredimensionada salía con una escolta
que nadie había confirmado. La frase hubo que quitarla de la página de ventas en
el lote anterior.

### Dos: la puerta no se volvía a cerrar

`storePermit` reabría la compuerta al crear un permiso pendiente, y su propio
comentario decía por qué:

> Si no lo hiciera, una carga aprobada el lunes seguiría aprobada el martes con
> un permiso nuevo sin tramitar dentro.

`updatePermit` no lo hacía. **Devolver un permiso emitido a pendiente dejaba la
carga aprobada y despachable** — el mismo argumento, escrito, sin aplicar a dos
funciones de distancia.

## Qué se hizo

Las escoltas se comprueban con las mismas dos preguntas que un permiso, y por
los mismos motivos:

| | Bloquea |
|---|---|
| Escolta sin cerrar (`pending`) | Sí — es la que no puede salir a la carretera |
| Confirmada o completada **sin su documento** | Sí — la casilla dice que está y el conductor no lo lleva |
| Cancelada o no requerida | No |
| **Sin ninguna fila de escolta** | **No** |

Lo último importa: bloquear por ausencia pararía toda carga sobredimensionada
que solo necesita permiso. Que la evaluación pueda **exigir** una fila de
escolta es otra cosa y otro lote — hoy es orientación, y así lo dice su propio
descargo de responsabilidad.

Y los cuatro caminos que tocan la puerta —crear y cambiar un permiso, crear y
cambiar una escolta— la reabren por un solo sitio, `reabrirCompuerta()`. Cuatro
copias del mismo `update` es exactamente cómo se llegó al segundo agujero: una
se quedó sin escribir. Hay un guardián que cuenta las cuatro llamadas y exige
que solo el ayudante toque la columna.

## La página vuelve a prometerlo

Ahora es verdad, así que la frase vuelve — en los dos idiomas, y con el mismo
matiz que el resto de la página: se habla de una carga **marcada** como
sobredimensionada, porque la puerta solo se abre para esas.

El guardián que el lote anterior dejó puesto hizo su trabajo: se negó a dejar
pasar la frase hasta que existiera la puerta, y al construirla hubo que
apuntarlo al sitio donde de verdad se decide —`Papers`— y no donde se obedece
—`Guards`—.

## Comprobado en el navegador

Con una carga sobredimensionada, su evaluación validada y una escolta en
`pending`, al pulsar «Aprobar permisos listos»:

```
es  La escolta de TX sigue pendiente. Una carga sobredimensionada no sale con
    una escolta sin confirmar.
en  The TX escort is still pending. An oversize load does not leave with an
    unconfirmed escort.
```

La compuerta se queda cerrada.

## Lo que NO se toca

- Que la evaluación obligue a crear filas de escolta. Hoy es orientación.
- El resto de la lista de la auditoría pública: FMCSA al aprobar, el cotejo real
  del VIN con el COI, reglas de sobredimensión por estado, marca de agua.

## Guardianes

`tests/Unit/Suite/EscortGateTest.php` (7) y
`tests/Feature/Oversize/EscortGateTest.php` (7). **10 sabotajes, 10 cazados**,
incluidos hacer que `pending` cuente como resuelta, que una cancelada pida
papel, y que la página prometa la puerta mientras la puerta se va.
