# El margen de la casa que veía el transportista

## El defecto

`load:financials:read` era una puerta de sí o no. Quien la pasaba recibía las
**diecinueve** cifras del reparto de una carga.

El rol TRANSPORTISTA tiene ese permiso, con alcance propio, sobre sus cargas. Se
lo dio quien quería que viera **su liquidación** —su bruto, la tarifa que se le
cobra, lo que se le reembolsa y lo que se le retiene—, y con ella se llevaba el
otro lado de la mesa:

```
GD-24009 · portal del transportista, antes
  Cobro al cliente                     $8,600
  Tarifa bruta del transportista       $6,880
  Su tarifa de despacho (10%)            $688
  Liquidación al transportista         $6,192
  Absorbido por usted                 − $180
  Margen bruto                           $508
  Comisión del despachador            − $172
  Margen neto                            $336
```

Las cuatro últimas líneas y la primera no son suyas. La primera es lo que la
casa le cobra al cliente; las otras, lo que la casa gana y lo que le paga a su
propio empleado.

Y no era solo la ficha:

| Dónde | Qué se iba |
|---|---|
| Ficha de la carga | cobro al cliente, absorbidos, margen bruto, comisión, margen neto |
| Listado de cargas | la columna del cobro al cliente |
| Informe del periodo | margen por transportista, cobro y margen por cliente, el total de arriba, y el total de gastos absorbidos |

## Por qué es un defecto y no una decisión

Porque la regla estaba escrita. Dos veces.

`App\Support\Privacy\Internal`, del lote de las notas internas:

> No es un permiso: es de qué lado de la mesa está quien mira. El equipo de la
> casa de despacho escribe estas notas; el transportista y el conductor son la
> otra parte. Un permiso se puede conceder; el lado de la mesa no.

Escrita para dos campos de **texto**, y nunca aplicada al dinero, que es el
secreto más grande de los tres. Peor: ese mismo fichero **cita el bloque de
dinero** como precedente de que un dato no se manda escondido. Miró la tarjeta
para copiar una técnica y no vio lo que la tarjeta estaba enseñando.

Y la cabecera de `LoadController`:

> un conductor tiene `load:read` con ámbito propio y ninguna concesión
> financiera. Ve su carga, sus paradas y sus horas, y NO ve lo que cobra la
> empresa ni lo que se le paga al transportista.

Razonada entera para el conductor —que está dentro de la operación— y jamás para
el transportista, que es una empresa de fuera.

La tercera está en `PeriodReport::commissionsByDispatcher()`, que devuelve lista
vacía cuando el alcance no llega a `Tenant`. En el mismo fichero cuyo
`byCarrier()` mandaba el margen sin mirar a quién. **Una consulta de cuatro
sabía la regla.**

## La frontera

`App\Support\Finance\MoneyAudience` no inventa una frontera: le pregunta a la que
ya existe. `de($actor)` es `Internal::esEquipo($actor)` y nada más. Dos sitios
contestando «¿es de la casa?» acabarían contestando distinto, y el día que eso
pase lo que se descuadra es quién ve un margen.

Dos listas exhaustivas, cada cifra con su motivo:

**Del transportista** — la prueba es «¿sale este número en su liquidación, o la
determina?»: `carrierGrossRate`, `excludedExpenses`, `commissionableBase`,
`feeBase`, `dispatchFeeBps`, `dispatchFee`, `reimbursableExpenses`,
`carrierDeductions`, `netCarrierSettlement`.

**Solo de la casa**: `customerCharge`, `tenantAbsorbedExpenses`, `grossMargin`,
`commissionBps`, `commissionBasis`, `dispatcherCommission`, `netMargin`,
`commissionOwner`, `commissionOwnerMissing`, `commissionOrphaned`.

El guardián comprueba que la unión de las dos es **exactamente** lo que produce
`financials()`. Una cifra nueva hay que clasificarla o la suite se pone en rojo,
que es lo contrario de lo que pasó aquí: la cifra se colaba por omisión.

### La que decidiste tú, no el código

`customerCharge`. En una casa que **corretea** —compra al cliente y vende al
transportista— el diferencial es el número mejor guardado del sector. En una de
**servicio de despacho puro**, donde el transportista es el dueño del cliente,
sería suyo y esconderlo sería absurdo.

