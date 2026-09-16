# Un día del calendario no es un instante

## El defecto

`drivers.license_expires_at` la teclea una persona en un `<input type="date">`.
Lo que escribe es **«10 de octubre de 2026»**: un día, sin hora y sin huso. Se
guarda como `2026-10-10 00:00:00`, el servidor lo mandaba con
`toIso8601String()` —`2026-10-10T00:00:00+00:00`— y la pantalla hacía
`new Date(eso)`, que el navegador lleva a **su** huso.

Con el reloj en Chicago, antes de arreglarlo:

```
/drivers                     9 oct 2026
/drivers/{id}                9 oct 2026
/drivers/{id}/edit           2026-10-10
```

Dos pantallas y un formulario del mismo conductor, sobre el mismo dato, con un
día de diferencia. Y el papel del que hablan es el que permite que un camión
salga a la carretera.

Peor: la insignia «Vence pronto» / «Caducado» **la calcula el servidor** sobre la
fecha de verdad —está bien que así sea, y se ha dejado así— de modo que en la
frontera podía salir pegada a una fecha que ya pasó.

Afectaba a once columnas: la CDL, el certificado médico, la TWIC, el endoso de
materiales peligrosos y la revisión del historial de un conductor; la matrícula,
las dos inspecciones y los dos mantenimientos de un camión o un remolque; y la
caducidad de un documento subido.

## Lo que lo convierte en un descuido y no en una decisión

**La forma correcta ya estaba escrita**, tres ficheros más allá. La pantalla de
Documentos recibe un día suelto y hace:

```tsx
new Date(`${value}T00:00:00`)
```

Con `T00:00:00` y sin huso, la fecha es medianoche **local** y el día no se
mueve. Esa línea existía y no se aplicó en las otras cuatro pantallas.

Y dentro del **mismo método** de `DriverController`, dos de estas columnas
salían con `toDateString()` y dos con `toIso8601String()`, separadas por seis
líneas. La misma clase de dato, mandada de dos formas.

## Por qué el registro de husos no lo cazó

`App\Support\Time\Pending::SIN_CONVERTIR` existe justo para que no se olvide
ninguna hora: declara treinta y seis sitios que todavía salen en UTC, con su
motivo, y un guardián cuenta los de verdad y los compara con la lista.

Cuenta los que salen **en crudo**, con `substr(…, 0, 16)`. Estas columnas no
están ahí porque **no fallaban de esa forma**: salían perfectamente formateadas
en ISO 8601, con su huso y todo. Estar mal de otra manera es lo que las dejó
fuera de la lista que existe para que no se escape nada.

## La cuarta forma de presentar una hora

`Clock` tenía tres, y las tres son correctas para lo que son:

| Forma | Qué es | Ejemplo |
|---|---|---|
| `at()` | un instante, en el huso de quien mira | cuándo se aprobó algo |
| `literal()` | una hora de pared que escribió una persona | la cita del muelle, el permiso emitido a las 08:00 |
| `utc()` | lo que se queda en UTC porque la pantalla pone «UTC» | el certificado de auditoría de una firma |

Faltaba la más simple: **un día no tiene hora que convertir**. `literal()` casi
valía —también dice «no lo muevas»— pero devuelve dieciséis caracteres, o sea
arrastra un `00:00` que no significa nada y que invita a volver a tratarlo como
una hora.

`App\Support\Time\CalendarDates` declara qué columnas son días, con el motivo de
cada una, y `dia()` devuelve diez caracteres. El criterio es uno y se comprueba
mirando el formulario: **si la escribe un `<input type="date">`, es un día**.
Nadie teclea la hora a la que caduca una licencia porque no la tiene.

## Las dos mitades tienen que ir juntas

El servidor manda diez caracteres y el cliente les pega `T00:00:00`. Una sola de
las dos no arregla nada: `new Date('2026-10-10')` sin hora se interpreta como
medianoche **UTC**, así que mandar el día y construir la fecha a pelo vuelve a
correrla.

Por eso el ayudante del cliente vive en `lib/format.ts` y no dentro de cada
pantalla, y por eso son **dos funciones con dos nombres**:

- `formatDay()` — un día. Le pega la medianoche local.
- `formatInstant()` — cuándo pasó algo. Ese sí se convierte.

Las dos se llamaban `day()` y `date()` dentro de cada pantalla, copiadas a mano,
y por eso la mitad trataba un día como si fuera una hora.

## Lo que NO se ha tocado

La insignia de vencimiento se sigue calculando en el servidor, con la fecha de
verdad. La alternativa —compararla en el navegador— pondría el color a merced
del reloj de quien mira, que es el defecto de este lote con otra ropa.

`created_at` y los demás instantes siguen siendo instantes y se siguen
convirtiendo. Un lote que aplana los días y de paso aplana las horas cambia un
defecto por otro; hay un sabotaje que lo comprueba.

## Los guardianes

`tests/Unit/Suite/CalendarDatesTest.php` — 6 comprobaciones: que cada columna
declarada diga por qué, que `dia()` dé diez caracteres venga como venga el valor,
que los dos controladores manden día donde es día **y que las dos formas viejas
no sobrevivan**, que las cuatro pantallas usen las funciones con nombre, que el
ayudante pegue la medianoche local y no elija huso, y que la lista de husos
pendientes no crezca con lo que este lote acaba de convertir.

`tests/Feature/Fleet/CalendarDatesTest.php` — 6 pruebas que piden las pantallas
y miran **la cadena que viaja**: diez caracteres y ni uno más. Es lo único que el
navegador puede volver a mover.

**12 sabotajes, 12 rojos**, sin escapes. Dos merecen mención: el que le pone
`timeZone` al ayudante del cliente —elegir el huso por el que mira es la otra
forma de equivocar la fecha— y el que convierte también `created_at`, que es el
lote pasándose de listo.

Un detalle del guardián: la primera versión se ponía roja **por su propia
explicación**. La comprobación en negativo buscaba `new Date(` en la pantalla, y
el comentario que puse encima del arreglo nombra el defecto —«no un
`new Date(value)` local»—. `Source::compacta()` quita los comentarios de PHP con
`token_get_all()` y no sabe de TSX, así que hay un equivalente pequeño en el
propio guardián.
