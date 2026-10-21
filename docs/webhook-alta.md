# El webhook del alta de transportista

Lote 47. Cuando alguien se da de alta en la página pública de una casa de
despacho, mandamos ese envío a una URL que ella elija, firmado.

---

## Qué se manda, y cuándo

Evento `carrier.signup.submitted`, un `POST` con `Content-Type:
application/json`, en cuanto el alta queda guardada.

```json
{
  "event": "carrier.signup.submitted",
  "occurredAt": "2026-10-21T13:44:08+00:00",
  "lead": { "id": "9f1c…", "locale": "es" },
  "carrier": {
    "legalName": "Transportes del Valle LLC",
    "dba": null,
    "dotNumber": "2345672",
    "mcNumber": "765432",
    "website": null,
    "contactFirstName": "Rosa",
    "contactLastName": "Peña",
    "email": "rosa@valle.test",
    "phone": "+1 555 0199",
    "address": {
      "line1": "400 Depot Rd", "line2": null,
      "city": "Doral", "state": "FL", "postalCode": "33172", "country": "US"
    },
    "preferredLocale": "en",
    "usesFactoring": true,
    "factoringCompany": "Tesorería del Norte LLC"
  }
}
```

Lo del alta y nada más. **No va el identificador interno de la empresa**, ni
datos de otros prospectos. Va el identificador del prospecto porque es lo que el
receptor necesita para no darlo de alta dos veces.

En **goliathdispatch.com** no hay webhook: no hay empresa, así que no hay
ajustes donde configurarlo. Es la misma decisión que toma `Arrival::announce`.

---

## La firma

```
X-Goliath-Signature: t=1761048000000,v1=<hex>
X-Goliath-Event: carrier.signup.submitted
X-Goliath-Delivery: <uuid de la entrega>
X-Goliath-Attempt: 1
```

donde `<hex>` es `HMAC-SHA256(secreto, "<t>.<cuerpo crudo>")`.

**El momento va dentro de lo firmado.** Firmar solo el cuerpo deja la puerta
abierta a la repetición: quien capture una entrega puede reenviarla mañana,
idéntica y con la firma válida, y el receptor daría de alta al mismo
transportista otra vez.

### Lo que el receptor tiene que hacer, y no podemos hacer por él

1. Firmar **el cuerpo crudo**, no el JSON re-serializado. Un espacio de
   diferencia cambia el hash.
2. Comparar con una función de **tiempo constante** (`hash_equals`,
   `crypto.timingSafeEqual`), nunca con `==`.
3. **Rechazar lo que llegue fuera de su ventana** de tolerancia —cinco minutos
   es razonable—, que es lo que convierte la marca de tiempo en una defensa.

```php
$t = …;                      // de la cabecera
$esperada = hash_hmac('sha256', $t.'.'.$cuerpoCrudo, $secreto);

if (! hash_equals($esperada, $firma) || abs(time() * 1000 - $t) > 300_000) {
    http_response_code(400);
    exit;
}
```

Un esquema de firma que el receptor implementa mal no protege nada, y eso no se
arregla desde este lado.

### Lo que la firma NO es

No es cifrado —el cuerpo viaja legible dentro de TLS— ni autenticación del
receptor: que alguien reciba la carga no prueba quién es.

---

## El secreto

Se crea desde Ajustes, con el botón de **Crear**, y **se enseña una sola vez**.
Después:

- vive **cifrado** en `tenant_settings.carrier_signup_webhook_secret_encrypted`,
  igual que el identificador fiscal de un cliente;
- la pantalla solo enseña los **cuatro últimos** —«acabado en ····5e08»— para
  poder decir cuál hay puesto sin enseñarlo;
- la **pista de auditoría** anota que cambió, nunca el valor;
- no viaja por la bolsa `flash` compartida —esa va en las props de todas las
  páginas— sino como una propiedad de la pantalla de ajustes que se **saca** de
  la sesión al leerla, así que recargar ya no lo enseña.

Dejar el campo vacío al guardar **conserva** el que haya. Si «vacío» significara
«bórralo», cambiar la URL dejaría a la casa sin firma sin que nadie lo pidiera.

---

## La validación de destino (SSRF)

Un administrador —o alguien que le haya tomado prestada la sesión— escribiendo
`http://169.254.169.254/latest/meta-data/…` convierte nuestro servidor en su
cliente HTTP contra la metadata de la nube, desde dentro de la red.

`App\Support\Webhooks\SafeUrl` pone cuatro defensas, y hacen falta las cuatro:

| | Qué | Por qué |
|---|---|---|
| 1 | Solo `https` | Lo que viaja lleva nombre, correo y teléfono de una persona. Y de paso cierra `file://`, `gopher://`, `dict://` |
| 2 | Nada de `usuario:clave@` | Manda esas credenciales a quien conteste, y sirve para disfrazar el destino |
| 3 | **Todas** las direcciones a las que resuelve el nombre tienen que ser públicas | `interno.ejemplo.com` puede resolver a `10.0.0.5`, y un atacante controla su propio DNS. Si bastara «la primera que valga», publicaría dos |
| 4 | Se **congela** la dirección comprobada (`CURLOPT_RESOLVE`) | Entre resolver para validar y resolver para conectar, el mismo nombre puede pasar a contestar otra dirección: es el «rebinding de DNS» |

