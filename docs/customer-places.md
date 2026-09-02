# Los sitios del cliente

## El defecto

`customer_locations` —las instalaciones del cliente: «Gary Component Plant»,
«Bodega Laredo», «Muelle 4»— se **leía en ocho sitios**:

| Dónde | Para qué |
|---|---|
| Ficha del cliente | La lista de sus instalaciones |
| Confirmación de tarifa | El nombre y la dirección que **firma** el transportista |
| Documentos de la carga | La cabecera de cada papel |
| Permisos y escoltas | El recorrido que se evalúa |
| Panel de rastreo (×2) | Las paradas y la simulación |
| Página pública del cliente | Dónde recoge y dónde entrega |
| `StopProgress` | El lugar del suceso de llegada |

Y **no la escribía nadie**. Ni una ruta, ni un formulario, ni un método. Solo el
sembrador del demo.

La otra punta estaba igual: `load_stops.customer_location_id` se validaba y se
guardaba en el servidor, y el formulario de carga **no lo mandaba nunca** porque
no existía el campo. Esa mitad es la que más cuesta ver, porque el código del
servidor parece completo.

En una instalación de verdad la consecuencia es exacta: cero sitios, cada parada
con la dirección tecleada otra vez, y el nombre de la instalación que sale en un
papel firmado es lo que alguien escribió ese día.

## La frontera que no estaba

`customer_location_id` se validaba como «una cadena de 36 caracteres». Nada
comprobaba de quién era el sitio.

Los ocho lectores hacen `leftJoin` con la tabla, así que el navegador podía
apuntar una parada a la instalación de **otro cliente o de otra empresa** y su
nombre y su dirección habrían salido en el papel que firma el transportista y en
la página pública de rastreo. Ahora se comprueba empresa **y** cliente, en el
servidor, en la validación.

No es una comprobación de forma. Es la frontera.

## Qué se copia y qué se referencia

Al elegir un sitio, la dirección **se copia** a la parada y además queda la
referencia.

Las dos cosas, y a propósito:

- La **referencia** es lo que hace que los ocho lectores prefieran la dirección
  de la ficha del cliente, que es la que alguien mantiene al día. Corregir la
  dirección de una planta arregla todas las cargas que la usan.
- La **copia** es lo que hace que una carga entregada hace un año siga diciendo
  a dónde se entregó, aunque el sitio se borre o cambie de dirección.

Por eso los campos de dirección se **bloquean** cuando hay un sitio elegido: los
lectores prefieren la ficha, así que un texto editado a mano por encima no se
vería en ninguna parte. Es la misma regla —y el mismo aviso— que los campos que
vienen del registro de la FMCSA.

El **huso horario** sí se puede cambiar. Una cita puede pactarse en otro huso —un
muelle en la frontera, una planta que trabaja con la hora del cliente— y eso es
una decisión de esa carga, no de la instalación.

## El principal, sin índice que ayude

A diferencia de `customer_contacts`, esta tabla **no** tiene índice único sobre
el principal. La base admitiría dos, así que la regla vive entera en
`syncLocations`: se ponen todos a no-principal y luego el primero de la lista a
principal. El orden de la lista es el dato, no una casilla aparte que pueda
contradecirlo.

## Borrar es en suave, y aquí importa más que de costumbre

`load_stops.customer_location_id` apunta a esta tabla y ocho lectores hacen
`leftJoin`. Un borrado duro dejaría la parada de una carga entregada hace un año
sin el nombre de la instalación donde se entregó — y ese nombre está en un papel
firmado.

## Quién es el del muelle al que va esta carga

`customer_contact_locations` tampoco la escribía nadie. Es la que contesta la
pregunta que de verdad importa al mandar un aviso.

El orden de preferencia del enlace de rastreo queda así:

1. Quien lleva **el sitio donde se entrega**, por cargo dentro de ese grupo
2. Por cargo en toda la empresa (tráfico, muelle, compras)
3. El contacto principal
4. Cualquiera con correo
5. El correo general del cliente

Se mira la **entrega** y no la recogida: el enlace es para quien espera la carga.

Un cliente con cuatro plantas tiene a alguien en cada una, y el que quiere saber
que un camión va de camino a Odessa es el de Odessa. Con la preferencia por cargo
a secas, ese aviso llegaba siempre al mismo sitio, y en un cliente grande casi
nunca al correcto.

Los pasos 2 a 5 siguen ahí porque la mayoría de los clientes no van a atar a
nadie a ningún sitio, y eso tiene que seguir funcionando igual de bien.

## Los vínculos van por índice, no por identificador

El formulario manda `contacts[i].locations` como **índices** de la lista de
sitios del mismo envío, no como identificadores.

Un sitio añadido en ese mismo guardado todavía no tiene identificador, y pedirle
al navegador que lo invente sería darle a él la última palabra sobre a qué fila
apunta una clave foránea. Por eso los sitios se guardan **primero** y el
controlador traduce índice → id.

Quitar un sitio de la lista corre los índices, así que en el mismo gesto se
arreglan los de los contactos. Sin eso, el vínculo se va a otro sitio en
silencio.

## Lo que sigue faltando

- **Coordenadas.** `customer_locations.latitude` y `place_id` existen y siguen
  vacías. El día que haya un proveedor de mapas, este es el sitio natural para
  guardarlas — y es lo que le falta al rastreo para dejar de contar el avance en
  paradas (ver docs/tracking-positions.md).
- **Horarios de verdad.** `hours` es texto libre. Un horario estructurado
  permitiría avisar de que una cita cae fuera de él; hoy solo se enseña.
- **No hay pantalla propia de sitios.** Se editan desde la ficha del cliente,
  como los contactos. Con un cliente de veinte plantas ese formulario se hace
  largo.
