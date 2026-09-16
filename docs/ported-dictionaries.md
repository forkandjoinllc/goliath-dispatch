# Lo que los diccionarios portados dicen que falta

## Qué son

Nueve ficheros de idioma —`assignment`, `carrier`, `customer`, `document`,
`driver`, `finance`, `load`, `notification`, `report`— que **ninguna pantalla
puede cargar**: 1.522 claves por idioma, 3.044 en total. Vinieron del puerto con
el vocabulario completo de la aplicación original.

No son basura y no se borran. Son, en la práctica, **media especificación de los
dominios que faltan**, y ya han pagado: de `notification.json` salió que
`document.expired` es un suceso APARTE de `document.expiring` —el matiz que
dejaba un aviso diciendo «renuévelo antes de que venza» sobre un documento ya
caducado—, y de `driver.json` salieron las tres tablas de la licencia, que la
pantalla enseñaba como letras sueltas («H, N, T»).

Lo que sí cuesta caro es **no leerlos**, y lo que cuesta todavía más es
**citarlos como si alguien los viera**: cinco frases falsas han salido de ahí en
los tres últimos lotes, incluidas dos que yo mismo traje como titular antes de
comprobar quién las leía.

## Lo que traen y aquí no está

### `finance` (382 claves) — el mayor, y el que nadie había mirado

Su dominio se construyó repartido en `invoices`, `payments`, `settlements`,
`commissions`, `expenses` y `factoring`, y por eso el guardián no lo emparejaba
con nada. Tres cosas suyas no están construidas:

1. **El estado de cuenta del transportista.** Un registro continuo —fecha,
   concepto, importe y **saldo acumulado**— que cruza las liquidaciones emitidas
   con las facturas cobradas. Es lo que daría sentido al método de pago
   «compensación contra liquidación», que hoy se puede anotar y no tiene nada al
   otro lado: se marca la factura como cobrada y ninguna liquidación se entera.

2. **Las clases de línea de factura.** El esquema admite cuatro
   —`dispatch_fee`, `expense`, `adjustment`, `credit`— y `InvoiceBuilder` solo
   escribe la primera; `adjustments_cents` se escribe siempre en cero. No hay
   forma de emitir una nota de crédito salvo anular la factura y rehacerla, ni
   de que un gasto rebotado al cliente aparezca como su propia línea.

3. **El PDF.** La factura sale por correo como enlace, sin adjunto, y de la
   liquidación no se genera ninguno. El portado da por hecho los dos
   («¿Enviar esta factura … con un PDF adjunto?», «Se generará un estado de
   cuenta en PDF»). El generador de PDF existe —lo usan las firmas y la
   confirmación de tarifa—, así que es trabajo de conectar, no de construir
   desde cero.

### `notification` (104 claves) — siete avisos que el original manda y este no

`export.ready`, `invoice.sent`, `load.assigned`,
`load.rate_confirmation_requested`, `onboarding.approved`,
`onboarding.rejected`, `signature.requested`.

> **Eran diez.** `document.rejected`, `expense.rejected` y
> `onboarding.corrections_required` se construyeron en lotes posteriores, y este
> párrafo —y la entrada del registro— siguieron diciendo diez durante meses. Es
> el caso que hizo que los repasos dejaran de ser prosa: desde el lote de «los
> repasos que dejaron de ser ciertos», la lista se recalcula contra
> `Events::CATALOGO` y construir uno pone la suite en rojo hasta que se encoge.
> Lo que sigue se conserva porque el argumento vale igual, y porque `Notifier`
> sigue sin tener vía para avisar a un transportista de lo suyo.

**El más caro era `document.rejected`, y merece leerse de todos modos.** Al rechazar
un documento, la pantalla EXIGE al revisor un motivo de diez caracteres como
mínimo, con este argumento escrito en la propia copia:

> «Diga qué le falta o qué está mal — al menos diez caracteres. **El
> transportista lo va a leer**, y "rechazado" a secas garantiza una segunda
> subida igual de mala.»

El motivo se guarda y se puede leer: sale en el historial de revisiones de la
ficha del documento, con el nombre de quien decidió. Lo que no hay es **nada que
le avise**. Se entera si abre ese documento, y la razón por la que abriría ese
documento es que alguien le hubiera dicho que lo mirara.

O sea: el producto le pide trabajo a una persona —escribir una explicación
útil— en nombre de un lector al que nunca se le anuncia que existe.

Construirlo no es solo escribir el aviso: `Notifier` elige destinatario **por
permiso dentro de la empresa** y excluye a propósito el alcance de
transportista («avisarle de que hay facturas vencidas le contaría que existen
las de los demás»). Avisar al transportista de lo suyo exige una vía nueva
—destinatarios de UN transportista— con el aislamiento que eso pide. **Es una
decisión de producto y está abierta.**

### `load` (283 claves) — cuatro vistas de la lista

Tablero, calendario, mapa y línea de tiempo, cada una con su estado vacío. Aquí
hay una lista. Sus tipos de documento sí se adoptaron en su día.

### `report` (150 claves) — cinco informes con nombre

Un selector con cinco informes que no existen. `reports.json` es otro producto
—el informe por periodo— y no toma nada de él.

### `carrier` (138) — el OCR del certificado

`compliance.ocrFailed`: «no se pudo escanear el certificado de seguro para
confirmar este VIN». No hay OCR en ninguna parte, y `Equipment\Verification` lo
dice con todas las letras: «las columnas `extracted_vins`, `ocr_provider` y
`ocr_confidence` existen y se quedan vacías».

### `driver` (132), `document` (152), `customer` (121), `assignment` (60)

Ya mineados o sin solape. Lo suyo sin construir: el portal del conductor, la
relación de un conductor con varios transportistas y la revisión de licencia.

De `document` **no queda ningún tipo por construir**: los veintisiete están en
`Documents\DocumentTypes`, `invoice` incluido. Este párrafo decía que faltaba,
y para cuando alguien volvió a leerlo ya se había construido — el segundo de
los dos repasos que se quedaron obsoletos por haber hecho el trabajo que
describían. Ahora se recalcula.

El detalle, en el registro de `tests/Unit/I18n/PortedDictionariesTest.php`, que
es donde vive y donde un guardián lo mantiene honesto — ahora midiendo, no solo
exigiendo que la frase exista.

## Por qué esto estaba sin hacer

El guardián que obliga a repasarlos existía, y emparejaba `X.json` con
`Xs.json`. Con esa regla:

- cuatro repasos se declararon «Pendiente de repasar» y ahí se quedaron;
- **`finance.json`, el mayor, no tiene plural**: su dominio se llama
  `invoices`, `payments`, `settlements`… así que nunca se emparejó con nada, y
  la prueba decía que todo estaba repasado.

Ahora la lista **se deduce**: un portado es un espacio que ninguna pantalla
declara, ningún `__()` del servidor lee y ningún `t()` del cliente cita. Si
alguien añade un diccionario que nadie carga, el guardián lo pide repasado. Y un
repaso ya no puede decir «pendiente»: hay una comprobación que lo rechaza.

## Cómo usar esto

Antes de construir un dominio, abra su portado. Trae estados y matices que no se
le ocurren a uno —y los trae en los dos idiomas—. Al terminar, escriba en el
registro qué tomó de él.

Y al citar una frase de un portado: **no la lee nadie**. Compruebe quién pide la
clave antes de traerla como prueba de algo.
