# Las letras de una licencia

`drivers.cdl_class`, `drivers.endorsements` y `drivers.restrictions` están en el
esquema desde el primer día. Lo que faltaba era decir qué significan.

## Lo que había

- **Los endosos**, en el formulario: seis botones cuadrados de 36 píxeles con
  una LETRA dentro — H, N, T, P, X, S. En la ficha: unidos por comas, «H, N, T».
- **La clase**: una letra suelta, «A».
- **Las restricciones**: en ningún sitio. La columna existía, el formulario las
  llevaba en `form.data` y se las devolvía al servidor intactas al guardar, sin
  un solo control para ponerlas ni una línea para verlas. Nadie podía poner una
  restricción desde la aplicación, y nadie podía leer las que hubiera.
- Debajo de los botones, una leyenda apretada explicaba **cinco** de los seis
  endosos: se dejaba fuera la S.
- La validación era `['string', 'max:4']` — o sea, cualquier cadena de cuatro
  caracteres. Se podía guardar `ZZ`.

Quien da de alta a un conductor tenía que saberse la tabla de la FMCSA de
memoria, y quien mira la ficha para decidir si ese conductor puede llevar algo,
también. Un dato de cumplimiento que hay que descifrar no se comprueba: se mira
por encima.

## De dónde salieron los nombres

Del diccionario **portado** `driver.json`, que traía las tres tablas completas y
traducidas a los dos idiomas desde el puerto:

    "endorsements": { "H": "H — Materiales peligrosos", "N": "N — Vehículos cisterna", … }

`tests/Unit/I18n/PortedDictionariesTest.php` existe precisamente para forzar a
leer el portado antes de construir un dominio, y su lista tenía escrito desde
hacía lotes: «drivers → pendiente de repasar contra driver.json». Este lote lo
repasa. Ese apunte está ahora actualizado con lo que se tomó.

Se les quitó el prefijo «H — » al cosecharlas: la letra la pinta el botón y
repetirla dentro de su propia etiqueta la duplicaba en pantalla.

## Lo que hay

`App\Support\Drivers\Cdl` tiene las tres listas, y son la única fuente:

| | |
| --- | --- |
| `CLASES` | A, B, C |
| `ENDOSOS` | H, N, P, S, T, X |
| `RESTRICCIONES` | L, Z, E, O, M, V |

Existe como clase y no como constante suelta porque hay **tres** sitios que
tienen que coincidir: lo que el formulario ofrece, lo que el controlador acepta
y lo que el diccionario sabe nombrar. Estaban en tres sitios distintos —una
constante `ENDORSEMENTS` en el TSX, un `max:4` en la validación, y nada en el
diccionario— y por eso podían discrepar. El comentario de aquella constante
decía «son cinco y no cambian» encima de una lista de seis.

Ahora el controlador manda las tres tablas a la pantalla y valida con
`Rule::in(Cdl::…)`, los botones llevan la letra **y** su nombre (más `title` y
`aria-label` con los dos), la ficha los pinta como etiquetas «H — Materiales
peligrosos», y las restricciones tienen por fin su propio control y su propia
línea.

## Lo que esto NO hace

**No hay ninguna puerta que compruebe los endosos.** `loads` no modela
mercancía peligrosa —no hay columna de hazmat ni nada parecido—, así que no
existe la pregunta «¿este conductor puede llevar ESTA carga?» que un endoso
contestaría. Añadirla sería inventar un dominio entero, y no es lo que este
lote hace: aquí los endosos son dato de cumplimiento legible, no una puerta.

El día que las cargas sepan que llevan material peligroso, la puerta se escribe
en `Guards::forDispatch()` junto a la licencia y la tarjeta médica, y esta
tabla ya estará.

## Lo que sigue abierto

- **El portado `driver.json` describe más de lo que se construyó**: portal del
  conductor, relación con varios transportistas a la vez, revisión manual de la
  licencia con notas del revisor. Queda anotado en `PORTADOS_REVISADOS`.
- **`PortedDictionariesTest` tenía un agujero**, y este lote lo cierra a medias.
  Solo emparejaba `X.json` con `Xs.json`, así que un portado cuyo dominio se
  construyó con otro nombre no se comparaba con nada. `finance.json` —383
  claves, el mayor de los nueve— se repartió en `invoices`, `payments`,
  `settlements`, `commissions`, `expenses` y `factoring`, ninguno de los cuales
  es «finance»+s: **nunca se ha mirado**. Ahora la prueba lo exige por nombre y
  queda apuntado como PENDIENTE, que es lo honesto: apuntarlo no es haberlo
  hecho.
- **Quedan tres portados pendientes de repasar**: `document.json`, `load.json`,
  `customer.json` y `assignment.json`.

## Guardianes

- `tests/Unit/Suite/DriverCodesTest.php` — que cada letra tenga nombre en los
  dos idiomas y que ese nombre no sea la propia letra; que la ficha no vuelva a
  unirlas por comas ni a esconder las restricciones; que la pantalla no vuelva
  a llevar su propia lista; que el servidor valide contra el vocabulario y no
  contra una longitud; y que el sembrador no las deje vacías.
- `tests/Feature/Fleet/DriverCodesTest.php` — que un código inventado se
  rechace, que las restricciones se puedan guardar de verdad, y que las tres
  tablas lleguen a la pantalla desde el servidor.
