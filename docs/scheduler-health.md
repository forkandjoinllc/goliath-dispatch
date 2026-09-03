# Saber si el planificador está vivo

`routes/console.php` lleva desde el lote de avisos un comentario que dice, con
todas las letras, que sin una línea de cron en el servidor ese fichero no se
ejecuta nunca **«y no lo dice nadie»**.

Lo primero ya estaba resuelto: `ScheduledRuns` escribe una fila por ejecución en
`job_queue`, y la pantalla de salud de la plataforma las enseña. Lo que faltaba
era lo segundo.

## Lo que había

Una tarea que corrió bien el 14 de agosto y a la que se le rompió el cron seguía
saliendo el 3 de septiembre con la insignia **verde** de «correcta» y la fecha
vieja al lado. La pantalla enseñaba las dos piezas del problema y dejaba que el
lector las juntara. Casi nadie las junta.

Mientras tanto `notifications:sweep` es lo que escribe los avisos de documentos
por vencer, las facturas vencidas, la revalidación de FMCSA fuera de plazo y el
fin de la prueba de la suscripción. Todo eso deja de salir en silencio.

Y había un segundo agujero encima. La lista de tareas vigiladas era una copia a
mano:

    private const TAREAS = ['notifications:sweep', 'retention:sweep'];

Dos listas que tienen que coincidir y que nada obligaba a coincidir. Un
`Schedule::command()` nuevo corría en el servidor y no aparecía en ninguna
pantalla: **la pantalla que existe para vigilar lo que corre solo no vigilaba lo
que no le hubieran contado.**

## Lo que hay

`App\Support\Platform\ScheduledTasks::all()` le pregunta al planificador de
Laravel qué hay programado, y devuelve cada tarea con su expresión de cron. El
nombre del comando se cruza con los comandos registrados (`Artisan::all()`)
porque `Event::$command` no es el nombre: es la línea entera que va a
ejecutarse, binario de PHP incluido, y sacarlo con una expresión regular
funciona hasta que cambia el formato.

### El estado se calcula, no se lee

`ScheduledRuns::summary()` devuelve un `state` que no es el `status` de la fila:

| Estado | Cuándo |
| --- | --- |
| `neverRan` | No hay ni una ejecución. |
| `failed` | La última lanzó. |
| `stalled` | Empezó y no terminó: más de **6 horas** en `running` con `completed_at` nulo. |
| `late` | La última acabó bien, y su propio cron dice que tendría que haber vuelto a correr hace más de **1 hora**. |
| `running` | Empezó hace poco. |
| `ok` | Todo lo demás. |

El orden importa y es deliberado: una tarea que falló **y** va con retraso es un
fallo, que es lo que hay que arreglar primero. Y una colgada se mira antes que
el retraso porque lo explica.

El plazo sale de **la expresión de cron de cada tarea**, no de un número escrito
al lado. Con un plazo fijo, la semanal saldría con retraso cada martes.

Y si la expresión no se entiende, `nextAfter()` devuelve nulo y la tarea **no**
sale con retraso. Convertir «no sé» en «va con retraso» es inventarse una alarma
a partir de no saber, que es peor que no dar ninguna.

### El margen de gracia

Una hora. Un barrido diario de las 06:00 mirado a las 06:02 puede estar todavía
corriendo, y llamarlo «con retraso» sería una falsa alarma cada mañana — que es
exactamente cómo se aprende a no mirar una pantalla.

### En la pantalla

Solo `ok` se pinta en verde. `late` y `stalled` en ámbar, `failed` y `neverRan`
en rojo, y las tres alarmantes vuelven a enseñar la línea de cron para pegar en
el servidor — que antes solo salía en «nunca corrió». Cada tarjeta dice además
su cadencia («diaria», «semanal»), deducida de la expresión y no guardada al
lado: una etiqueta escrita junto a un cron es una copia más que se separa.

## Lo que sigue abierto

- **Esto es la pantalla de la plataforma**, con permiso `platform:health:read`.
  Un administrador de empresa no puede ver que sus avisos llevan tres semanas
  sin salir. Discutible: el cron es de la instalación, no de la empresa — pero
  quien sufre el silencio es la empresa.
- **Nadie avisa.** Hay que abrir la pantalla para verlo. Un barrido con retraso
  no manda un correo ni empuja nada: y el correo tendría que salir de algo que
  corra solo, que es justo lo que puede estar roto. Un aviso externo —un ping a
  un servicio de vigilancia al final de cada barrido, y ese servicio avisando
  cuando el ping no llega— es la única forma que no depende de sí misma.
- **El cron sigue haciendo falta.** Esto detecta que no está; no lo pone.

## Guardianes

- `tests/Unit/Suite/SchedulerHealthTest.php` — que la lista no vuelva a estar
  escrita a mano, que el estado se calcule en vez de leerse, que el retraso
  salga del cron de cada tarea, que un cron ilegible no invente una alarma, que
  solo «correcta» se pinte en verde, y que cada estado y cadencia tengan rótulo
  en los dos idiomas.
- `tests/Feature/Platform/SchedulerHealthTest.php` — el caso: una diaria que
  corrió bien hace tres semanas sale con retraso; una semanal no sale con
  retraso al día siguiente; una ejecución que empezó y no terminó sale colgada;
  un fallo pesa más que el retraso; y la que nunca corrió no sale con retraso
  porque no hay desde dónde contar.
