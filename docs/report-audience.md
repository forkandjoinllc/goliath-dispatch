# «Pendiente de cobro» al que lo debe

## El defecto

`/informes` le enseñaba a un transportista un contador que decía, en el mismo
sitio donde la casa lee su cartera:

> **Pendiente de cobro** · $239.62
> *(EN: Still owed to you)*

Y debajo, cinco tramos bajo el título «Antigüedad del cobro». Y arriba del
todo, el subtítulo de la página: «Qué se facturó, qué dejó, y **qué le siguen
debiendo**».

Esa cifra sale de `invoices`. En esta aplicación `invoices.carrier_id` es **a
quién se le cobra**: la factura es la tarifa de despacho que la casa le emite al
transportista, y el diccionario de facturas lo dice con todas las letras —«Lo
que la casa de despacho le cobra a cada transportista por su tarifa de
despacho»—. `PeriodReport` estrecha por esa misma columna cuando el alcance es
`Carrier`:

```php
if ($this->scope === Scope::Carrier) {
    $query->where($column, $this->actor->carrierId ?? '');
```

Así que la cifra más grande de la pantalla salía **con el signo cambiado**, y
con ella los cinco tramos de antigüedad, el recuento de facturas de cada tramo y
el subtítulo. Lo que el transportista debe, presentado como lo que le deben.

## Lo que lo hace peor: estaba pensado a medias

No es el caso de quien nunca se planteó esta audiencia. `MoneyAudience` existe
justo para eso, y en esta misma pantalla ya hace su trabajo: al transportista le
esconde el margen bruto y lo cobrado al cliente —`INFORME_SOLO_LA_CASA`—, y la
pantalla le pinta un descargo escrito para él:

> Este informe enseña lo suyo: su bruto, **la tarifa de despacho que se le
> cobra** y lo que se le liquida.

«Que se le cobra». Quien escribió esa frase sabía perfectamente de qué lado
estaba la factura. Se arregló lo que había que **esconder** y no se tocó lo que
había que **renombrar** — la mitad más visible de la pantalla.

Y la pantalla no llegaba a preguntar quién miraba: lo **deducía** de que faltara
una clave.

```tsx
const verMargen = summary.marginCents !== undefined
```

Con eso solo se decidía enseñar el descargo. Una ausencia sirve para esconder
una columna; no sirve para elegir un rótulo, porque el día que se esconda otra
cifra más la deducción sigue dando lo mismo y el nombre se queda como estaba.

## El arreglo

**Primero, se pregunta.** El controlador manda de qué lado de la mesa mira quien
abre la pantalla, igual que manda el alcance en los listados:

```php
'audience' => MoneyAudience::de($actor),
```

**Segundo, los rótulos se eligen, no se fijan.** Cuatro, no uno: el contador era
el más visible, pero el título de la antigüedad decía «cobro» otra vez, su nota
explicaba el saldo desde la caja de la casa, y el subtítulo de la página lo
repetía.

| | La casa | El transportista |
|---|---|---|
| contador | Pendiente de cobro | **Pendiente de pago** |
| antigüedad | Antigüedad del cobro | **Antigüedad de lo que debe** |
| subtítulo | …y qué le siguen debiendo | **…y qué sigue debiendo** |
| nota | …estaba en casa en enero | **…estaba pagado en enero** |

**El número no cambia.** Es la misma fila de `invoices` y el mismo importe: lo
que cambia es cómo se llama. Una prueba lo mide con una factura abierta de
verdad, comparando el valor que recibe cada uno — con cero pendiente, «iguales»
y «las dos mal» se ven idénticos.

### Por qué renombrar y no esconder

Esconderlo también habría quitado la mentira. Pero el dato es suyo y le sirve
—lo que debe, y desde cuándo—, y esconderlo contradiría el descargo que ya le
promete «lo suyo». Lo que no puede es llamarse igual para los dos lados.

## El registro

La cifra no estaba clasificada en ninguna parte: no se escondía —y hace bien— y
tampoco se declaraba que significa lo contrario según quién mire. **No había
dónde notarlo.** Ahora cada cifra que pasa por `filtraInforme()` cae en una de
tres listas, y el guardián exige que caiga exactamente en una:

| Lista | Qué significa |
|---|---|
| `INFORME_SOLO_LA_CASA` | no se le manda al de fuera |
| `INFORME_CAMBIA_DE_LADO` | se le manda con otro nombre |
| `INFORME_IGUAL_PARA_LOS_DOS` | dice lo mismo para los dos, y por qué |

La tercera lista es la que hace que la primera vez que esto pase se note: sin
ella, una cifra nueva no está en ninguna y el guardián calla — que es
exactamente como entró `outstandingCents`.

Se comprueba en las dos direcciones: toda cifra que el informe manda está
clasificada, y toda cifra clasificada se sigue mandando. Y las cifras se leen de
los **tres** sitios que filtran —el resumen de arriba, la tabla por transportista
y la tabla por cliente—, no de uno: leer solo el resumen, que fue mi primer
intento, daba por no clasificada una cifra que sí lo estaba y por sobrante otra
que vive en otro fichero. El ayudante cuenta las tres puertas y falla si mañana
hay una cuarta.

## El paseo bilingüe

Con la demostración, la misma factura abierta vista desde los dos lados:

```
[admin·es]   audiencia=casa           pendiente=55562  margen=205736
   contador: "PENDIENTE DE COBRO" = "$555.62"
   sección : "ANTIGÜEDAD DEL COBRO · A FECHA DE 20 SEPT 2026"

[carrier·es] audiencia=transportista  pendiente=23962  margen=(escondido)
   contador: "PENDIENTE DE PAGO" = "$239.62"
   sección : "ANTIGÜEDAD DE LO QUE DEBE · A FECHA DE 20 SEPT 2026"
   subtítulo: "Qué se le facturó, qué se le liquidó, y qué sigue debiendo."

[carrier·en] contador: "STILL OWED BY YOU"
             sección : "AGEING OF WHAT YOU OWE"
```

## Lo que este lote NO hace

No cambia ningún número, ninguna consulta y ningún permiso: el estrechamiento
por transportista ya era correcto y sigue igual. No toca la exportación CSV,
que sigue sin pasar por `MoneyAudience` con su deuda declarada y su guardián
—`report:export` no se concede fuera de la casa—. Y no revisa el resto de
pantallas en busca de rótulos que cambien de lado: lo que impide que entren es
el registro, no una pasada más.
