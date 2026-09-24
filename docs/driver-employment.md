# Parar a un conductor, darle de baja, y elegir su equipo al darle de alta

## 1. El equipo, en el alta

Al dar de alta a un conductor se elige ya su camión y su remolque. Las unidades
que se ofrecen son **las del transportista que se acaba de marcar** —no la flota
entera— y, en los camiones, **solo los que no lleva ya otro conductor**.

Lo segundo se decide en el servidor y se dice en la pantalla: un camión que
falta de la lista sin explicación se busca durante un rato. Ofrecerlo y
rechazarlo al guardar sería hacer perder el viaje, porque la regla de «un
camión, un conductor a la vez» lo iba a rechazar igual.

Los remolques se ofrecen todos: en una flota se sueltan y se recogen, y el mismo
remolque pasa por varias manos sin que nadie mienta.

El alta escribe la asignación por el **mismo camino** que la ficha
(`StandingAssignment::crear`), que es el único sitio que escribe en esa tabla.
Si el alta la escribiera por su cuenta, sería la puerta de atrás de una regla que
no tiene red debajo en la base: MySQL no sabe rechazar un solapamiento.

Si el camión elegido se lo quedó otro entre que se abrió el formulario y se
guardó, **el conductor se da de alta igual** —eso era correcto— y se avisa de que
el equipo no se puso. Deshacer un alta correcta por un choque de equipo sería
cambiar un problema pequeño por uno grande.

## 2. En espera y de baja

`drivers.status` tenía cuatro valores y ninguno decía lo que pasa de verdad en
una flota:

- **En espera.** Se le para temporalmente: una investigación abierta, un
  resultado pendiente, un papel que no llega. Vuelve.
- **Dado de baja.** Se acabó.

Van en `status` y no en una columna aparte porque «¿puede este conductor llevar
una carga hoy?» es **una** pregunta. Dos columnas de estado son dos respuestas, y
el día que se contradigan —«dado de baja» y «disponible»— ninguna pantalla sabrá
cuál vale.

### Lo que pasa además de cambiar una palabra

**Se le retira de las cargas VIVAS.** Ni en espera ni de baja se conduce. Sin
esto, la carga seguiría diciendo que tiene conductor mientras el conductor no
puede salir, y quien lo descubriría sería el cliente. De las cargas ya entregadas
no se le quita: eso reescribiría el historial de quién las llevó. Misma regla que
sacar una unidad de servicio.

**La baja suelta su equipo.** Un camión asignado a alguien que ya no trabaja aquí
no se le puede dar a nadie —la regla de «un camión, un conductor» lo impide— y la
flota se queda con un camión fantasma. La asignación se **termina**, no se borra:
una carga de marzo se mira con el camión que se llevó en marzo.

La fecha de fin es **ayer** y no hoy, y la diferencia importa: `ends_on` es el
último día en que la asignación vale, así que terminarla «hoy» la dejaría vigente
hoy y el camión seguiría ocupado la tarde en que alguien intenta dárselo al
relevo.

**En espera NO suelta el equipo.** Es temporal, y el camión sigue siendo el suyo
mientras se resuelve lo que sea.

### La nota, siempre

Al parar, al dar de baja y al volver a activar. Un cambio de situación sin motivo
escrito es una fila que dentro de un año nadie sabe explicar, y estas tres son
justo las que alguien va a tener que explicar — a un seguro, a un abogado, o al
propio conductor. Dos letras no son un motivo: el mínimo es cinco caracteres.

### Y la recontratación se decide en el momento

Al dar de baja hay que elegir: **¿se le volvería a contratar?** Quien firma la
baja es quien lo sabe. Preguntarlo dos años después, cuando vuelva a
presentarse, es preguntárselo a alguien que no estaba.

Volver a activarlo **borra** esa decisión: un «no volver a contratar» colgando de
alguien que está trabajando aquí es una contradicción que alguien leerá como
dato.

Todo el cambio queda en la pista de auditoría con su propia acción,
`driver.employment_changed`, y con el motivo dentro.

## Las cuatro puertas que decidían por su cuenta

Quién puede llevar una carga estaba escrito **cuatro veces** —`Loads\Guards`, la
puerta de asignación, el aviso del selector de conductores y el filtro de la
lista— y las cuatro comparaban contra `'inactive'` a mano.

Mientras hubo un solo estado que bloqueaba, cuatro copias de una comparación no
hacían daño. Al añadir dos, cuatro copias son cuatro sitios donde falta uno: un
conductor dado de baja habría seguido saliendo en el selector de asignación, y la
única señal habría sido alguien preguntando por qué le aparece quien ya no
trabaja aquí.

Ahora lo decide `Support\Drivers\Employment`, que además **dice por qué**: cada
estado que bloquea trae la clave del aviso que lo explica, porque «no está
disponible» a secas manda a buscar el motivo a otra pantalla.

**Fuera de servicio no bloquea**, y es a propósito: es el estado de quien está
fuera de turno, y planificar mañana la carga de quien hoy descansa es lo normal.

## Un solo sitio pinta los estados

Las palabras y los colores de los seis estados vivían en tres pantallas: la lista
de conductores, el tablero de despacho y la ficha. Tres copias de la misma tabla
aguantan mientras nadie añada un estado; el día que entraron dos, las tres eran
tres sitios donde faltaba uno, y el que se quedara corto pinta gris lo que
debería pintar rojo. Ahora es `components/App/DriverStatus.tsx`.

## Lo que hay que hacer en el servidor

`php artisan migrate`. La migración añade los dos estados, las columnas del
motivo y la de recontratación, y reescribe la lista de acciones de auditoría
**desde el enum** —`AuditAction` es la lista de verdad y la restricción de la
base es su copia—. Es reversible.