Y **no se siguen redirecciones**: un 302 a `169.254.169.254` se saltaría entera
la validación.

Rangos rechazados: `0.0.0.0/8`, `10/8`, `100.64/10` (CGNAT), `127/8`,
`169.254/16`, `172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`, multicast y
reservados; en IPv6 `::`, `::1`, `fc00::/7`, `fe80::/10`, y una IPv4 disfrazada
de IPv6 se juzga como IPv4.

La URL se comprueba **al guardarla** —para poder decir el motivo con el campo
delante— y **otra vez al entregarla**, porque un nombre que hoy es público puede
apuntar mañana a otro sitio.

### Lo que esto NO garantiza

Que el destino sea de quien dice ser. Una IP pública puede ser de cualquiera, y
un receptor legítimo puede estar comprometido. Esto cierra la puerta a la red
interna; no certifica al que está al otro lado.

---

## Cómo se entrega: un barrido, no una cola

Este proyecto **no tiene cola**: ni `app/Jobs`, ni un solo `ShouldQueue`, ni un
worker en Forge. Un webhook montado sobre una cola que nadie consume se
«dispara» y no llega nunca — que es justo el fallo que este lote existe para no
cometer.

Lo que sí hay es el planificador, que ya corre `notifications:sweep` y
`retention:sweep`. El webhook va por ahí:

```
Schedule::command('webhooks:deliver')->everyMinute()->withoutOverlapping()->onOneServer();
```

El alta **anota** la entrega pendiente y no toca la red. Si saliera ahí, el
tiempo de respuesta del formulario público dependería del servidor de otro, y un
receptor caído dejaría colgada a la persona que acaba de pulsar enviar.

### Reintentos

`1 min → 5 min → 15 min → 1 h → 6 h → 24 h`, seis intentos. Después, `abandoned`.

- Un **5xx** o un fallo de red se reintenta.
- Un **4xx** NO, salvo **408** y **429**, que son
  «ahora no». El resto es el receptor diciendo que la petición está mal, y
  mañana estará igual de mal.
- Un destino que ya no pasa la validación se abandona **al primer intento**, con
  el motivo escrito: no mejora reintentando.

### `sending`, y por qué hace falta rescatarlo

Las filas se **reclaman** en la base antes de salir a la red, para que dos
pasadas solapadas no manden la misma dos veces — un transportista duplicado en
el CRM de alguien es un problema de verdad.

Y si el proceso se cae con la petición en vuelo, la fila se queda en `sending`
para siempre. Por eso el propio barrido **rescata** lo que lleve más de quince
minutos ahí. Un estado intermedio sin rescate es una fuga lenta: la entrega se
pierde y la pantalla enseña que sigue trabajando.

---

## El registro de entregas

`webhook_deliveries` guarda cada intento: a dónde fue, con qué carga, cuántos
intentos, qué código contestó, qué error, y cuándo toca el siguiente.

Un webhook sin registro es una promesa que nadie puede auditar: falla en
silencio durante meses y se descubre cuando falta medio CRM, y para entonces ya
no se puede reconstruir qué se perdió.

**La URL y la carga viajan congeladas en cada fila.** Si al reintentar se
leyeran de los ajustes, cambiar el destino a mitad reescribiría el pasado: el
registro diría que fue a donde apunta hoy la configuración y no a donde fue de
verdad.

El **cuerpo de la respuesta** se guarda truncado a 500 caracteres y **no viaja a
la pantalla**: lo escribe un tercero y acabaría pintado dentro de nuestro panel.
El código de estado y el motivo acotado bastan para saber qué pasó.

---

## Lo que la pantalla dice, y por qué no es un semáforo

Cuatro cosas por separado, porque significan cosas distintas:

| Lo que se pinta | Qué contesta |
|---|---|
| URL, secreto (····últimos 4), casilla | Lo que dice la **configuración** |
| «El barrido no ha corrido nunca» / «corrió el …» | Si hay algo **entregando** |
| «N esperando a entregarse» | Cuánta **cola** hay |
| «N se dieron por perdidas» | Cuánto se **perdió** |
| «Última entrega de un alta real: …» | Si las altas **están llegando** |

Un verde único que los junte es una garantía inventada. Es la misma decisión que
tomó `RevalidationState` con FMCSA, y por lo mismo.

**Un envío de prueba no cuenta como entrega real.** Una prueba correcta dice que
la URL funciona, no que los transportistas estén llegando al CRM. Si contara, un
«todo bien» taparía justo lo que hay que mirar.

El botón de **Mandar prueba** sale a la red en directo —quien acaba de pegar una
URL quiere saber si funciona antes de irse de la pantalla— y tiene su propio
tope de peticiones: sin él, ese botón es un cliente HTTP a demanda contra
cualquier destino público.

---

## Lo que la base impide

- `carrier_signup_webhook_enabled = 1` sin URL o sin secreto. Un webhook
  «activo» sin URL es una casilla marcada que no manda nada, y uno sin secreto
  manda carga sin firmar a un tercero que no puede comprobar de dónde viene.
- Un `status` fuera de `pending | sending | delivered | failed | abandoned`.

---

## Lo que hace falta en el servidor

1. **La línea de cron del planificador.** Sin ella no se entrega nada, y la
   pantalla de Ajustes lo dice con todas las letras.
2. Nada más. El secreto lo crea cada casa desde su pantalla.
