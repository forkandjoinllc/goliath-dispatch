# La baja programada de la que nadie se enteraba

## El defecto

`/facturación` tiene esta línea, y Ajustes la suya:

> **Se dará de baja al acabar el periodo.**
> *(EN: It will be cancelled at the end of the period.)*

Sale de `tenant_subscriptions.cancel_at_period_end`. Esa columna aparecía
**cuatro veces en toda la aplicación**: el modelo —donde solo se declara que es
rellenable, que no es lo mismo que escribirla— y tres lecturas: los dos
`select` de las pantallas y el `(bool)` que las pinta.

**Nadie la escribía.** Nunca. El aviso no podía aparecer en ninguna
instalación, en ninguna empresa, en ningún estado.

## Y un piso más abajo, la razón

`Subscriptions::apply()` conocía tres hechos: pagado, impago, cancelado. El
vocabulario no tenía forma de contar «baja programada», así que el mapeo de
Stripe mandaba a `default` el único suceso que la cuenta:

```php
'customer.subscription.deleted' => BillingEvent::CANCELLED,
default => BillingEvent::IGNORED,          // ← aquí caía subscription.updated
```

`customer.subscription.deleted` **no llega cuando el cliente cancela**: llega
semanas después, cuando el periodo termina. El suceso que salta en el momento
de programarla es `customer.subscription.updated`, y caía en el cajón de
ignorados — y se anotaba como *ignorado* en el libro de sucesos, que es la
única traza que quedaba.

El resultado, en una instalación con Stripe de verdad: una empresa pulsa
«cancelar» en el portal del proveedor —cosa que **la propia pantalla le invita
a hacer**, con `billing.index.portalHint`— y la aplicación sigue diciendo «Al
día», sin fecha de fin y sin que nadie de la casa de despacho se entere de que
ese cliente se está yendo. Se entera el día que deja de renovar.

## La forma general, que es lo que vigila el guardián

**Una columna que una pantalla lee y nadie escribe no rompe nada.** No falla
ninguna prueba, no lanza ningún error: enseña su valor por omisión como si
fuera un dato. `false` se lee igual que «comprobado que no», y cero se lee igual
que «no hay».

`tests/Unit/Suite/SubscriptionColumnsTest.php` saca del `select` de cada
pantalla —no de una lista escrita a mano— toda columna de `tenant_subscriptions`
que se lee, y exige que alguien la escriba. Buscando las dos formas en que se
escribe aquí: `'columna' => valor` dentro de un update, y `$cambios['columna'] =`
cuando el cambio es condicional. Con solo la primera, cuatro columnas que sí se
escriben salían como huérfanas — y un guardián que da falsos positivos es un
guardián que alguien afloja.

El modelo queda fuera a propósito: estar en `$fillable` no es que nadie te
escriba. Era justo el caso de esta columna.

## El vocabulario, ampliado

| Tipo | Qué cuenta |
|---|---|
| `CANCEL_SCHEDULED` | la baja queda programada para el final del periodo pagado |
| `CANCEL_REVERSED` | se retira esa baja: vuelve a renovarse |

Y dos reglas que el código explica donde se aplican:

**Programar la baja NO suspende a nadie.** El estado sigue `active` y
`tenants.status` no se toca: está pagado hasta la fecha de renovación.
Suspender hoy por una baja de dentro de tres semanas sería cobrar un periodo y
no darlo.

**La retirada se reconoce por lo que CAMBIÓ, no por el valor.**
`customer.subscription.updated` salta por cambiar de plan, de tarjeta o de
cualquier cosa, todas con la bandera en `false`. Si el valor decidiera, cada
una de ellas anotaría en el libro una «baja retirada» que no ha pasado. Se mira
`previous_attributes`, que es donde Stripe dice qué cambió; el resto sigue
siendo ignorado a propósito.

**Y al cancelar de verdad, la bandera se limpia.** Si no, la pantalla diría a la
vez «dada de baja» y «se dará de baja al acabar el periodo».

## Sin credenciales de nadie

El simulacro acepta el vocabulario entero —`in_array($tipo, BillingEvent::TYPES)`—
así que los dos sucesos nuevos se pueden ensayar sin Stripe, que es como se
recorre este camino en la demostración y en cualquier instalación sin claves. Un
guardián lo comprueba: el día que el simulacro deje de aceptar el vocabulario
entero, el camino nuevo solo se podría recorrer en producción, y un camino que
solo se recorre en producción no se recorre.

## El paseo bilingüe

Con la demostración y el simulacro, el mismo suceso que mandaría el proveedor:

```
[antes·es]   estado=active programada=false  aviso: (no hay aviso)
    ↓  POST /billing/webhook  ·  cancel_scheduled, period_end = +20 días
[despues·es] estado=active programada=true   "Se dará de baja al acabar el periodo."
[despues·en] estado=active programada=true   "It will be cancelled at the end of the period."
```

Y la pantalla sigue diciendo «Al corriente» junto a «El periodo acaba el
2026-10-10», que es exactamente la verdad: pagada hasta esa fecha, y ese día no
se renueva.

## Lo que este lote NO hace

No avisa a nadie. Que la casa de despacho reciba un aviso cuando un cliente
programa su baja es otra decisión —y hay `Notifications\Events` para ello—, pero
es una decisión de producto: a quién, por qué canal y con qué texto.

No toca el portal del cliente: el simulacro sigue devolviendo `null` en
`portalUrl()` y la pantalla no pinta el enlace, que es más honesto que llevar a
una página vacía.

Y hay algo que este lote deja visto y sin arreglar: **la demostración no siembra
ni planes ni suscripción**, así que `/facturación` en la demostración no enseña
ninguno de estos estados. El paseo tuvo que montar la suscripción a mano y
quitarla después. Es la misma forma que ya mordió en otros lotes —la
demostración no produce el estado donde vive el defecto— y merece su propio
lote.
