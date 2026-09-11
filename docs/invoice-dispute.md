# La disputa que la factura no se enteraba de que tenía

> Este módulo no decide quién tiene razón en un contracargo. Registra que hay
> uno abierto, deja de contar ese dinero como cobrado mientras dure, y apunta
> cómo terminó. Quién gana la disputa lo deciden el banco y la pasarela, y lo
> que haya que alegar ante ellos no sale de aquí.

## El defecto

La pantalla de cobros tiene, desde hace lotes, un botón «Marcar en disputa» con
su aviso:

> Un cobro en disputa deja de contar como dinero en casa: la factura vuelve a
> deber lo que ese cobro cubría.

Esa frase era verdad a medias. `PaymentLedger::dispute()` escribía
`payments.status = 'disputed'` y recalculaba el saldo de la factura, así que la
segunda mitad —la factura vuelve a deber— sí ocurría. La primera no llegaba a
ninguna parte: **la factura no se enteraba de que estaba en disputa**. Se
quedaba en «enviada» o «vencida», indistinguible de un cliente que sencillamente
no ha pagado.

Tres consecuencias, y la tercera tenía la guarda ya escrita.

### 1. La barredora nocturna la reclamaba

`notifications:sweep` persigue cada noche toda factura con saldo y fecha
pasada, saltándose solo `draft`, `voided`, `paid` y `uncollectable`. Una
factura en disputa no estaba en esa lista, así que entraba en la reclamación
como un moroso corriente. El dinero había llegado; quien lo retiró fue el
banco. Reclamársela al cliente es pedirle que pague dos veces.

### 2. La cartera por antigüedad la contaba, por partida doble

`PeriodReport::aging()` lleva desde el primer día con esta cláusula:

```php
->where(fn (Builder $q) => $q->whereNull('i.disputed_at')->orWhere('i.disputed_at', '>', $corte))
```

`invoices.disputed_at` **no la escribía nadie**. La columna existía en la tabla,
en el modelo y en esa consulta, y ninguna línea de la aplicación le ponía un
valor. La cláusula tomaba siempre la rama `whereNull` y no excluía nada.

Y había un segundo agujero en la misma consulta, que solo salió con un
sabotaje: `paidAsOf()` no tenía `disputed` en su lista de estados que nunca
fueron dinero, así que contaba el cobro disputado como recibido. El resultado
era que la factura sí entraba en los tramos, pero **con saldo cero**. Desde
fuera se parecía a estar excluida; por dentro era lo contrario — el informe
daba por cobrado un dinero que el banco estaba retirando.

### 3. Un cobro posterior la pasaba a «pagada»

Este es el que tenía la guarda puesta. `PaymentLedger` lleva una lista de
estados en los que el dinero ya no manda:

```php
private const SIN_SALDO = ['voided', 'disputed', 'uncollectable', 'draft'];
```

Y el comentario de `dispute()`, escrito por quien previó el problema:

> Dar por cobrada una factura cuyo pago está en disputa es exactamente el error
> que este estado existe para evitar.

Como `invoices.status` nunca llegaba a `'disputed'`, la guarda **no podía
dispararse nunca**. Un cobro posterior que cubriera el saldo pasaba la factura a
«Pagada» con la disputa viva encima.

Es la forma de siempre: el diagnóstico estaba escrito —en un comentario, en una
lista de estados y hasta en una cláusula de una consulta financiera— y no se
había aplicado donde hacía falta.

## Lo que hace ahora

### La disputa de la factura se DEDUCE, no se recuerda

> Una factura está en disputa si y solo si le queda algún cobro en disputa.

`resync()` —el único sitio que escribe la factura desde sus cobros— consulta si
queda alguno y escribe o borra la marca en la misma expresión:

```php
'disputed_at' => $disputa?->disputed_at,
'dispute_reason' => $disputa?->dispute_reason,
```

Deducirla es lo que hace que la dirección de bajada funcione sin que nadie tenga
que acordarse de ella. Un estado guardado por su cuenta se queda encendido
cuando la disputa termina, y con dos ramas —una que enciende y otra que apaga—
la segunda es la que se olvida.

Consecuencia obligada: `'disputed'` sale de `SIN_SALDO`. Un estado deducido no
puede además ser pegajoso. Y entra en una lista nueva, `VUELVEN_A_ENVIADA`,
junto a `'paid'`: resuelta la disputa, la factura es lo que su saldo diga, no lo
que fue.

### El orden dentro de `statusFor()` es la regla

```
anulada / incobrable / borrador  →  mandan sobre todo
en disputa                       →  manda sobre el saldo
saldo <= 0                       →  pagada
```

Arriba porque una factura anulada no debe nada, la esté reclamando el banco o
no. En medio porque si el saldo mandara sobre la disputa volveríamos al defecto
del punto 3. Los dos órdenes tienen su sabotaje.

### La disputa sabe terminar

`resolveDispute()` cierra con uno de dos desenlaces, y **no existía nada
parecido antes**. Sin él, propagar la disputa a la factura la habría dejado
fuera de la reclamación y de la cartera para siempre, y sin forma de volver a
cobrarla.

