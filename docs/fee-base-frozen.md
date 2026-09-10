# La base de la tarifa que sí reescribía

## El defecto

Una carga se calcula con cuatro entradas de dinero. Tres viven en la **carga**,
congeladas desde que se acordó. La cuarta se leía viva de los ajustes de la
empresa.

Y el comentario que lo explica está **justo encima** de la línea que fallaba, en
`LoadCalculator`:

> Los puntos básicos salen de la CARGA, no del transportista ni de los ajustes.
> Están congelados ahí desde que se acordó la carga precisamente para que
> subirle la tarifa a un transportista hoy no reescriba lo que se pactó el mes
> pasado.

La línea siguiente decía `feeBase: $this->feeBase($load->tenant_id)`.

## Lo que se midió

Sobre una carga que ya existía, con un gasto excluido de $1.000, cambiando el
ajuste en Ajustes → Dinero:

| | antes | después |
|---|---|---|
| Tarifa de despacho | $300,00 | $400,00 |
| **Lo que cobra el transportista** | **$3.700,00** | **$3.600,00** |
| Comisión del despachador | $75,00 | $100,00 |

Y esa misma pantalla lo dice tres veces, en los dos idiomas:

- «Una carga conserva su tarifa y su comisión desde que se acordó.»
- «Cambiarla **no reescribe nada** de lo que ya existe.»
- «Las que ya existen **conservan lo suyo**.»

## La justificación que tenía, y por qué no se sostiene

El método traía escrito que la base «no es un precio pactado sino la
interpretación del contrato marco de la empresa». Es un argumento razonable
hasta que se miran las cifras: cambiarla mueve lo que cobra el transportista por
una carga que ya se acordó. **Un porcentaje aplicado sobre otra cantidad es otro
precio**, se llame como se llame.

Las dos bases solo se separan cuando hay gastos **excluidos** —la comisionable
es el bruto menos lo que no es flete—, y ahí está la razón de que esto pasara
desapercibido: en una carga sin permisos ni gastos las dos dan la misma cifra.
La primera vuelta de la medición salió «IGUAL» por eso mismo.

## Es la regla que la tabla de gastos ya tomó

`expenses.treatment_snapshot` existe exactamente por esto: la categoría dice hoy
cómo trata el dinero, y el gasto guarda **cómo lo trataba el día que se
presentó**. Este lote es esa misma decisión aplicada a la única entrada de
dinero de una carga que se había quedado fuera.

## Lo que se hizo

`loads.dispatch_fee_base` y `financial_snapshots.dispatch_fee_base`, las dos con
su `CHECK`. El alta sella la base **fuera** del bloque de permiso de dinero: no
es una cifra que se teclee, es la política que estaba en vigor ese día, y una
carga dada de alta por quien no ve importes tiene que llevársela igual. Dentro
del `if` se habría quedado con el valor por omisión de la columna —un defecto
más callado que el original.

`LoadCalculator` lee la de la carga y **solo si falta** cae a los ajustes. El
respaldo existe porque una fila sin sellar no puede reventar el cálculo de
dinero; va después, y hay un guardián que comprueba el orden.

La instantánea financiera guardaba los puntos básicos y la base de la
**comisión**, pero no la de la **tarifa**: una liquidación cerrada no podía
explicar su propia cifra. Ahora la guarda.

## Las filas que ya existían

Se rellenan con lo que la empresa tiene puesto **hoy**, que es exactamente el
valor con el que se venían calculando. **El importe de ninguna carga abierta se
mueve por esta migración**: lo que cambia es que a partir de ahora deja de
moverse solo.

## Comprobado en el navegador

Con el ajuste de la empresa puesto en `carrier_gross_rate` y la carga sellada
con `commissionable_base` (bruto $1.984, gasto excluido $500, tarifa 12 %):

| | tarifa | al transportista |
|---|---|---|
| sello de la carga = `commissionable_base` | $178,08 | $1.465,92 |
| sello de la carga = `carrier_gross_rate` | $238,08 | $1.405,92 |

Idéntico en los dos idiomas. El sello de la carga es lo que manda; el ajuste de
la empresa ya no la toca.

## Lo que NO se toca

- El ajuste **sigue sirviendo para lo que dice**: con qué empiezan las
  siguientes. Hay una prueba que da de alta una carga antes y otra después del
  cambio y comprueba que cada una lleva la suya.
- Las liquidaciones ya cerradas no dependían de esto: conservan su cifra en
  `financial_snapshots`, que es de solo añadir.
- El texto de la pantalla no se toca porque ahora es verdad. La otra salida de
  este lote era corregirlo; se eligió congelar la base. Un guardián sujeta el
  texto para que, si algún día se deshace, no se quede mintiendo solo.

## Requiere `php artisan migrate` en el despliegue

`2026_09_14_100000_freeze_dispatch_fee_base_on_loads`. Añade las dos columnas,
rellena las filas y pone los dos `CHECK`.

## Guardianes

`tests/Unit/Suite/FeeBaseFrozenTest.php` (7) y
`tests/Feature/Finance/FeeBaseFrozenTest.php` (7). **13 sabotajes, 13 cazados**,
incluidos meter el sello dentro del bloque de dinero, poner el respaldo por
delante de la base propia, y dejar la migración sin relleno.
