# El filtro que ofrecía nueve dueños y encontraba uno

## El defecto

El desplegable de «dueño» de la pantalla de documentos ofrecía los **nueve**
tipos del catálogo, a todo el mundo. Y `DocumentScope::apply()` recorta antes de
que el filtro llegue a mirar nada:

| Quién mira | Qué recorta el alcance | Opciones muertas |
|---|---|---|
| Conductor (`Own`) | `owner_type = 'driver'` forzado | **8 de 9** |
| Transportista (`Carrier`) | `forCarriers()` emite cuatro ramas | **5 de 9**, incluidas carga y gasto |
| Despachador (`Assigned`) | igual | **5 de 9** |
| Oficina (`Tenant`) | nada | ninguna |

Elegir una de las muertas vaciaba la lista **en silencio**: ninguna señal de que
esa opción no podía casar con nada, en ninguna empresa, nunca.

Y «carga» y «gasto» no son casos raros: son los dos tipos con más volumen —
`DocumentOwners` lo deja escrito al contarlos en los datos de demostración.

## La regla ya estaba escrita para los atajos de la misma pantalla

`App\Support\Lists\FacetCounts`:

> El número de un atajo tiene que ser el número que sale al pulsarlo.

Los chips de esa misma pantalla pasaron por ahí y quedaron honestos. El
desplegable que vive al lado **no lleva número**, así que hace la misma promesa
sin decir nada — y por eso se escapó de aquel lote. Una promesa muda es más
difícil de ver que una equivocada.

## Las dos direcciones

`DocumentScope::ownerTypesFor()` es `apply()` leído al revés, igual que
`carrierOf()` es `forCarriers()` leído al revés. Vive en el mismo fichero y hay
un guardián que compara las dos: si alguien añade una quinta rama a la consulta
y no la añade aquí, el filtro esconde documentos que sí se pueden ver.

Ese guardián es el que faltaba la última vez que este fichero se leyó en dos
sentidos — `carrierOf()` decía tenerlo y no existía, y se escribió en el lote del
aviso de vencimiento.

## Recortar la lista y validar el valor son dos preguntas

La pantalla recibe la lista recortada. El servidor sigue validando contra el
**catálogo**, no contra lo ofrecido: un `?owner=load` escrito a mano no revienta
—el alcance ya recortó las filas y no hay nada que enseñar— y la validación no
tiene que saber nada de desplegables. Un sabotaje que las junta pone la suite en
rojo.

## Una prueba anterior que encodaba media verdad

`UnnamedValuesTest` exigía `'ownerTypes' => DocumentOwners::all()`, con este
motivo: «el desplegable tiene que salir del catálogo, no del componente». Era
correcto para lo que aquel lote arreglaba —la lista estaba escrita a mano en
React— y no vio que el catálogo entero también miente, en la otra dirección.

Se corrigió con el motivo escrito dentro, no se relajó: sigue exigiendo que la
lista salga del servidor, ahora recortada.

## Los guardianes

`tests/Unit/Suite/DocumentOwnerFilterTest.php` — 4 comprobaciones: que cada
alcance ofrezca exactamente lo que puede encontrar, que lo ofrecido esté en el
catálogo, que las dos direcciones digan lo mismo, y que la pantalla reciba la
lista recortada mientras el servidor valida contra el catálogo.

`tests/Feature/Documents/OwnerFilterTest.php` — 5 pruebas con cada sesión, y las
dos mitades: que las opciones imposibles ya no se ofrezcan, y que **elegir la que
sí se ofrece siga encontrando filas**. Recortar de más deja al usuario sin el
filtro que necesitaba, y hay un sabotaje para eso.

**8 sabotajes, 8 rojos.**
