# La bitácora que prometía agrupar por petición y nunca agrupaba

## El defecto

`Audit::record()` rellenaba el agrupador de eventos así:

```php
'request_id' => $request?->header('X-Request-Id'),
```

Y **nadie ponía esa cabecera**. No hay middleware que la asigne, ni nada en
`bootstrap/app.php`, ni configuración del servidor que la inyecte. La columna
salía nula siempre. En la base de demostración, de los 33 eventos escritos hasta
este lote, **27 tenían `request_id` nulo** — todos los que existían antes de
arreglarlo.

Lo que eso rompe estaba escrito, en prosa, en la cabecera de
`AuditController::show()` desde el día que se escribió la pantalla:

> Los hermanos son el motivo por el que esta pantalla existe y no basta con la
> lista: una sola acción de una persona —aprobar un gasto, digamos— escribe
> varios eventos, y leerlos sueltos no cuenta lo que pasó.

Ese bloque estaba **siempre vacío**. La ficha de un evento decía «Registrado en
la misma acción» y debajo no había nada, siempre, para todos los eventos de la
historia de la instalación. El buscador de la pista de auditoría dice que busca
por identificador de petición y esa rama del `orWhere` no casaba nunca. Y el
índice `audit_events_request_idx` indexaba una columna que solo contenía nulos.

Tres promesas sobre la misma columna, y la columna vacía.

## Y lo peor no era que faltara

Era **de dónde venía**. `X-Request-Id` la manda el cliente. Si alguien hubiera
puesto delante un proxy que la rellenara —o simplemente la mandara a mano desde
la consola del navegador—, quien hace la petición estaría eligiendo cómo se
agrupan sus propios eventos de auditoría: juntar bajo un mismo acto cosas que no
pasaron juntas, o partir las de un mismo acto mandando una cabecera distinta en
cada llamada.

`audit_events` es de **solo añadir**: los disparadores
`audit_events_no_update` y `audit_events_no_delete` abortan cualquier `UPDATE` o
`DELETE`, venga de donde venga. Un agrupamiento falso no se puede corregir
después. Un dato que
viene de fuera no puede decidir la forma de un registro que no se puede
arreglar.

Así que el defecto tenía dos caras opuestas: hoy la columna no servía para
nada, y el día que alguien la hiciera «funcionar» de la forma obvia —poner la
cabecera en el proxy— serviría para mentir.

## La pieza

`app/Support/Auditing/Correlation.php`:

```php
public const CABECERA_DEL_CLIENTE = 'X-Request-Id';   // la que NO se lee
public static function actual(): string;              // nunca nulo
public static function iniciar(?Request $request = null): string;
public static function forget(): void;                // para las pruebas
```

El identificador se genera **dentro**. La constante existe para nombrar lo que
se descarta: un guardián comprueba que `Audit` no lee esa cabecera, y una
constante con el nombre de lo que se ignora explica más que su ausencia.

`iniciar()` recibe la petición y **no la lee** —`unset($request)`—. Está en la
firma para que, leyendo el middleware, se vea que la petición no aporta el
identificador.

### Una petición, un acto. Una orden de consola, también

El barrido nocturno de retención escribe varios eventos y no es una petición
HTTP. Si esto colgara de la petición, sus eventos quedarían tan sueltos como
estaban los de la pantalla.

Por eso `Correlation` memoriza un identificador **por proceso** y lo genera la
primera vez que alguien pregunta. Una orden de artisan es un proceso y una
ejecución, así que todo lo que escriba un barrido queda junto sin envolver nada
ni tocar los comandos.

### Por qué el middleware lo reinicia

`AssignRequestId` llama a `iniciar()` en cada petición. Con PHP-FPM daría igual
—un proceso es una petición—, pero con un servidor que mantiene la aplicación
viva entre peticiones (Octane) el proceso dura horas: sin reiniciar, las
acciones de gente distinta a lo largo de una tarde quedarían agrupadas bajo un
mismo acto. Eso no sería un hueco: sería un registro que afirma algo falso, en
una tabla que no se puede corregir.

### Va el primero de la pila

```php
$middleware->web(prepend: [AssignRequestId::class]);
```

Cualquier cosa que ocurra después puede escribir en la bitácora: resolver la
empresa, comprobar un permiso, rechazar una validación. Todo eso pertenece al
mismo acto. Un guardián comprueba que sigue estando en `prepend` y no en
`append`.

### Y vuelve en la respuesta

El middleware pone el identificador en la cabecera de la respuesta. Sirve fuera
de la pantalla de auditoría: quien informa de un problema puede dar ese número,
y lleva directo a sus eventos y a las líneas del registro del servidor de esa
misma petición. Es la misma cabecera que se ignora a la entrada — se escribe,
no se lee.

## Lo que se comprueba

`tests/Feature/Audit/CorrelationTest.php` (10) recorre el comportamiento:

- todo evento sale con su agrupador, que es lo que no pasaba;
- los eventos de una petición comparten agrupador, y los de dos peticiones
  distintas no se mezclan;
- **la cabecera que manda el cliente no decide el agrupamiento**, y dos
  peticiones con la misma cabecera del cliente siguen separadas;
- el identificador vuelve en la respuesta;
- la ficha de auditoría enseña por fin los hermanos, y el buscador por
  identificador encuentra algo;
- lo que escribe una orden de consola queda junto, y otra ejecución no se
  mezcla con la anterior.

`tests/Unit/Suite/AuditCorrelationTest.php` (7) fija la forma: que `Audit` no
lea la cabecera, que el identificador nunca sea nulo, que el middleware vaya el
primero, que cada petición empiece un acto nuevo y que el índice
`audit_events_request_idx` deje de indexar una columna vacía.

Los nueve sabotajes de `/tmp/claude-0/sab/sab29.py` mueren: volver a leer la
cabecera del cliente, dejar que el agrupador sea nulo, aceptar el identificador
de la petición, no reiniciar el acto, sacar el middleware del `prepend`, no
devolver la cabecera, y las tres formas de romper la pantalla (no agrupar, no
buscar, enseñarse a sí misma como hermana).

## El paseo bilingüe

Con la demostración en marcha, abrir un hilo de una carga mandando a propósito
`X-Request-Id: FALSIFICADO-POR-EL-CLIENTE`:

```
abrir hilo: POST respondió 302 · identificador que puso el servidor: 98998857-…
¿aceptó el del cliente? no
[es] buscando por el identificador: 2 eventos
[es] ficha: requestId=el mismo · hermanos=1
[es] en pantalla: "PETICIÓN" · "Una sola acción puede dejar varias entradas.
      Estas comparten la misma petición."
[en] en pantalla: "REQUEST" · "One action can leave several entries. These
      share the same request."
```

Las tres parejas de eventos escritas durante el paseo comparten cada una su
identificador; los 27 anteriores siguen con el suyo nulo, que es la marca de
antes y después.

## Lo que este lote NO hace

No rellena hacia atrás los 27 eventos sin agrupador. No se puede: la tabla es de
solo añadir, y además inventarles un agrupamiento sería exactamente el mal que
esta pieza evita. Se quedan nulos, y la pantalla no enseña hermanos para ellos
porque de verdad no se sabe cuáles eran.

Tampoco se propaga el identificador a los registros del servidor (`Log`) como
contexto por defecto; la cabecera de la respuesta ya permite cruzarlos a mano.
