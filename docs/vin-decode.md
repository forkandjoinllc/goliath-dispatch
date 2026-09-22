# El alta de un camión: buscar el transportista y leer el VIN

Dos cosas pedidas sobre el formulario de alta de equipo, que es el mismo para
camiones y remolques.

## 1. El transportista se busca escribiendo

Era un desplegable. Un desplegable deja de servir alrededor de los treinta
elementos y es hostil a los doscientos: quien da de alta un camión no quiere
recorrer la lista, quiere escribir tres letras.

Se reutiliza `SearchableSelect`, el mismo componente que el alta de conductores
—dos comboboxes escritos por separado acaban comportándose distinto, y el
segundo siempre peor—. Para que sirviera a un campo de UN valor se le añadieron
tres cosas: enseñar lo elegido con un botón de cambiar, marcar el campo como
obligatorio y pintar el error de validación. La forma de la pantalla la fija un
guardián: el día que alguien lo devuelva a un `<select>`, la suite lo dice.

## 2. El VIN rellena marca, modelo y año

En cuanto el número está completo —17 caracteres— la pantalla pregunta al
servidor y rellena **solo los campos que estén en blanco**. Lo que la persona ya
escribió no se toca nunca: en equipos viejos el dato del fabricante y el de la
placa no siempre coinciden, y quien corrigió uno a mano tenía una razón. Debajo
del campo se dice qué se rellenó y de dónde salió, con un enlace para
deshacerlo.

### Qué se puede leer del propio número, y qué no

Un VIN no es una cadena opaca: tres partes suyas están normalizadas.

| Dónde | Qué dice | ¿Se puede leer sin salir a internet? |
|---|---|---|
| posiciones 1-3 (WMI) | quién lo fabricó | **sí**, con una tabla |
| posición 9 | un dígito de control | **sí**, se calcula |
| posición 10 | el año del modelo | **sí**, con una tabla de 30 valores |
| posiciones 4-8 (VDS) | **el modelo** | **no**: cada fabricante las define a su manera |

Por eso el modelo es la única de las tres que necesita una fuente externa, y por
eso el campo se queda en blanco cuando no la hay — en vez de inventarse algo.

### El dígito de control es la puerta

Antes de decodificar nada se comprueba que el número cuadre. Rellenar marca y
año de un VIN mal copiado es **peor** que no rellenar nada: sale un vehículo
verosímil que no es el que la persona tiene delante. Cuando la forma es buena y
el dígito no cuadra se dice con esas palabras —«compruébelo contra la placa»—,
que es distinto de «esto no es un VIN».

### Dos adaptadores y una cadena

`VinDecoder` es una interfaz, como el cobro y el FMCSA. Se atan dos:

1. **`NhtsaVinDecoder`** — vPIC, la base oficial de EE. UU. Es la única que sabe
   el modelo. No pide credencial: pide **salida a internet**, y por eso se
   enciende con `NHTSA_VIN_ENABLED` y no con una clave.
2. **`OfflineVinDecoder`** — el año y la marca, leídos del propio número.

`ChainVinDecoder` los pone en ese orden y el segundo **tapa huecos sin pisar**:
con la NHTSA caída, o en una instalación sin salida, el formulario sigue
rellenando dos de los tres campos. La diferencia entre una ayuda que a veces no
está y un campo que unos días funciona y otros no.

Y no se le atribuye a la NHTSA lo que la NHTSA no contestó: vPIC responde 200
con los campos vacíos cuando no conoce un número, y eso no cuenta como
respuesta. La pantalla dice «a partir del propio VIN» o «a partir del VIN y de
la base de la NHTSA» según lo que de verdad pasó.

### La tabla de fabricantes es corta a propósito

`Wmi::FABRICANTES` tiene los fabricantes de camión y remolque que de verdad
aparecen en una flota de despacho de EE. UU., y ni uno más. **Una entrada
equivocada rellena «Marca» con un fabricante que no es**, y eso es peor que
dejar el campo vacío, porque quien lo lee da por hecho que lo comprobó alguien.
Lo que no está se deja en blanco. Añadir una entrada es barato y es la forma
prevista de que crezca; lo que no se puede es añadirla sin estar seguro.

## Lo que hay que hacer en el servidor

En el `.env` de Forge, cuando quieras el modelo:

```
NHTSA_VIN_ENABLED=true
```

Nada más: no hay credencial que pedir. Lo único que hace falta es que el
servidor pueda salir a `vpic.nhtsa.dot.gov`.

### Advertencia honesta

El adaptador de la NHTSA **no se ha ejecutado nunca contra el servicio real**
desde este proyecto: el contenedor donde se escribió tiene bloqueada la salida a
ese dominio. Lo que sus pruebas demuestran es el **mapeo** —qué se hace con la
respuesta— con `Http::fake()`, no el contrato del proveedor. La primera consulta
de verdad puede exigir ajustar `mapear()`. El camino del respaldo sí está
recorrido de punta a punta, incluido el paseo por la demostración.

## Y la demostración, que escondía todo esto

Los doce VIN sembrados no pasaban el dígito de control. Ninguno. Así que en la
demostración el formulario **no rellenaba nunca** marca ni año: la pantalla
entera de este trabajo era invisible. Ahora son VIN inventados pero bien
formados —con el WMI del fabricante que dice cada fila y el código de año de su
año—, y un invariante de `DemoInvariantsTest` lo vigila.

Dos remolques conservan a propósito un WMI que la tabla corta no conoce —Trail
King y Landoll—, para que la demostración enseñe también el caso de «esto no lo
sé decir sin salir a internet».
