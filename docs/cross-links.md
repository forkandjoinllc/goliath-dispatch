# Los enlaces que llevaban a una puerta cerrada

## El defecto

La ficha de una carga pintaba el nombre del cliente como enlace a
`/customers/{id}`. El **transportista** y el **conductor** llegan a esa ficha con
normalidad —los dos tienen `load:read`— y ninguno de los dos tiene
`customer:read`: pulsaban el nombre y aterrizaban en «Acceso denegado».

Cuatro sitios con la misma forma:

| Pantalla | Enlace | Quién cae |
|---|---|---|
| ficha de carga | → cliente | transportista y conductor |
| ficha de carga | → transportista | conductor |
| ficha de conductor | → sus transportistas | conductor |
| ficha de equipo | → transportista | conductor |

## La regla estaba escrita, dos veces

`App\Support\Navigation`, sobre el menú:

> un menú armado en el cliente enseñaría enlaces que el servidor va a rechazar
> con un 403, y **un enlace que no lleva a ningún sitio es peor que un enlace
> ausente** — el usuario no sabe si le falta un permiso o si algo está roto.

Y `DocumentController::owner()`, que manda `href => null` a propósito para los
dueños sin pantalla:

> Sin enlace se lee que no lo hay; con uno roto, que la pantalla está mal.

Las dos piezas hacen lo correcto para lo suyo: el menú esconde sus entradas y los
documentos omiten sus enlaces. Entre ellas quedaron los enlaces **de ficha a
ficha**, que nadie miró.

## El permiso sale del mismo sitio que el del menú

`App\Support\Links\CrossLink` declara, por destino, el permiso que hace falta y
la plantilla de la ruta. El guardián comprueba que ese permiso es **el mismo** que
`Navigation` exige para esa misma pantalla: son la misma pregunta —«¿puede este
actor abrir esto?»— y dos listas que la contestan por separado acaban contestando
distinto. Un sabotaje que cambia el permiso del menú pone la suite en rojo.

La plantilla lleva un hueco y solo uno, también comprobado. Construir la ruta en
cada pantalla es como acabaron conviviendo `/equipment/trucks/{id}` y
`/equipment/{type}/{id}`.

## El nombre no se va con el enlace

Quitar el enlace no puede quitar el dato: el transportista necesita ver de qué
cliente es su carga. Donde no hay enlace queda el nombre en texto plano, y hay un
guardián que lo exige — es la mitad que un lote así se olvida.

## Lo que NO resuelve, declarado

Se comprueba el **permiso**, no el **alcance** sobre esa fila. Un despachador con
`carrier:read` de alcance asignado puede tener delante una carga cuyo
transportista no lleva él, y ese enlace le dará 403.

Resolverlo exigiría una consulta de pertenencia por cada enlace de cada ficha. Lo
que este lote compra es lo otro: que un rol que **nunca** puede abrir una
pantalla no vea nunca su enlace. Está en `CrossLink::SIN_AMBITO` con su motivo, y
el guardián exige que siga escrito.

## Un enlace sin lector, a propósito

El del equipo no tiene hoy ningún caso vivo: el único rol sin `carrier:read` —el
conductor— tampoco alcanza la ficha del camión. Pasa igualmente por `CrossLink`,
por uniformidad y para que el rol que se añada mañana lo herede bien, y eso lo
sujeta el guardián de **estructura**, no una prueba de efecto. La prueba de
característica mide en su lugar el hecho que lo justifica: los dos 403.

Se dice aquí porque un sabotaje lo enseñó: quitarle el enlace al equipo no ponía
nada en rojo, y la tentación era inventar un caso que no existe.

## Los guardianes

`tests/Unit/Suite/CrossLinkTest.php` — 5 comprobaciones: que cada destino pida el
mismo permiso que su entrada de menú, que la deuda de alcance siga declarada, que
sin id o sin permiso no haya enlace, que los tres controladores lo manden, y que
ninguna de las tres pantallas vuelva a construir la ruta a mano.

`tests/Feature/Authorization/CrossLinkTest.php` — 6 pruebas que abren cada ficha
con cada sesión y comprueban las **tres** mitades: que el enlace no llega a quien
no puede abrirlo, que el nombre sí llega, y que pedir la ruta del destino con esa
misma sesión contesta 403 — que es lo que demuestra que el defecto era real y no
una precaución.

**11 sabotajes, 11 rojos** tras mover uno del fichero de efecto al de estructura.
