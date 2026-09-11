# La promesa del vencimiento, que era verdad en su primera mitad

> Este lote NO enciende ninguna puerta nueva. Hace que las pantallas digan la
> verdad sobre las que hay. Que el registro de un camión vencido deba parar una
> carga es una decisión de producto —y el día que se tome parará cargas en
> cualquier empresa con un papel caducado—; se decide mirándola de frente, no
> de propina dentro de un lote de honestidad.

## El defecto

El formulario de subir un documento dice, justo debajo de la casilla donde se
teclea la fecha de vencimiento:

> Se le avisará {days} días antes, y la puerta de despacho bloquea en cuanto
> vence.

La misma frase para los diecisiete tipos que ofrece su desplegable.

**La primera mitad es verdad para todos.** `SweepNotifications::documentosQueCaducan()`
recorre `documents` sin mirar el tipo: cualquier documento con fecha genera su
aviso.

**La segunda es verdad para tres.**

```
$ grep -rn "documentCompliance(" app/
app/Support/Loads/Guards.php:229:  ...self::documentCompliance('carrier', $carrierId)
app/Support/Loads/Guards.php:258:  private static function documentCompliance(...)
```

Una sola llamada en todo el proyecto, con `'carrier'`. Y dentro, solo se miran
los tipos que `DocumentTypes::requiredFor('carrier')` declara obligatorios. De
los diecisiete que el formulario ofrece:

| Bloquean al vencer (3) | Solo avisan (14) |
|---|---|
| `certificate_of_insurance` | `w9`, `notice_of_assignment`, `change_of_payee`, `other_onboarding`, `other` |
| `certificate_of_authority` | `cdl_front`, `cdl_back`, `medical_card`, `driver_other` |
| `carrier_agreement` | `truck_registration`, `trailer_registration`, `annual_inspection`, `equipment_photo`, `equipment_video` |

### Lo que hay debajo de esa tabla

**Del conductor, la puerta mira COLUMNAS, no documentos.** `driverCompliance()`
consulta `drivers.license_expires_at` y `drivers.medical_card_expires_at`. Un
`cdl_front` vencido con la columna al día pasa; y al revés. Son dos verdades
sobre la misma licencia, guardadas en sitios distintos, y pueden discrepar sin
que nada lo note.

**Del camión y del remolque no se mira nada.** `forDispatch()` exige que haya
camión asignado y para ahí. No hay comprobación de vencimiento, ni por documento
ni por columna.

**Y `truck_registration`, `trailer_registration` y `annual_inspection` están
declarados OBLIGATORIOS.** Salen con su estrella en el desplegable —la que
significa «esto hace falta»— y ninguna puerta consulta `requiredFor('truck')`
ni `requiredFor('trailer')`. Es una declaración que no lee nadie.

### Por qué media promesa es peor que una entera

Quien sube un certificado de seguro ve la frase, comprueba que es verdad —la
carga se para— y aprende que el producto vigila los vencimientos. La próxima
vez sube el registro del camión, lee la misma frase, y deja de apuntarlo en su
calendario. **La mitad que se cumple es lo que hace creíble la que no.**

## Lo que hace ahora

### `ExpiryEffect`: qué pasa de verdad cuando algo vence

Dos respuestas —`BLOQUEA` y `SOLO_AVISA`— y una sola cosa declarada a mano:

```php
public const DUENOS_VIGILADOS = ['carrier'];
```

Todo lo demás se **calcula** de las mismas funciones que consulta la puerta:

```php
foreach (self::DUENOS_VIGILADOS as $dueno) {
    if (in_array($type, DocumentTypes::requiredFor($dueno), true)) {
        return self::BLOQUEA;
    }
}

return self::SOLO_AVISA;
```

La tentación era una lista de tipos con su efecto al lado. Una lista así es una
**segunda opinión sobre el comportamiento**, y las segundas opiniones divergen:
el día que alguien haga que la puerta mire los camiones, la lista seguiría
diciendo lo de siempre y la pantalla volvería a mentir, esta vez al revés.

Se pregunta por todos los dueños vigilados y no por el que el catálogo asigna,
porque un tipo puede pertenecer a dos: `forOwner('trailer')` añade
`annual_inspection`, declarado para camión.

### El guardián que ata la lista al comportamiento

```php
preg_match_all("/self::documentCompliance\('([a-z_]+)'/", $puerta, $m);
expect(array_unique($m[1]))->toBe(ExpiryEffect::DUENOS_VIGILADOS);
```

