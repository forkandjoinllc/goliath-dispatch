# El doble turno que nadie comprobaba

## El defecto

La página pública de Servicios decía —y la lee quien todavía no ha comprado:

> La asignación se verifica automáticamente contra el cumplimiento normativo —
> un camión, remolque o conductor con un documento vencido, **o un conflicto de
> horario**, no puede asignarse a una carga.

Lo del documento vencido es verdad y lo comprueba
`LoadAssignmentController::checkResource()`.

Lo del horario **no existía**. En todo el producto no había una sola consulta
que comparase las asignaciones de un recurso contra las ventanas de otra carga.
Se podía poner al mismo conductor en dos cargas que se solapan y nadie decía
nada.

## Lo que ya estaba preparado

`load_assignments` tiene `committed_from` y `committed_to` desde el esquema
original. Están en el modelo, casteadas a fecha, y **nadie las escribe ni las
lee**. La tabla se diseñó para esto y se quedó a medias.

No se rellenan en este lote: una columna que nadie lee es la trampa que este
mismo barrido acaba de quitar de `carrier_onboardings.checklist`. El solape se
calcula de las ventanas vivas de las paradas, que es lo que contesta la pregunta
de verdad —«¿puede estar en los dos sitios?»— y no lo que se pactó hace un mes.
Las dos columnas quedan nombradas aquí como deuda.

## Qué es «pisarse»

La ventana de una carga va del `window_start` más temprano de sus paradas al
`window_end` más tardío. Si una parada no tiene fin, se toma su propio inicio:
una cita sin ventana de cierre no es una cita que dure para siempre.

Dos cargas se pisan si sus ventanas se tocan, **extremos incluidos**: terminar a
las 12:00 y empezar a las 12:00 el mismo día es estar en dos sitios a la vez.

Una carga sin ninguna ventana escrita no se pisa con nada. Sin fechas no hay
conflicto que afirmar, y avisar «quizá» de todo convierte el aviso en ruido, que
es como se acaba desactivando.

Las cargas cerradas —`OpenWork::CARGAS_CERRADAS`, pagada y cancelada— no ocupan
a nadie. Se usa esa constante y no una lista nueva para que «cerrada» signifique
lo mismo en todo el producto.

## Avisa; no bloquea

Un documento vencido es una puerta: la ley dice que ese camión no sale. Un
solape es un problema de agenda, y la agenda la lleva quien despacha — una
recogida a las 8 y otra a las 18 en la misma ciudad se pisan por ventana y
pueden ser perfectamente posibles.

Es el criterio que la pantalla de asignación ya tenía escrito para los
requisitos de la carga: «NO descartan a nadie, se enseñan aparte y decide quien
despacha». Endurecerlo a bloqueo es una decisión de negocio con consecuencias en
la operación del día, igual que la revalidación de FMCSA.

Lo que sí se hace es **decirlo antes de asignar, con el número de la otra
carga**, para que la decisión se tome sabiendo.

Y por eso la página de Servicios cambia: ya no dice que un solape impida
asignar; dice que se avisa.

## Una consulta por tipo, no una por opción

Veinte conductores en el desplegable serían veinte consultas, y esto se calcula
cada vez que alguien abre la ficha de una carga. `byResource()` devuelve el mapa
entero de un tipo de recurso de una sola consulta. Hay un guardián que lo
cuenta.

## Comprobado en el navegador

Con un conductor ya asignado a GD-24003 (8:00–…) y una carga nueva de 10:00 a
20:00 del mismo día:

```
es  opción: «Eduardo Salas — se pisa con otra»
    aviso:  Ya está en la carga GD-24003, que se pisa con esta ventana.
            No se impide asignarlo; decide usted.
en  opción: «Eduardo Salas — overlaps another»
    aviso:  Already on load GD-24003, which overlaps this window.
            This does not stop the assignment; it is your call.

botón «Conductor»: habilitado
```

El botón sigue activo: el aviso no impide.

## Lo que NO se toca

- El bloqueo por documento vencido sigue igual.
- `committed_from` / `committed_to` siguen sin usarse. Quedan nombradas.
- No se avisa de solapes ya existentes: esto mira el momento de asignar. Un
  barrido que revisara la agenda entera cada noche es otro lote.

## Guardianes

`tests/Unit/Suite/ScheduleConflictTest.php` (8) y
`tests/Feature/Loads/ScheduleConflictTest.php` (10). **14 sabotajes, 14
cazados**, incluidos invertir la comparación de ventanas, hacer que una parada
sin cierre dure para siempre, y apagar el botón de asignar cuando hay
solape — que convertiría el aviso en el bloqueo que el texto público ya no
promete.
