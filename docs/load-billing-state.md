# El estado de dinero de una carga

Las cargas tienen trece estados. Los once primeros los mueve una persona
pulsando un botón. Los dos últimos —`invoiced` y `paid`— no: los escribe el
dominio de finanzas, y solo él.

Este documento explica por qué, y qué había antes.

## Lo que había

`Transitions::GRAPH` declaraba `invoiced` y `paid` como acciones de pantalla.
Encima de la declaración había un comentario que decía, literalmente:

> Facturar no es un cambio de estado a mano: lo hace el dominio de finanzas al
> emitir la factura.

Las dos cosas no podían ser ciertas a la vez, y la que mandaba era el código.
`Guards::blocking()` no tenía caso para ninguno de los dos estados, así que:

- un usuario con `invoice:create` marcaba una carga como **Facturada** sin que
  existiera ni una factura;
- un usuario con `payment:record` la marcaba como **Pagada** sin que hubiera
  entrado un centavo;
- y al revés, emitir una factura de verdad **no movía la carga**, ni cobrarla.

El síntoma se veía sin buscarlo. El panel cuenta las cargas pendientes de
facturar preguntando por líneas de factura vivas (`Support\Finance\Billable`).
La ficha de carga leía `loads.status`. Una carga marcada a mano salía
«Facturada» en su ficha y seguía contada como pendiente en el panel: dos
pantallas de la misma aplicación diciendo cosas distintas del mismo dinero.

## Lo que hay

`Support\Loads\BillingState` es el **único** escritor de esos dos estados.

| Qué pasa en finanzas | Qué le pasa a la carga |
| --- | --- |
| `InvoiceBuilder::fromLoads()` emite la factura | `delivered` o `pod_received` → `invoiced` |
| La factura queda saldada | `invoiced` → `paid` |
| Un reembolso la vuelve a abrir | `paid` → `invoiced` |
| `InvoiceController::void()` la anula | `invoiced` → de donde vino |

Tres cosas que conviene tener claras:

**El hecho sigue viviendo en las líneas de factura.** `loads.status` es una
*proyección* de la respuesta de `Billable`, no una segunda verdad.
`BillingState` no reimplementa la consulta: la llama.

**Hay vuelta atrás.** Eso es lo que hace sostenible la proyección. El motivo
por el que durante mucho tiempo esto no se escribió —está en un comentario de
`InvoiceBuilder`— era que «una columna paralela solo puede desincronizarse: se
anula una factura y la carga se queda marcada como facturada para siempre». Es
verdad, y por eso anular devuelve la carga.

**El destino al anular se lee del historial, no está escrito.** La carga vuelve
al estado del que la sacó *esa* factura, que puede ser `delivered` o
`pod_received` según tuviera el comprobante colgado. Un destino fijo habría
inventado un comprobante que nunca llegó.

## `source`, que dejó de ser decorativo

`load_status_history.source` admite cuatro valores desde el primer esquema
—`user`, `tracking_provider`, `system_job`, `webhook`— y el único que se
escribía era `user`, en el único sitio que insertaba filas. La ficha de carga
ya traía la rama para pintar el origen «solo cuando no fue una persona»: una
rama inalcanzable durante toda la vida del proyecto.

Los movimientos de `BillingState` son los primeros que escriben `system_job`, y
llevan en `source_reference` el número de la factura que los provocó.
`actor_user_id` se conserva cuando se sabe: que el paso lo diera el sistema no
borra que alguien emitió la factura que lo causó.

Al hacerse alcanzable esa rama salió a la luz que la pantalla pintaba el valor
**en crudo**. Los rótulos viven ahora en `loads.detail.source.*`, uno por cada
valor que admite el CHECK del esquema.

## Lo facturable ya no es un literal

`Billable::ESTADOS` es `['delivered', 'pod_received']`.

Antes era el literal `'delivered'`, copiado en tres consultas. Eso significaba
que una carga que avanzaba a `pod_received` —el estado al que la propia
aplicación empuja, y que exige el comprobante de entrega firmado— desaparecía
de la pantalla de facturar. Colgar el papel te quitaba la carga de la vista; no
colgarlo te dejaba facturarla. El incentivo estaba exactamente del revés.

`LoadStatus::delivered()` es la lista más ancha —los cuatro estados en los que
una carga ya se entregó— y la usan las liquidaciones. Al transportista se le
paga por haber llevado la carga; que nosotros le hayamos facturado o cobrado
nuestra comisión no tiene nada que ver. Una carga cobrada que desapareciera de
la pantalla de liquidar sería dinero que se le debe a alguien y ya no se ve.

## Lo que sigue abierto

- **Hay dos escritores del saldo de una factura.** `PaymentLedger::resync()`
  dice en su comentario ser «el único sitio que toca `amount_paid_cents`,
  `balance_cents`, `status` y `paid_at` por causa de un cobro», y no lo es:
  `InvoicePayments::aplicarALaFactura()` toca las mismas cuatro columnas por la
  vía de la pasarela. `BillingState::sincronizarCobro()` cuelga de los dos
  porque mientras sean dos tiene que colgar de los dos. Unificarlos es otro
  lote.
- **Se puede facturar sin comprobante de entrega.** `Transitions` dice del
  comprobante «sin él no se factura» y `Guards::forPod()` lo llama «el papel
  que se le enseña al cliente para cobrar», pero `Billable::ESTADOS` admite
  `delivered`. Estrecharlo es una decisión de política de la empresa, no un
  arreglo: hoy la mitad de las cargas facturables no tienen el papel colgado.
  El historial al menos lo deja escrito — la fila dice `delivered → invoiced`.
- **Las cargas anteriores a este lote no se tocan.** Una carga que ya estuviera
  en `invoiced` o `paid` por el botón viejo se queda donde está: `alAnular()`
  no la mueve porque no encuentra en el historial la fila que la puso ahí, y
  adivinar el origen sería escribir en el historial algo que nadie presenció.

## Guardianes

- `tests/Unit/Suite/LoadBillingStateTest.php` — lee el código: que el grafo no
  vuelva a ofrecer los botones, que solo `BillingState` escriba esos estados,
  que los cuatro puntos de finanzas sigan enganchados, que lo facturable no
  vuelva a ser un literal, y que cada origen del CHECK tenga rótulo en los dos
  idiomas.
- `tests/Feature/Loads/BillingStateTest.php` — el circuito de punta a punta:
  facturar, cobrar entero, cobrar a medias, reembolsar, anular desde los dos
  orígenes, y que una carga cobrada siga liquidándose.