El código no puede contestar eso. Se esconde porque es la decisión que no se
puede deshacer al revés —lo que se enseña una vez, enseñado está— y porque los
datos de demostración tienen el diferencial de un corretaje ($8.600 contra
$6.880). **Abrirlo es quitar una línea** de `SOLO_LA_CASA`, y la línea lleva el
motivo escrito al lado.

### Se quita la clave, no se pone a null

`array_diff_key`, no `=> null`. Una clave con null todavía dice que el dato
existe y que alguien decidió no dártelo; ausente no dice nada. Es la misma
decisión que la pantalla ya tomaba con el bloque entero —«no se manda, no se
esconde»— y por eso el tipo de TypeScript declara opcionales esas cifras en vez
de anulables. El guardián lo vigila: volverlas obligatorias es la forma cómoda de
«arreglar» un error de `tsc` y deja la pantalla contando con un número que no
llega.

En el LISTADO sí se manda `null`, porque allí `null` ya significaba «no te toca»
desde antes y el tipo es uno solo para toda la tabla. Lo que no puede pasar —y
era lo que pasaba— es que el número viaje dentro.

## Lo que la pantalla dice

La tarjeta del transportista termina en su liquidación neta, sin un hueco ni un
cero. El informe del periodo le dice de qué informe se trata:

> Este informe enseña lo suyo: su bruto, la tarifa de despacho que se le cobra y
> lo que se le liquida. El resultado de la casa de despacho no forma parte de él.

Una tabla a la que le falta una columna, sin una frase, se lee como una pantalla
rota. Comprobado en los dos idiomas.

## Y el aviso del lote anterior, corregido

`loads.money.commissionNoOwner` decía «**Asigne un despachador en el dinero de la
carga**» y se pintaba sin mirar el permiso. Lo escribí yo la semana pasada. El
despachador ve el dinero y no puede tocarlo —no tiene
`load:financials:update`—, y al transportista se le estaba pidiendo que
arreglara la nómina de otra empresa.

Ahora son dos textos: al que puede asignar se le pide que asigne; al que solo
mira se le cuenta el hecho. Al transportista ya no le llega la cifra, así que el
aviso no existe para él.

## La exportación, declarada y no arreglada

El CSV de informes **no** pasa por `MoneyAudience`, a propósito y por escrito:
`report:export` no se concede fuera de la casa, y una rama que no se ejecuta
nunca se pudre sin avisar. Lo que hace que esa deuda no sea una excusa es el
guardián: recorre `Internal::CONTRAPARTES` y comprueba que ninguno tiene
`report:export`. El día que alguien se lo conceda, la suite se pone en rojo y
manda al comentario.

## Los guardianes

`tests/Unit/Suite/MoneyAudienceTest.php` — 8 comprobaciones. La clasificación
exhaustiva, que cada cifra diga por qué, que la frontera se le siga preguntando a
`Internal`, que las cuatro superficies pasen por el registro, la deuda de la
exportación, que la pantalla corte por cifra ausente y no por cero, el aviso de
dos caras y la nota del informe.

`tests/Feature/Finance/MoneyAudienceTest.php` — 7 pruebas que piden las
pantallas con la sesión abierta y miran **lo que viaja**, no lo que React pinta:
el transportista recibe su liquidación entera y ninguna cifra de la casa; el
despachador, que mira con alcance ASIGNADO, las recibe todas; el conductor sigue
sin recibir el bloque; la columna del listado llega vacía; y el informe pierde
el margen, el cobro al cliente y los gastos absorbidos **conservando** los tres
tratamientos que sí mueven su liquidación.

**14 sabotajes, 14 rojos.** Dos de ellos son los dos sentidos del mismo error
—«todo el mundo es de la casa» y «nadie es de la casa»—, porque un filtro que se
pasa de listo y le esconde el margen a contabilidad rompe la pantalla para la que
se escribió.

El decimoquinto fue un escape mío: quité el filtro de los gastos absorbidos y la
prueba siguió verde, porque el escenario no tenía ningún gasto `tenant_absorbed`
aprobado. La comprobación pasaba con el filtro y sin él. Ahora la prueba planta
dos gastos —uno suyo y uno de la casa— y distingue «filtrado» de «no había».
