# «Se le avisará N días antes», a quien no se le avisaba nunca

## El defecto

El formulario de subir un documento promete, debajo de la casilla de fecha:

> Se le avisará **30** días antes, y la puerta de despacho bloquea en cuanto
> vence.

El aviso lo manda el barrido nocturno:

```php
Notifier::toPermissionHolders(permission: 'document:read', …)
```

y `Notifier::recipients()` solo mete a los roles cuyo alcance llega a
`Scope::Tenant`: **administrador y contabilidad**.

`document:upload` lo tienen, además de esos dos:

| Rol | Alcance de `document:read` | ¿Recibía el aviso? |
|---|---|---|
| Despachador | `Assigned` | no |
| Transportista | `Carrier` | no |
| **Conductor** | `Own` | **no** |

Los tres leían esa frase cada vez que subían un papel con fecha.

El caso caro es el conductor con su tarjeta médica. Lee que se le avisará, deja
de vigilar la fecha a mano —que es exactamente lo que la frase le invita a
hacer— y se entera el día que la puerta de cumplimiento le cierra la carga.

## Y el lote anterior lo dejó escrito al revés

El comentario que acompaña a ese texto lo puso el lote que arregló la SEGUNDA
mitad de la frase (la puerta solo bloquea en tres de diecisiete tipos):

> La primera mitad era verdad siempre; la segunda, en tres de diecisiete.

**No lo era.** La primera mitad era verdad para dos roles de cinco. Un comentario
falso en el sitio exacto donde vive el defecto es peor que no tener comentario:
es lo que hace que el siguiente lector no mire. Hay un guardián que comprueba que
esa frase ya no está.

## La regla que lo tapaba tenía buen motivo, para otra cosa

`Notifier` explica por qué exige alcance de empresa:

> el rol transportista tiene `invoice:read` con alcance Carrier, y avisarle de
> que «hay facturas vencidas» le contaría que existen las de los demás.

Es cierto **de un aviso agregado**. «Hay facturas vencidas» habla de un montón
que no es suyo. «Su certificado de seguro vence el 3 de marzo» habla de UN papel,
con su `subjectId`, que es suyo entero. La regla se escribió para el primer caso
y se aplicó a los dos.

Y el producto ya sabía distinguirlos: `document.rejected` SÍ le llega al
transportista, por `Notifier::toCarrier`. El mismo documento, el mismo dueño, el
mismo canal — y el vencimiento se quedó fuera.

## El reparto

`App\Support\Documents\DocumentAudience` clasifica los nueve dueños. El guardián
comprueba que la unión sea exactamente `DocumentOwners::all()`.

**Con alguien a quien avisar fuera de la oficina** — los cuatro que una persona
elige en el formulario, que son los mismos cuatro que `DocumentScope::carrierOf()`
sabe resolver: `carrier`, `driver`, `truck`, `trailer`.

**Solo de la oficina** — `load`, `expense`, `permit`, `route_survey`, `escort`.
Coincide con lo que `DocumentScope::forCarriers()` ya decidía: el transportista
no ve estos documentos desde la pantalla de documentos, y avisarle de algo que no
puede abrir es una campana que suena para nada.

La licencia de un conductor avisa a **los dos**, y por motivos distintos: la
renueva él, y su transportista es quien no puede mandarlo a rodar sin ella.

## La clave de deduplicación es la misma para los dos lados

El índice único es `(dedupe_key, user_id, channel)`. Compartir la clave no pisa
el aviso de nadie —son usuarios distintos— y sí impide que el mismo barrido
avise dos veces a una persona que esté en los dos caminos.

## Lo que NO se arregla, y se dice

El **despachador** sigue sin recibirlo. Tiene alcance `Assigned`, y meterlo
exigiría resolver, por cada documento y por cada despachador, si ese
transportista es de los suyos: `Notifier` tiene escrito por qué no monta un
`Actor` por miembro y por noche.

Está declarado en `DocumentAudience::SIN_AVISO_HOY` con su motivo — **y la
pantalla lo respeta**:

```
DESPACHADOR   Se avisará a la oficina 30 días antes. Este aviso no le llega a
              usted: hoy solo sale a quien lleva los documentos de toda la
              empresa, así que la fecha la sigue vigilando usted.
```

Una deuda que la pantalla respeta no es una mentira; es un hueco con nombre. Si
quieres cerrarlo, es tuyo: lo que hace falta es decidir si el despachador recibe
los de sus transportistas asignados y pagar la consulta que lo resuelve.

## La promesa se calcula con las reglas del emisor

El servidor manda `notifiedOwners`: los dueños cuyo vencimiento SE LE AVISA a
quien está mirando. La pantalla pregunta por esa lista y no deduce nada del rol
—deducirlo en React sería la copia parecida de siempre, y además el rol no está
en las propiedades de esa página—.

## El guardián que el código decía tener y no tenía

`DocumentScope::carrierOf()` lleva escrito desde que se creó:

> hay un guardián que compara las dos direcciones porque una tabla que se lee en
> dos sentidos se desincroniza sin que nadie lo note

**No lo había.** Hasta ahora daba casi igual: `carrierOf()` solo servía para
avisar de un rechazo. Ahora decide a qué transportista se le manda el vencimiento
de la licencia de un conductor, así que un error ahí es contarle a un
transportista lo del vecino. El guardián existe desde este lote, y lo escribió un
sabotaje: quité el `where('driver_id', …)` de esa consulta y **las doce pruebas
siguieron en verde**, porque todas plantaban un solo puente en la tabla.

## Los guardianes

`tests/Unit/Suite/ExpiryAudienceTest.php` — 9 comprobaciones: la clasificación
exhaustiva, que `tieneAvisados()` conteste lo que dicen las listas, que cada
dueño diga por qué, que el suceso declare los tres públicos, que el barrido traiga
al dueño en la consulta y use las dos vías, que la clave sea la misma, que la
pantalla prometa lo que el emisor cumple, que al despachador no se le prometa, y
que el comentario falso no vuelva.

`tests/Feature/Notifications/ExpiryAudienceTest.php` — 12 pruebas que corren el
barrido de verdad y cuentan filas en `notifications`.

**14 sabotajes, 14 rojos**, después de cerrar **tres escapes**:

1. `tieneAvisados()` devolviendo `true` a secas pasaba en verde: los papeles de
   una carga salían a buscar dueño y lo que los salvaba era que no lo
   encuentran. Una garantía por accidente.
2. Quitar el filtro de afiliación activa de `personaDe()` pasaba en verde porque
   `Notifier::toOwner` vuelve a mirarlo. Dos mecanismos que se tapan el uno al
   otro dan un resultado correcto hasta que uno cambia.
3. El `where('driver_id', …)` de `carrierOf()`, arriba.