| Desenlace | El cobro queda | La factura |
|---|---|---|
| **Ganada** — el banco nos dio la razón | `succeeded` | vuelve a descontar ese dinero |
| **Perdida** — el banco lo retiró | `failed` | sigue debiéndolo y vuelve a la reclamación |

Perdida deja el cobro **fallido** y no `refunded`: un reembolso lo devolvemos
nosotros y esto no lo devolvimos nosotros. Tampoco se borra la fila, porque ese
dinero sí llegó. Su `disputed_at` y su motivo se quedan intactos, de modo que el
historial del cobro pueda decir que entró, se disputó y acabó así.

El desenlace se elige a mano y no se deduce del saldo. Adivinar cuál fue a
partir de cómo quedaron las cifras sería inventarse el final.

`resolveDispute()` no toca `invoices` en absoluto: recalcula con `resync()`, que
es quien sabe si queda alguna **otra** disputa viva en la misma factura. Por eso
no puede desincronizarse del estado de la factura, y por eso un guardián exige
que ese método no contenga `DB::table('invoices')`.

### Y deja de contarse donde no debe

- `notifications:sweep` añade `disputed` a su lista de exclusión, ahora con
  nombre propio (`FUERA_DE_RECLAMACION`) y su motivo escrito al lado.
- `PeriodReport` mantiene la cláusula `disputed_at` —que por fin se dispara— y
  añade `disputed` a `NUNCA_FUE_DINERO`, para que los dos mecanismos sean
  independientes en vez de taparse el uno al otro.

### Se ve, y con su motivo

La ficha de factura pinta un aviso con el motivo y la fecha. «En disputa» a
secas obliga a ir a buscar a qué cobro y por qué, y una factura en disputa se
parece demasiado a una vencida como para distinguirlas por una etiqueta.

El botón de cerrar la disputa vive en su propio bloque de la tarjeta del cobro y
no en la barra de acciones de siempre: esa barra solo se pinta para los cobros
NO cerrados, y «en disputa» cuenta como cerrado. Moverlo allí lo haría
desaparecer sin romper nada más, así que el guardián fija la condición exacta.

## Lo medido

Sobre los datos de demostración, con la factura `INV-01001`:

| | cartera | barredora | estado |
|---|---|---|---|
| Antes de disputar | 31.600 | — | `sent` |
| Con la disputa viva | 31.600 | no la reclama | `disputed` |
| Cerrada como perdida | 71.536 | la reclama | `overdue` |

La diferencia de 39.936 es el total de la factura volviendo a la cartera cuando
deja de estar en litigio, que es exactamente lo que debe pasar si la disputa se
pierde: ese dinero se debe y nadie lo ha pagado.

Ganada, el cobro vuelve a `succeeded`, la factura recupera su saldo parcial y la
marca de disputa se retira de la factura.

## Verificación

- **19 sabotajes, 19 cazados.** Uno de ellos —quitar la cláusula de la cartera—
  dejó la prueba de funcionalidad en verde y así destapó el segundo agujero de
  `paidAsOf()`. Ver `docs/testing.md`.
- Suite completa en verde dos veces: **1788** pruebas, 10.554 aserciones.
- `tsc` limpio; `pint` limpio sobre los ficheros del lote.
- Recorrido por el navegador en español y en inglés, disputando y cerrando un
  cobro real de la demostración por los dos desenlaces, y datos restaurados
  después.

## Lo que esto NO es

- **No hay estado `chargeback`.** Una disputa perdida deja el cobro como
  `failed`, que dice «este dinero no está» y no dice «se lo llevó el banco». La
  fila conserva su `disputed_at` y su motivo, así que la historia se puede
  reconstruir, pero un estado propio sería más preciso. Deuda con nombre.
- **La cartera refleja las disputas como están HOY, no como estaban a la fecha
  del informe.** `disputed_at` se borra al cerrarse la disputa, así que un
  informe de un mes pasado ya no excluirá una factura que entonces estaba en
  litigio y ahora no. Guardar el histórico de disputas es otro lote; lo
  alternativo —no borrar nunca la marca— sería peor, porque excluiría para
  siempre una factura que hace meses que se resolvió.
- **`uncollectable` sigue sin escritor.** El filtro de facturas lo ofrece, el
  diccionario lo traduce, la cartera lo excluye y no hay forma de llegar a él:
  no existe la acción de dar una factura por incobrable. Igual que `due`. Y en
  comisiones, igual `approved` y `voided`. Este lote cierra uno de los seis
  estados fantasma; los otros cinco siguen ahí.
- **Una factura marcada «vencida» no vuelve a «enviada» si se le corrige la
  fecha de vencimiento hacia adelante.** `statusFor()` conserva el estado
  actual cuando el saldo no manda, y `overdue` no está entre los que vuelven.
  Es anterior a este lote y no se ha tocado aquí.
- **La disputa no avisa a nadie.** Marcarla no manda notificación: solo saca la
  factura de la reclamación nocturna. Quién tiene que enterarse de que hay un
  contracargo abierto es una decisión de la empresa, no del software.
