# La tarifa que nadie contestaba

## El defecto

La pantalla en la que el transportista responde a la confirmación de tarifa le
pide el motivo con esta frase, en los dos idiomas:

> Rejecting or requesting changes needs a reason. **Without one, dispatch has to
> call to find out what happened.**
>
> Rechazar o pedir cambios necesita un motivo. **Sin él, despacho tiene que
> llamar para averiguar qué pasa.**

Es un trato: escribe el motivo y te ahorras la llamada. Y escribirlo no ahorraba
ninguna llamada.

```
$ grep -c "Notifier\|Mail::\|notif" app/Http/Controllers/App/RateConfirmationController.php
0
```

`decide()` guardaba la decisión y el motivo en `rate_confirmation_acceptances` y
no avisaba a nadie. En el catálogo de sucesos de la pantalla de avisos no había
ni un solo `rateconf.*`.

La confirmación de tarifa es el papel por el que se compromete el dinero de una
carga. Un «rechazado» o un «pido cambios» es exactamente lo que la deja parada —
y despacho se enteraba solo si se le ocurría abrir esa carga por otro motivo.

## El segundo silencio

Si el transportista no contesta **nada**, tampoco pasa nada: no hay estado que
cambie, ni color que se encienda, ni fila que se mueva de sitio. La carga se
queda quieta con una tarifa que nadie ha comprometido.

## Lo que se hizo

**`App\Support\Loads\RateResponse`** avisa a quien tenga `load:financials:update`
—el mismo permiso que hace falta para EMITIR el papel— con un suceso por cada
decisión. El motivo viaja dentro del aviso, recortado a 160 caracteres.

**El barrido** gana `tarifasSinContestar()`: `load.rateconf.unanswered` para los
papeles emitidos hace más de 3 días sin ninguna respuesta, en cargas que
todavía esperan algo.

## Las cuatro decisiones que importan

### 1. Los sucesos salen del enum, no de una lista a mano

```php
$claves = array_map(self::sucesoDe(...), RateConfirmation::DECISIONES);
```

Si mañana aparece una cuarta decisión, el guardián exige su rótulo en los dos
idiomas y su casilla de preferencias antes de dejarla pasar — en vez de que se
mande un aviso sin nombre, o no se mande ninguno.

### 2. Se avisa a quien manda el papel

`load:rateconf:respond` es `Scope::Carrier`: no lo tiene nunca nadie de la casa.
Avisar a sus titulares habría sido avisar al propio transportista de lo que
acaba de contestar. La simetría correcta es `load:financials:update`, que es lo
que exige `issue()`.

### 3. La deduplicación lleva la tarifa dentro

```php
dedupeKey: self::sucesoDe($decision).':'.$carga->id.':'.($carga->carrier_gross_rate_cents ?? 0),
```

El transportista puede rechazar hoy y aceptar la reemisión de mañana. Con la
carga sola en la clave, la segunda no sonaría — y la segunda es precisamente la
que dice que la carga ya puede moverse.

### 4. La persecución cruza por PAPEL, no por carga

```php
->whereNotExists(fn ($q) => $q->select(DB::raw(1))
    ->from('rate_confirmation_acceptances as a')
    ->whereColumn('a.document_id', 'd.id'))
```

Cada emisión es un documento nuevo, no una versión del anterior. Cruzando por
`load_id`, una respuesta al papel viejo daría por contestada una reemisión que
nadie ha mirado — y esa es justamente la carga que se queda parada.

## Lo que queda fuera, y se dice

- **El correo depende del proveedor.** El aviso se escribe siempre; que además
  salga por correo depende de que la instalación tenga credenciales de envío.
- **Tres días es un número elegido, no medido.** Menos convierte el aviso en una
  prisa sobre alguien que quizá está mirando el papel; más deja una carga parada
  casi una semana. No sale de ninguna política de la empresa, y hoy no es
  configurable por empresa.
- **El corte de 30 días hacia atrás** evita que, el día que este barrido empiece
  a correr, suelte de golpe todo lo que lleva sin contestar desde el principio.
  El precio es que lo muy viejo no se desentierra nunca.
- **Nadie reemite ni llama solo.** El aviso dice qué pasó; qué hacer con ello es
  una decisión de una persona.
- **La carga no cambia de estado por un rechazo.** Sigue donde estaba. Lo que
  cambia es que alguien se entera.

## Ficheros

| Fichero | Qué hace |
|---|---|
| `app/Support/Loads/RateResponse.php` | **Nuevo.** El único sitio que decide a quién se le cuenta la respuesta del transportista. |
| `app/Http/Controllers/App/RateConfirmationController.php` | Avisa tras anotar la decisión. |
| `app/Console/Commands/SweepNotifications.php` | `tarifasSinContestar()` y su total impreso. |
| `app/Http/Controllers/App/NotificationController.php` | Los cuatro sucesos, en el catálogo de preferencias. |
| `lang/{en,es}/notifications.json` | Los cuatro sucesos, con `eventNames`. |
| `tests/Unit/Suite/RateResponseTest.php` | **Nuevo.** 15 guardianes, 17 sabotajes en rojo. |
| `tests/Feature/RateConfirmation/RateResponseTest.php` | **Nuevo.** 14 pruebas del recorrido completo. |
