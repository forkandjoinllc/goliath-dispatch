# Las tarjetas que no llevaban a su propio número

## El defecto

El subtítulo de la pantalla de inicio se lo promete al usuario, con todas las
letras:

> Todo lo de abajo es un recuento real. Púlselo y va a la lista de donde salió.

Y la cabecera de `Dashboard\Panel` lo pone como primera de sus tres reglas, con
el énfasis de quien la escribió:

> **Cada tarjeta es una pregunta que alguien se hace, y al pulsarla lleva a la
> lista que la contesta.** Un número sobre el que no se puede actuar es
> decoración. Por eso ninguna tarjeta existe sin su `href`, y ese `href` apunta
> a la pantalla **YA FILTRADA**.

Tres de las once no lo cumplían. Cada una a su manera, y las tres desde el lote
que creó el panel.

### 1. Prospectos: la tarjeta contaba dos mitades y el filtro miraba una

```php
// la tarjeta
->whereNull('assigned_to_user_id')
->whereNotIn('status', ['converted', 'lost'])

// el filtro de la lista, en `?assigned=unassigned`
->whereNull('assigned_to_user_id');
```

Un prospecto convertido o perdido que nunca tuvo responsable aparecía en la
lista y no en el número. La tarjeta decía cuatro, se pulsaba, y la lista
enseñaba nueve — sin decir por qué.

Lo curioso es que la suite ya comprobaba que **la tarjeta** dejaba fuera los
cerrados. Nadie había comprobado lo mismo del otro lado del enlace.

### 2. FMCSA: el destino no sabía expresar la pregunta

`carriersFmcsaStale` enlazaba a `/carriers`, a secas. No era un parámetro
olvidado: **la lista de transportistas no tenía ningún filtro capaz de
contestar esa pregunta.** Su filtro de FMCSA mira el *estado* de la última
comprobación —verificado, sin empezar, no encontrado— y la tarjeta mira su
*antigüedad*. Un transportista verificado hace dos años sale «verificado» en
aquel filtro y es exactamente el que la tarjeta está contando.

Así que la tarjeta decía «2» y llevaba a una lista de siete, sin forma de saber
cuáles eran los dos.

Y la consulta estaba escrita **tres veces**: en el barrido nocturno
(`Fmcsa\Revalidation::due()`), en la tarjeta, y en ninguna parte de la lista —
que era el único sitio donde hacía falta.

### 3. Sin facturar: el número y las filas no hablaban de lo mismo

`loadsUninvoiced` contaba **cargas** y enlazaba a `/invoices/create`, que enseña
**transportistas**. La etiqueta es «Entregadas y sin facturar» y el número es de
cargas; al pulsar salían tres filas de empresas. No se contradicen exactamente:
es peor, porque ni siquiera son comparables.

## Lo que hace ahora

### `Panel::DESTINOS`, todos juntos

Los once destinos vivían dentro de sus once constructores. Con once literales
repartidos por un fichero de cuatrocientas líneas, comprobar la regla de la
cabecera obligaba a leer once métodos — y por eso nadie la comprobó en once
lotes. Ahora están en una constante, y `cards()` es el único sitio que pone un
`href`.

Eso es lo que hace posible la prueba de abajo, que es lo que de verdad arregla
el problema.

### Cada consulta, una sola vez

| Pregunta | Dónde vive | Quién la usa |
|---|---|---|
| ¿A quién toca revalidar? | `Fmcsa\Revalidation::apply()` | el barrido nocturno, la tarjeta, el filtro `?revalidation=due` |
| ¿Qué prospecto es trabajo pendiente? | `LeadController::applyUnassigned()` | la tarjeta y el filtro `?assigned=unassigned` |
| ¿Qué carga está sin facturar? | `Billable::apply()` | la tarjeta, la pantalla de alta de factura y el filtro `?uninvoiced=1` |

`Billable` ya tenía esta doctrina escrita en su propia cabecera —«son dos sitios
que tienen que dar el MISMO número, y el día que difieran, el panel dirá que hay
tres cargas por facturar y la pantalla de alta ofrecerá dos»— y aun así su
`query()` llevaba el `whereIn` suelto, imposible de reutilizar desde una consulta
que ya existiera. La mitad de una regla extraída es la mitad de una regla
copiada.

### Dos filtros nuevos, visibles

