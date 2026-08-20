# El dinero de una carga

Cinco cifras salen de cada carga. Este documento fija cómo, y por qué así.

## La regla que no admite excepción

**No hay un solo `float` en el cálculo.** Todo son centavos enteros, de
principio a fin. `0.1 + 0.2` no es `0.3` en coma flotante, y un sistema que
reparte el dinero de un transportista no puede permitirse que el total dependa
del orden en que se sumaron las cosas.

Los porcentajes se guardan en **puntos básicos** (10.000 pb = 100 %), así que
«10,25 %» es el entero `1025` y no un número con coma que hay que redondear
antes de poder usarlo.

## Las cuatro entradas

Los cuatro tratamientos de gasto vienen del esquema
(`expenses.treatment_snapshot`) y cada uno hace una cosa distinta:

| Tratamiento | Qué hace | Ejemplo |
|---|---|---|
| `excluded_from_commission` | Sale de la base sobre la que se calcula el porcentaje | Permiso de sobredimensión, escoltas |
| `reimbursable_to_carrier` | Se le devuelve al transportista. Sube su liquidación | Maniobra de descarga |
| `tenant_absorbed` | Lo paga la casa de despacho. Baja su margen | Reimpresión de documentación |
| `carrier_deduction` | Se le retiene. Baja su liquidación | Combustible adelantado, peajes |

Solo cuentan los gastos **aprobados** (`approved` o `reimbursed`). Un gasto
enviado y sin revisar no puede mover el dinero de nadie: si lo hiciera, la
liquidación de un transportista cambiaría sola cada vez que alguien sube la foto
de un recibo.

## La cuenta, en orden

```
1. base comisionable   = max(0, bruto − excluidos)
2. tarifa de despacho  = base comisionable × tarifa_pb / 10.000
3. liquidación neta    = bruto − tarifa + reembolsables − retenciones
4. margen bruto        = tarifa − absorbidos
5. comisión despachador= base_según_la_carga × comisión_pb / 10.000
```

El orden está escrito **en un solo sitio**: `App\Support\Finance\Calculator`. En
cuanto la misma cuenta se escriba en dos lugares —la pantalla de la carga y el
generador de liquidaciones, por ejemplo— empezarán a discrepar en un céntimo, y
ese céntimo aparecerá en una llamada de teléfono.

### Por qué la base comisionable tiene suelo en cero

Sin él, un permiso más caro que el flete daría una base negativa y por tanto una
tarifa de despacho negativa: la casa de despacho *pagando* al transportista por
despacharle una carga. Eso no es un caso de negocio, es un error de captura, y
devolver cero lo deja a la vista en vez de repartirlo por el resto de la cuenta.

### Por qué la liquidación se calcula sobre el bruto y no sobre la base

Los gastos excluidos se quitaron **solo para calcular el porcentaje**. No son
dinero que el transportista deje de recibir. Restarlos también en el paso 3 sería
cobrárselos dos veces.

### Por qué el margen puede salir negativo

Porque una carga vendida por debajo de coste es un hecho de negocio legítimo, no
un fallo de integridad. El esquema lo permite a propósito y no lleva `CHECK`; ver
`docs/port-notes-finance-messaging-tracking.md`.

## La decisión que el esquema no tomaba

El esquema fija los nombres de las columnas pero no **sobre qué importe se cobra
la tarifa de despacho**. Había dos lecturas defendibles:

- **A** — sobre la base comisionable (bruto menos excluidos).
- **B** — sobre el bruto íntegro.

No es un detalle. Sobre seis cargas de demostración las dos se separan en
**$621**, todos salidos del bolsillo del transportista, y la diferencia entera
venía de dos cargas con permisos caros: en GD-24003 el transportista adelantó
$5.250 en permisos y escoltas, y bajo B se le cobraría un 10 % también sobre eso.

**Se eligió A**, y la eligió Luis con las dos tablas delante. Coincide, además,
con lo que dice el enum `App\Enums\ExpenseTreatment` escrito en la fase 2 desde
la especificación original: *«Removed from the commissionable base before the
dispatch fee is applied»*.

No está fijo en el código. Vive en `tenant_settings.dispatch_fee_base`, con
`commissionable_base` por defecto, porque esto es multiempresa: cada casa de
despacho firma su propio contrato con sus transportistas, y una que cobre sobre
el bruto íntegro no puede obligar a las demás a hacer lo mismo.

## El redondeo

**Medio hacia arriba, sobre el valor absoluto.** El 10 % de $2.250,05 son
$225,005, y se convierte en **$225,01** — que es lo que sale si alguien rehace la
cuenta con una calculadora. Que coincida importa más de lo que parece: la
alternativa es una llamada de teléfono por cada céntimo de diferencia.

Sobre el valor absoluto y no sobre el número con signo, para que −225,005 dé
−225,01 y no −225,00. Un importe negativo aparece en un abono, y el abono de una
cantidad tiene que ser exactamente esa cantidad con el signo cambiado; si no,
cobrar 225,01 y abonar 225,00 dejaría un céntimo colgando en cada abono.

## Lo que está congelado en la carga

Cuatro columnas de `loads` son **términos pactados**, no consultas vivas:

- `carrier_dispatch_fee_bps`
- `dispatcher_commission_bps`
- `dispatcher_commission_basis`
- `carrier_gross_rate_cents`

Subirle hoy la tarifa a un transportista no puede reescribir lo que se pactó el
mes pasado. Por eso el cálculo las lee de la carga y **nunca** hace join contra
`carriers.dispatch_fee_bps` ni `dispatcher_profiles.commission_bps`.

La única excepción es la base de la tarifa (arriba), que se lee de los ajustes
vivos porque no es un precio pactado sino la interpretación del contrato marco.
Las liquidaciones ya cerradas conservan su cifra en `financial_snapshots`, que es
una tabla de solo añadir.

## Dónde está cada cosa

| Clase | Qué es |
|---|---|
| `Money` | Puntos básicos y redondeo. Sin dependencias |
| `Calculator` | La cuenta. Aritmética pura, sin base de datos |
| `LoadCalculator` | Va a buscar los gastos y el ajuste de la empresa |
| `LoadFinancials` | El resultado, con los pasos intermedios a la vista |
| `FeeBase` | La decisión de arriba, como enumeración |

`Calculator` está separado de `LoadCalculator` a propósito: comprobar que un
10 % de $2.250 son $225 no debería exigir montar una empresa entera con su
sesión y su transportista.