El día que aparezca un `documentCompliance('truck', ...)`, esto se pone rojo
hasta que `DUENOS_VIGILADOS` lo recoja — y entonces la copia de las dos
pantallas se corrige sola, porque sale calculada de ahí. Es el sabotaje número
7 de la campaña, y es la razón de ser del lote.

### `SIN_VIGILAR`: el hueco, con su nombre

```php
public const SIN_VIGILAR = [
    'driver' => 'La puerta mira las columnas `license_expires_at` y `medical_card_expires_at`…',
    'truck' => 'No se mira nada. `truck_registration` y `annual_inspection` están declarados obligatorios y ninguna puerta los consulta.',
    'trailer' => 'No se mira nada. `trailer_registration` está declarado obligatorio y ninguna puerta lo consulta.',
];
```

Un hueco sin nombre se lee como un descuido y se arregla dos veces, o como una
decisión y no se arregla nunca. Esto dice cuál de las dos cosas es. El guardián
exige un motivo por cada dueño del formulario que no esté vigilado, y prohíbe
poner excusa a uno que sí lo esté.

### Las pantallas

`documents.form.expirationHint` era **una** clave y ahora son **tres**:

- `expirationHintPick` — todavía no se ha elegido tipo. «Se le avisará N días
  antes. Si además bloquea el despacho al vencer depende del tipo — elija uno
  arriba.» Dejarlo en blanco hasta elegir sería quitarle la mitad verdadera.
- `expirationHintBlocks` — el texto de siempre, ahora solo donde se cumple.
- `expirationHintWarns` — «…Este tipo no cierra ninguna puerta al vencer: las
  cargas se siguen despachando.»

La ficha del documento lo dice también, y el conductor lleva **frase propia**:

> Al vencer se avisa, y no se bloquea ningún despacho. Lo que sí para una carga
> es la fecha de la licencia o de la tarjeta médica de la ficha del conductor,
> que se guarda aparte de este documento.

Decirle «no se comprueba nada» sería la mentira contraria: de un conductor sí
se comprueba, en otro sitio y sobre otro dato. Quien lee esto sabe dónde
mirar.

La clave vieja se retira de los dos diccionarios, y un guardián exige que no
vuelva: dejarla suelta invita a volver a usarla.

## Dos guardianes anteriores se pusieron rojos, y con razón

`DurationsInCopyTest` y `WarnDaysInCopyTest` vigilaban que `expirationHint`
recibiera el plazo de la empresa en vez de llevarlo escrito —el defecto de un
lote anterior, donde el texto decía «45 días» y el ajuste valía 30—. Al partir
la clave en tres, las dos apuntaban a algo que ya no existe.

No se relajaron: ahora **le exigen lo mismo a las tres**, y además que la clave
partida no vuelva. Un guardián que se pone rojo porque el código cambió de forma
es un guardián que funciona; la salida fácil habría sido borrar su aserción.

De paso, la copia inglesa nueva decía «days ahead» y el resto del producto dice
«days before». Se alineó con el producto, no con mi preferencia.

## Verificación

- **17 sabotajes, 17 cazados.**
- Suite completa en verde dos veces: **1804** pruebas, 10.669 aserciones.
- `tsc` limpio; `pint` limpio sobre los ficheros del lote.
- Recorrido por el navegador en los dos idiomas: las tres frases del formulario
  con sus tipos reales, y la ficha de tres documentos —uno del transportista,
  uno del conductor y uno del camión—, plantando los dos que faltaban en la
  demostración y retirándolos después.

## Lo que esto NO es

- **No cierra ninguna puerta nueva.** Catorce de los diecisiete tipos siguen
  venciendo sin parar nada. Lo que cambia es que ahora se dice.
- **No junta las dos verdades sobre la licencia del conductor.** La fecha de su
  ficha y la de su `cdl_front` siguen guardándose aparte y pueden discrepar. La
  ficha del documento ahora explica cuál manda, que es lo que se puede decir sin
  cambiar comportamiento. Unificarlas es otro lote, y el que de verdad arregla
  el problema.
- **La estrella del desplegable sigue significando «obligatorio»** y no «bloquea
  al vencer». Son dos cosas distintas y `cdl_front` es obligatorio de verdad
  para dar de alta a un conductor: quitarle la estrella sería otra mentira. Lo
  que faltaba era la segunda información, y ahora está.
- **`equipment_photo` y `equipment_video` no los mira nadie**, y la página
  pública dice que «las fotos del equipo se comprueban automáticamente antes de
  asignar una carga». Esa frase sigue siendo falsa después de este lote: es un
  lote propio, porque tiene dos salidas —retirarla o hacerla verdad— y la
  segunda cambia qué unidades pueden trabajar.
