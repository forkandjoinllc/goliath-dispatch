# Cómo acabó la firma, y quién se entera

## El defecto

La página que ve quien acaba de **rechazar** firmar decía, palabra por palabra:

> You have declined to sign this document. **The sender has been notified.**
>
> Usted ha rechazado la firma de este documento. **Se ha notificado al
> remitente.**

No le habían notificado. `Public\SignatureController::decline()` escribía la
fila, grababa el suceso de ceremonia, y no llamaba a nadie.

Eso no es una promesa vaga sobre el futuro. Es una **afirmación de hecho sobre
lo que otra persona ya sabe**, dicha a un tercero de fuera de la casa, y era
falsa. Quien la lee cierra el navegador tranquilo, porque le acaban de decir
que el asunto está en marcha.

Y el camino de vuelta estaba mudo en los dos sentidos:

```
Mailer::sendRequest()     → al firmante
Mailer::sendSignedCopy()  → al firmante otra vez
                          → a la casa, nada
```

En el catálogo de sucesos de la pantalla de avisos no existía ni un solo
`signature.*`.

## El segundo defecto, en la misma familia

`signature_requests.status` **no dice la verdad sobre el vencimiento**, y está
documentado en el propio código: *nada corre a medianoche a poner `expired` en
las filas*. `SigningLinks::resolve()` lo sabía y por eso miraba la fecha.

La lista de la casa no lo sabía, y pintaba `r.status` tal cual:

- Una solicitud que venció ayer seguía saliendo como **«Pendiente»** — que se
  lee como «estamos esperando a que firme». No se espera nada: al firmante ya se
  le cerró la puerta y no puede hacer nada aunque quiera.
- El filtro **«Vencida»**, pulsable en la barra, **no encontraba nada nunca**,
  porque ninguna fila llega a tener ese valor guardado.

Las dos mitades del mismo agujero. Arreglar solo «Vencida» habría dejado
«Pendiente» mintiendo igual, nada más que en otro sitio.

## Lo que se hizo

**`App\Support\Signatures\Outcome`** avisa a quien tenga `signature:request:read`
en esa empresa, con `signature.signed` o `signature.declined`. El motivo del
rechazo viaja **dentro** del aviso, recortado a 160 caracteres: sin él hay que
abrir la solicitud para saber si es «la tarifa» o «esta empresa no es la
nuestra». Completo sigue en la fila y en la pantalla adonde lleva el enlace.

**`App\Support\Signatures\State`** es la única regla del vencimiento. La aplican
los tres sitios que la necesitan: `SigningLinks` (cerrar la puerta), el
`rowPayload` de la lista (pintar), y el filtro (buscar).

**El barrido** gana `firmasQueVencieronSinFirmar()`: `signature.expired` para lo
que venció sin firmarse en los últimos 30 días.

## Las tres decisiones que importan

### 1. El estado se calcula, no se guarda

Se podría haber añadido una pasada que escribiera `expired` en las filas. No se
hizo, por dos razones:

1. Guardarlo hace que la verdad dependa de que un cron esté vivo. Este proyecto
   tiene una pantalla entera dedicada a que un cron muerto se note, lo que dice
   bastante sobre cuánto conviene apoyarse en uno.
2. Calculado, el minuto en que vence una solicitud es el minuto en que la lista
   lo dice — no «a la mañana siguiente, si corrió».

El precio es que hay **dos copias de la regla**: PHP para pintar, SQL para
filtrar. Dos copias de una regla se separan, así que hay una prueba que las
compara ejecutando las dos contra los mismos datos y exigiendo el mismo
resultado. Un sabotaje lo confirmó: al estrechar solo la rama SQL, la prueba
falla y dice **qué filtro** dejó de coincidir.

### 2. Los avisos van después del sello

`sign()` sella la firma en una transacción; el aviso se manda fuera. Una firma
hay que volver a pedírsela a una persona: no se pierde por un aviso que reventó.
Hay una prueba de que la firma queda sellada aunque no haya nadie a quien
avisar.

### 3. El corte de 30 días en el barrido

Sin él, el día que ese barrido empiece a correr avisaría de golpe de todo lo
vencido desde el principio de los tiempos. Una avalancha se archiva entera sin
leerla, que es lo mismo que no avisar.

## Lo que queda fuera, y se dice

- **El correo depende del proveedor.** El aviso se escribe siempre; que además
  salga por correo depende de que la instalación tenga credenciales de envío.
- **«Se ha notificado al remitente» es cierta mientras la empresa tenga alguien
  con `signature:request:read`.** El rol `admin` lo lleva en la matriz, así que
  en la práctica siempre lo hay; si una empresa se quedara sin ninguno, se
  escribirían cero avisos. El motivo del rechazo seguiría estando en la fila y
  en la pantalla de la solicitud.
- **Nada cierra una solicitud vencida.** Sigue sin haber un cambio de estado
  guardado, a propósito. Lo que hay ahora es que la lista no miente sobre ella y
  que suena una vez.
- **Nadie reenvía la solicitud automáticamente.** El aviso dice que hay que
  mandar una nueva; mandarla es una decisión de una persona.
- **No se avisa de `voided` ni de `superseded`.** Esas las provoca la propia
  casa, así que ya lo sabe.

## Ficheros

| Fichero | Qué hace |
|---|---|
| `app/Support/Signatures/Outcome.php` | **Nuevo.** El único sitio que decide a quién se le cuenta cómo acabó una firma. |
| `app/Support/Signatures/State.php` | **Nuevo.** La única regla del vencimiento, en PHP y en SQL. |
| `app/Support/Signatures/SigningLinks.php` | Deja de llevar su propia copia de la regla. |
| `app/Http/Controllers/Public/SignatureController.php` | Avisa tras firmar y tras rechazar, fuera de la transacción. |
| `app/Http/Controllers/App/SignatureController.php` | La lista filtra y pinta por el estado real. |
| `app/Console/Commands/SweepNotifications.php` | `firmasQueVencieronSinFirmar()` y su total impreso. |
| `app/Http/Controllers/App/NotificationController.php` | Los tres sucesos, en el catálogo de preferencias. |
| `lang/{en,es}/notifications.json` | Los tres sucesos, con `eventNames`. |
| `tests/Unit/Suite/SignatureOutcomeTest.php` | **Nuevo.** 15 guardianes, 16 sabotajes en rojo. |
| `tests/Feature/Signatures/OutcomeTest.php` | **Nuevo.** 13 pruebas del recorrido completo. |
| `tests/Feature/Platform/SchedulerHealthTest.php` | Arreglada una prueba que fallaba lunes y martes. |
