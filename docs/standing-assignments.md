# El equipo habitual: terminar, cancelar y corregir

## Lo que hacía el botón de terminar

Ponía `ends_on` a **hoy**. Y `ends_on` es el último día en que la asignación
**vale**, así que seguía vigente:

- la ficha seguía diciendo «en vigor»,
- el aviso decía «asignación terminada»,
- y el relevo no podía coger el camión hasta el día siguiente, porque el
  solapamiento lo rechazaba.

Tres pantallas diciendo cosas distintas sobre un clic que, para todo lo que
lee la tabla, no había hecho nada.

Lo más incómodo: `StandingAssignment::terminarVigentes()` —en la misma clase,
cuatro métodos más abajo, la que se usa al dar de baja a alguien— ya contaba
desde **ayer**, y lo explicaba en su propio comentario. Dos maneras de terminar
lo mismo en la misma clase, una cierta, y el guardián sujetaba la otra: la
prueba comprobaba literalmente `'ends_on' => max($hoy, $inicio)`, que era el
defecto escrito.

**Un guardián que copia la línea en vez de medir la propiedad sujeta el defecto
con la misma fuerza que sujetaría el arreglo.**

## Lo que hace ahora

`terminar()` cuenta desde ayer, con suelo en el día de comienzo —la restricción
`chk_standing_dates` no admite terminar antes de empezar— y **devuelve el día**
en vez de un sí, porque una de cada tantas veces no es ayer.

El aviso dice cuál de las dos cosas ha pasado:

| Caso | Lo que dice |
|---|---|
| Terminó ayer | «El camión queda libre desde hoy.» |
| Empezó hoy | «Empezó hoy, así que vale el resto del día y el camión queda libre mañana.» |

Con palabras y no con una fecha: esa capa no sabe escribir un día en el idioma
de quien mira —`formatDay` vive en la pantalla— y una fecha en bruto dentro de
una frase traducida se lee como un error.

### Lo que ya terminó no se resucita

Sin esa comprobación, pulsar «Terminar» sobre una asignación de marzo le movería
el fin a ayer y la dejaría vigente cinco meses después de acabar: cinco meses de
historia cambiados por un clic que parecía no hacer nada.

## Cancelar no es terminar

Una asignación que empieza el lunes que viene no tiene nada que contar de marzo.
Terminarla la dejaría escrita como un tramo de un día en el futuro —un camión
ocupado el lunes por un conductor que nunca lo cogió—, y esa es la clase de fila
que luego nadie sabe explicar.

- **Vigente** → se termina. Queda escrito: una carga de marzo se mira con el
  camión que se llevó en marzo.
- **Empieza más adelante** → se cancela, en blando. No hay historia que
  conservar.
- Lo que ya empezó **no** se cancela nunca.

## Tres montones y no dos

La ficha tenía «vigente» y «antes», y una asignación que empieza el lunes que
viene caía bajo el título **Antes**. Lo que no ha empezado no es historia, y la
diferencia se nota en el botón. Ahora hay **vigente**, **empieza más adelante**
y **antes**, y las que vienen se ordenan de la más próxima a la más lejana —la
consulta las trae de nueva a vieja, que para lo que aún no ha pasado es del
revés.

## Corregir

Antes solo se podía crear y terminar. Quien se equivocaba de remolque —o
escribía mal el día de comienzo— no tenía arreglo: terminaba la asignación y
creaba otra, y la ficha quedaba con **dos tramos donde solo hubo uno**.
Corregir un dato no es un cambio de equipo.

`StandingAssignment::choques()` sabía excluir una fila —el parámetro
`$exceptoId` llevaba escrito desde que nació— y **nadie lo usaba nunca**. Sin
él, cambiarle la nota a una asignación chocaría consigo misma y diría que ese
camión ya está ocupado: por ella.

### El camión propio en la lista propia

La lista de camiones esconde los que ya lleva otro conductor —ofrecer algo que
la regla va a rechazar es hacer perder el viaje— y escondía también **el de
este conductor**. Mientras solo se podía dar de alta daba igual: en un alta el
suyo no es ninguno.

Al poder corregir, la casilla del camión nacía **vacía**: el valor estaba puesto
y la lista no lo contenía. Y el camión es obligatorio, así que quien fuera a
cambiar la nota tenía que volver a elegir camión, y el que le ofrecía la lista
no era el suyo.

La exclusión es de **otro** conductor, no de cualquiera.

## La nota

Viajaba en el formulario, el servidor la validaba y la guardaba, y la ficha la
devolvía a la pantalla. No había casilla donde escribirla ni sitio donde leerla:
una columna que nadie podía usar. Ahora se escribe y se lee.

---

Ver también: [combo-spacings.md](combo-spacings.md) · [testing.md](testing.md)
