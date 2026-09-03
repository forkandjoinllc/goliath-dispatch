# El saldo de una factura

Cuatro columnas de `invoices` dicen cuánto se ha cobrado: `amount_paid_cents`,
`balance_cents`, `status` y `paid_at`. Las escribe **un solo sitio** por causa
de un cobro: `PaymentLedger::resync()`.

## Lo que había

Ese comentario ya estaba escrito en `resync()`. No era verdad.

`InvoicePayments::aplicarALaFactura()` escribía las mismas cuatro columnas por
la vía de la pasarela, con dos diferencias que importan:

1. **Sumaba sobre la columna** en vez de recalcular desde las filas de
   `payments`. Dos caminos que dan el mismo número por casualidad dejan de darlo
   en cuanto se cruzan — medio cobro por la pasarela y medio anotado a mano.
2. **No pasaba por `statusFor()`**, que existe literalmente para que «una
   factura anulada, en disputa o dada por incobrable no vuelva a pagada».

    'status' => $saldo === 0 ? 'paid' : $factura->status,

La consecuencia, concreta: la oficina anula una factura mientras un cobro va de
camino; el cobro aterriza y la marca **pagada**. Y desde el lote 68 arrastra
además sus cargas a «Pagada», con su fila de historial diciendo que lo hizo
facturación.

`InvoiceController::void()` se protege comprobando `amount_paid_cents > 0` antes
de anular — pero eso no sirve de nada contra un cobro que llega *después*.

## Por qué existía el segundo escritor

Porque `resync()` pedía un `Actor` y del actor usaba **una sola cosa**: su
empresa. El webhook de la pasarela no tiene actor, así que el método parecía
inalcanzable desde ahí y se escribió otro.

Ahora pide un `tenantId`, que es lo que siempre necesitó. **Una firma que pide
de más fabrica duplicados.**

## Lo que hay

`InvoicePayments::settle()` inserta su fila en `payments` —eso ya lo hacía— y
llama a `PaymentLedger::resync()`. El mismo recalculador que usa la oficina, con
las mismas protecciones.

Y una protección nueva, simétrica: el **saldo** de una factura cuyo estado no
depende del dinero tampoco se recalcula. Anular pone el saldo a cero, y una
factura anulada no debe nada pase lo que pase después; recalcularlo le devolvía
un saldo vivo y la pantalla de vencidos volvía a contarla. La lista es la misma
que protege el estado (`SIN_SALDO`), a propósito: con dos listas, una factura
podría acabar anulada y con saldo, o al revés.

Lo que **sí** se apunta siempre es lo cobrado. El dinero llegó; esconderlo sería
la mentira contraria.

## El rastro que faltaba

El camino de la pasarela no escribía **nada** en la bitácora. `PaymentLedger::record()`
—el de la oficina— sí, así que la pista de auditoría enseñaba solo los cobros
anotados a mano y el dinero que entra solo era invisible.

Ahora escribe `payment.recorded` con `actor` **nulo** y `source: gateway`. Nulo a
propósito: no lo anotó una persona, y poner ahí al despachador diría que sí.

## Lo que sigue abierto

- **Nadie empuja el caso hacia una persona.** La ficha de la factura lo NOMBRA
  —«se recibió un cobro de X después de anularla; ese dinero probablemente haya
  que devolvérselo al transportista»— porque enseñar «Anulada», «Cobrado $316» y
  «Saldo $0» por separado y dejar que el lector las junte no sirve: casi nadie
  las junta. Pero hay que abrir esa factura para verlo. No hay aviso, ni tarjeta
  en el panel, ni nada que lo busque solo.
- **No hay abono.** `invoices.adjustments_cents` se escribe siempre a cero y de
  los cuatro tipos de línea que el esquema admite —`dispatch_fee`, `expense`,
  `adjustment`, `credit`— solo se escribe el primero. Para una factura sin
  cobrar, anular y volver a emitir es la respuesta contable correcta; para una
  ya cobrada haría falta una nota de abono, y no existe.
- **La pasarela es simulada.** Todo esto es latente hasta que haya un proveedor
  de verdad detrás de `InvoicePaymentProvider` — que es precisamente cuando un
  cobro puede llegar tarde de verdad.

## Guardianes

- `tests/Unit/Suite/InvoiceBalanceTest.php` — que la pasarela no vuelva a tener
  escritor propio, que nadie más toque las cuatro columnas por causa de un
  cobro, que la lista que protege el estado sea la misma que protege el saldo,
  que `resync()` no vuelva a pedir un actor que no necesita, y que el cobro de
  la pasarela siga dejando rastro.
- `tests/Feature/Finance/InvoiceBalanceTest.php` — el caso completo: anular y
  que aterrice el cobro, y comprobar que la factura sigue anulada, que la carga
  no se mueve, que el camino normal sigue cerrando la factura, y que medio
  cobro por cada vía suma lo mismo que las filas de `payments`.
