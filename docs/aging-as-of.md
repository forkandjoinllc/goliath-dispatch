# El periodo cerrado que cambiaba cada día

## El defecto

El rótulo del informe, encima mismo de los contadores, dice:

> Estas cifras salen del trabajo FACTURADO y de la instantánea congelada que usó
> cada factura — nunca de un recálculo. **Un periodo cerrado dice siempre lo
> mismo**, y una carga entregada y todavía sin facturar aún no aparece aquí.

`billed()` filtra por el periodo:

```php
->whereBetween('i.created_at', [$this->from, $this->to]);
```

`invoices()` —de donde salen la antigüedad del cobro y el contador «Pendiente de
cobro»— no filtraba por nada. Eran **todas las facturas abiertas de la
historia**, repartidas por tramos contra el día de hoy.

Medido: pedí el informe de enero y «Pendiente de cobro» daba $0. Emití una
factura con fecha de septiembre. El informe de **enero** pasó a decir $2.500.

Y sin emitir nada, la misma factura de enero iba saltando de tramo cada mes,
porque los días vencidos se contaban contra hoy. Quien cerraba un mes y volvía a
abrirlo en octubre leía otra cifra, sin nada en pantalla que lo explicara.

## La decisión: la foto es a la fecha del periodo

Una cartera se puede leer de dos maneras honestas —a día de hoy, o a la fecha de
cierre— y la que hace verdadero el rótulo es la segunda. Además es la que
permite reproducir el cierre de un mes: enero dirá siempre lo que se debía a 31
de enero.

Si el periodo llega al futuro, la foto se para en hoy. Una cartera no puede decir
lo que se deberá el mes que viene.

## De dónde sale el saldo de una fecha pasada

`invoices.balance_cents` es el saldo de **hoy**, así que no sirve. Se reconstruye
del mismo sitio del que ya sale el de hoy: de las filas de `payments`. Es la
regla de la casa de `PaymentLedger` llevada un paso más:

> La columna es una CACHÉ de la suma, no la verdad; la verdad son las filas.

```
saldo(D) = total − cobros recibidos hasta D + reembolsos devueltos hasta D
```

Los dos momentos son columnas con fecha —`received_at` y `refunded_at`—, así que
**un cobro que entró en enero y se devolvió en marzo estaba en casa en enero**, y
el informe de enero lo refleja mientras que el de marzo vuelve a deberlo.

De la factura también hay fechas: no se cuenta la que aún no se había emitido, ni
la que ya estaba anulada, en disputa o dada por incobrable a esa fecha. Una
anulada **después** de D sí cuenta: a esa fecha se debía.

## Lo que esta reconstrucción no puede saber, y se dice

Los cambios de **estado** de un cobro no llevan fecha. Un cheque anotado como
`pending` en enero y compensado en febrero se cuenta desde su `received_at`, o
sea desde enero. Se excluyen los que hoy siguen sin ser dinero —`pending`,
`failed`, `cancelled`—, porque nunca lo fueron; el resto se datan por sus
columnas.

Es la mejor aproximación con lo que hay guardado. Decirlo en el docblock es
preferible a fingir que es exacta.

Y hace falta el **complemento** de la lista de `PaymentLedger`, no esa lista: un
cobro hoy en `refunded` sí fue dinero en su día, y para una foto de enero cuenta.

## La pantalla dice a qué fecha está la foto

En los dos sitios: el contador «Pendiente de cobro» lleva su nota, y el título de
la sección lleva la fecha al lado. Un tramo de antigüedad sin fecha obliga a
suponerla, y la suposición natural —hoy— es falsa en cuanto alguien pide un mes
cerrado.

```
ANTIGÜEDAD DEL COBRO · A fecha de 31 ene 2026
RECEIVABLES AGEING · As of Jan 31, 2026
```

Con un periodo que llega a 2027, las dos dicen la fecha de hoy.

## Una consulta menos por petición

`summary()` llamaba a `aging()` y el render volvía a llamarlo. Con la lectura
antigua eran dos consultas baratas; reconstruir saldos lee además las filas de
cobros, así que ahora se calcula una vez y se pasa. Hay un guardián que cuenta
las llamadas.

## Lo que NO se toca

- El rótulo del informe no cambia, porque ahora es verdad.
- `billed()`, los cortes por transportista y los demás bloques del informe
  siguen igual: ya filtraban por el periodo.
- Los tramos siguen siendo los de siempre —corriente, 1-30, 31-60, 61-90 y más
  de 90—, que es el reparto que entiende cualquiera que haya cuadrado una
  cartera.

## Guardianes

`tests/Unit/Suite/AgingAsOfTest.php` (7) y
`tests/Feature/Reports/AgingAsOfTest.php` (12). **14 sabotajes, 14 cazados**,
incluidos contar los tramos contra hoy, restar un reembolso posterior a la
fecha, contar un cheque que no ha compensado, y quitar la fecha del título
dejándola en el contador.