- **Transportistas** gana «Revalidación → Toca revalidar», su propio control al
  lado del de FMCSA. **No es una opción más de aquel**: son dos preguntas
  distintas y juntarlas volvería a esconder la de la antigüedad detrás de un
  estado.
- **Cargas** gana `?uninvoiced=1`. No lleva control propio —se llega desde la
  tarjeta— pero sí un aviso visible cuando está puesto: quien aterriza en una
  lista recortada y no sabe que lo está tiene el mismo problema por el otro
  lado.

### El alias, explícito

`apply()` pide el alias de la tabla (`c` en el panel, `carriers` en la lista)
en vez de darlo por hecho. Si no coincide, **MySQL no avisa**: resuelve la
columna contra la tabla que encuentre y devuelve filas de más. Hay un sabotaje
dedicado a eso.

## La prueba que convierte la regla en algo comprobable

`tests/Feature/Dashboard/CardDestinationTest.php` recorre las once tarjetas,
pide cada destino y compara su total con la cuenta:

```php
foreach ($tarjetas as $clave => $tarjeta) {
    expect(filasDelDestino($tarjeta['href']))->toBe($tarjeta['count']);
}
```

Con **datos que distinguen**, que es la mitad que importa: un prospecto perdido
sin dueño, un transportista comprobado hoy junto a otro nunca comprobado, y una
carga entregada **ya facturada** al lado de una sin facturar. Sin eso, dos
consultas distintas dan el mismo número por casualidad y la prueba pasa con el
defecto puesto.

El total se busca dentro de los props en vez de mapear pantalla a clave a mano:
un mapa a mano es otra lista que puede quedarse vieja, y lo que aquí se mide es
precisamente que dos cosas no se queden viejas la una respecto de la otra.

## Una prueba anterior fijaba el defecto

`LeadTest::filtra por estado, origen y sin asignar` esperaba encontrar
`PERDIDA SA` —un prospecto perdido y sin responsable— en
`/leads?assigned=unassigned`. Estaba fijando la semántica equivocada: `unassigned`
es una **cola de trabajo**, no «sin dueño» a secas.

Se corrigió con su motivo escrito al lado, no dando la vuelta a la aserción en
silencio. Una prueba que documenta el defecto es la forma más cara de tenerlo.

## Verificación

- **18 sabotajes, 18 cazados.** Los tres primeros reponen los tres defectos
  originales, uno a uno, y los tres tumban la prueba de funcionalidad — no solo
  la estructural.
- Suite completa en verde dos veces: **1818** pruebas, 10.799 aserciones.
- `tsc` limpio; `pint` limpio sobre los ficheros del lote (`Revalidation.php`,
  `CarrierController.php` y `LeadTest.php` conservan su deuda anterior, medida
  contra `git show HEAD:` — pint quería reescribir líneas que este lote no
  toca, y se revirtieron).
- Recorrido por el navegador en los dos idiomas: las once tarjetas contra sus
  once destinos sobre los datos de demostración, y otra vez tras plantar filas
  que distinguen. Las tres arregladas, contra su lista sin filtrar:

  | Destino | con filtro | sin filtro |
  |---|---|---|
  | `/leads?assigned=unassigned` | 1 | 2 |
  | `/carriers?revalidation=due` | 2 | 7 |
  | `/loads?uninvoiced=1` | 1 | 12 |

## Lo que esto NO es

- **No cambia ningún recuento.** Las once tarjetas cuentan hoy lo mismo que
  ayer; lo que cambia es a dónde llevan. La excepción es el filtro
  `?assigned=unassigned` de la lista de prospectos, que ahora enseña menos
  filas — las que nunca fueron trabajo pendiente.
- **No hay control visible para `?uninvoiced=1`.** Se llega desde la tarjeta y
  el aviso lo dice; ponerle un selector propio en la barra de filtros es otra
  decisión, de diseño y no de honestidad.
- **La pantalla de alta de factura sigue enseñando transportistas**, y está
  bien: es donde se actúa. Lo que cambió es que la tarjeta ya no promete que
  ahí están las cargas que contó.
- **Esto no comprueba que un recuento sea el correcto**, solo que la lista dice
  lo mismo. Si una tarjeta cuenta mal, contará mal en los dos sitios y esta
  prueba pasará. Para eso están las pruebas de cada tarjeta, que ya existían.
