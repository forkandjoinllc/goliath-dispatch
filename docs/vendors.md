# Proveedores

Quién le cobra a un transportista: la arrendadora del camión, el taller, la
aseguradora, el proveedor de combustible. Vive en **Finanzas**, encima de los
gastos, porque lo que se hace con un proveedor es pagarle — y porque de un
proveedor sale un gasto, y de un gasto sale un pago.

## Qué pregunta vino a contestar

`trucks.lessor_name` y `trailers.lessor_name` son **texto libre** desde el
primer día. Quien da de alta una unidad arrendada escribe el nombre de la
arrendadora a mano, y la siguiente unidad lo escribe otra vez — con una coma de
más, con «LLC» o sin él. El resultado es que **«¿qué unidades me arrienda esta
empresa?» no tiene respuesta**, «¿a quién llamo cuando vence el contrato?»
tampoco, y el mismo proveedor está escrito de tres formas en la misma flota.

La ficha es esa respuesta: con sus contactos, sus condiciones de pago, a qué
transportistas sirve, qué unidades le arrienda y qué gastos se le han imputado.

## De la empresa, no del transportista

Una arrendadora que trabaja con tres transportistas es **una** ficha, no tres.
A quién sirve se anota aparte, en `vendor_carriers`. Con una ficha por
transportista, sus contactos y sus datos fiscales se duplicarían con ella, y al
cambiar un teléfono habría que acordarse de cambiarlo en tres sitios.

Es lo mismo que ya hace `driver_carrier_relationships` con los conductores, y
por el mismo motivo. De ahí sale también el alcance: un usuario transportista ve
los proveedores que le sirven a **él** y no los de sus competidores, que
estarían en la misma pantalla. Como un proveedor no tiene columna de
transportista, el alcance es un `EXISTS` y no un `WHERE` — igual que
`DriverScope`, y por eso hay `Vendors\VendorScope`.

Fuera de alcance da **404 y no 403**: un 403 confirmaría que ese proveedor
existe en esta empresa, y con eso se enumeran las fichas de una en una.

## El nombre tecleado no se tira

La unidad **gana** una columna —`lessor_vendor_id`— y `lessor_name` se queda
donde está. Mientras la unidad no apunte a ninguna ficha, la pantalla enseña el
nombre escrito **diciendo que no tiene ficha**, con el desplegable al lado para
enlazarlo.

Vaciar esa columna al añadir la nueva habría borrado en silencio el único dato
que hoy existe sobre el arrendador de cada unidad, a cambio de nada. Y
sustituir el campo por un desplegable vacío habría sido peor que borrarlo:
parece que no había nada.

La siembra de demostración deja **una unidad a propósito sin ficha**. Es el
estado en el que va a estar cualquier flota el día que estrene esta pantalla, y
una siembra que solo produce el caso bonito garantiza que nadie vea el otro
hasta que un cliente se lo encuentre.

Al pasar una unidad a **propia**, se sueltan las dos: el nombre y la ficha. Es
la regla que ya existía para el nombre — dejar el enlace puesto dejaría un dato
que contradice al de al lado.

## Las fichas de proveedor nacen en un solo sitio

Si al dar de alta una unidad falta la arrendadora, se crea en Finanzas →
Proveedores. La pantalla del equipo **no** crea fichas: dos sitios donde nace
una son dos sitios donde olvidarse del W-9 y de los contactos, y el segundo
siempre es el que se olvida.

Y la unidad solo elige entre proveedores de tipo **arrendamiento** y activos.
Ofrecer un taller como arrendador de un camión es ofrecer un dato que después
nadie sabe leer.

## El identificador fiscal no vuelve

Se guarda **cifrado** y solo viajan los cuatro últimos — la misma forma que
`customers`, que tenía las columnas y no las escribía nadie. A la pantalla no
llega el valor entero en ningún momento, y el modelo lo lleva en `hidden` para
que no salga por la puerta de atrás si alguien serializa la fila.

Por eso el campo del formulario sale **siempre en blanco**, también al editar:
no hay nada que devolverle. Dejarlo en blanco **conserva** el que hay —el
servidor solo escribe esa columna si la clave viene— y escribir algo lo
reemplaza; una cadena vacía lo borra, que es cómo se quita. Al lado se dice
cuál está guardado, porque un campo en blanco sin más se lee como «no hay
ninguno».

De la cuenta bancaria solo se guardan los **cuatro últimos**. El número entero
no hace falta para reconocer un pago en un extracto, y guardarlo convertiría
esta tabla en algo que hay que proteger de otra manera.

## Lo que la base impone

- El **tipo** y el **estado**, contra una lista. La del tipo se reconstruye
  desde `VendorType::values()`: escrita a mano, la base y el desplegable se
  separan el día que alguien añada un tipo — la lección del lote 38 con las
  acciones de auditoría.
- **Un solo contacto principal** por proveedor, con la misma columna generada
  que usa `customer_contacts`. Y el controlador decide cuál es —el primero de
  la lista, siempre— porque si la pantalla dejara marcar dos, el guardado
  fallaría con un error de SQL que nadie sabe leer.
- **Un proveedor no se ata dos veces** al mismo transportista mientras la
  relación esté viva.
- **La fecha del W-9 solo existe si hay W-9.** «No tenemos su W-9, recibido el
  3 de marzo» es una fila que se lee de dos formas y ninguna es verdad.

## Nada se ata a otra empresa

Tres puertas aceptan un identificador que llega de fuera: el arrendador de una
unidad, el proveedor de un gasto, y el transportista al que se ata un proveedor.
Las tres lo comprueban. `size:36` y `uuid` dejan pasar el identificador de otra
empresa — el ámbito global impide **leerlo**, no impide escribirlo—, y sin la
comprobación la ficha enseñaría el nombre de una empresa ajena a quien pegara un
identificador en la petición.

## Retirar un proveedor

Borrado suave, y con puerta: si hay **unidades apuntando a él** o **gastos
imputados**, no se retira, y se dice cuántos de cada. No es integridad
referencial —las columnas son nulas y la base lo dejaría— sino lectura: un gasto
cuyo proveedor desapareció es un gasto que ya no se puede explicar, y la unidad
se quedaría con un arrendador que no existe.

Es la misma forma que `FactoringController`, no la de `OpenWork`: aquí la
pregunta no es si queda trabajo abierto, sino si algo lo **nombra** — un gasto
cerrado del año pasado sigue teniendo que poder explicarse.

## Quién puede qué

| | leer | crear | editar | retirar |
|---|---|---|---|---|
| Administración | sí | sí | sí | sí |
| Contabilidad | sí | sí | sí | **no** |
| Transportista | solo los suyos | no | no | no |

Contabilidad da de alta proveedores y les pone las condiciones de pago —es quien
les paga— pero no los retira: un proveedor con gastos detrás lo retira quien
administra.

## Lo que hay que hacer en el servidor

`php artisan migrate`. Nada más.
