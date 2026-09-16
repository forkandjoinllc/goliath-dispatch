# El enlace de rastreo que caducaba a mitad del viaje

## El defecto

En la página que lee un cliente antes de contratar:

> Una vez despachada su carga, recibirá un enlace seguro por correo electrónico
> — no un usuario y contraseña. **Ábralo cuando quiera** para ver el estado
> desde la recolección hasta la entrega.

El enlace se emitía con `ttlHours: null`, que cae al plazo por omisión de la
empresa: **72 horas**. Y se mandaba una sola vez — `yaSeMando()` miraba si alguno
había salido, no si alguno seguía valiendo, así que un enlace vencido bloqueaba
para siempre el envío de otro.

En cualquier viaje de más de tres días, el cliente abre su enlace a mitad de
trayecto y lee «Enlace vencido». Nadie de la casa se entera.

## La misma forma que el lote del aviso de vencimiento

Esta frase **ya estaba declarada** en `PublicClaims::RESPALDOS`, con
`CustomerLink` de respaldo, desde el lote que amplió el vocabulario del detector
de promesas. Lo que se comprobó entonces fue la primera mitad: que el correo sale
al despachar, y que cuando no sale hay un aviso que lo dice.

La segunda mitad —«ábralo cuando quiera»— no la comprobó nadie. Es exactamente lo
que pasó con «se le avisará N días antes»: una frase arreglada a medias, con un
registro que la da por buena entera.

## La regla

El enlace vive hasta la **entrega prevista más el plazo de la empresa**, y nunca
menos que ese plazo.

- El margen de después no es adorno: el comprobante llega tarde y el cliente mira
  el estado el lunes siguiente. Un enlace que muere en el muelle no cumple la
  frase.
- El suelo tampoco: una carga cuya entrega prevista ya pasó daría un número
  negativo, y el enlace nacería muerto — un correo que no sirve para nada.
- Sin entrega prevista se cae al plazo de la empresa, que es lo que había. Una
  carga a la que nadie le puso fecha no puede inventarse una.

## Y la red de abajo

`enlacesVencidosEnLaCarretera()` corre cada noche: si una carga sigue rodando y
ya no le queda ningún enlace vivo, emite uno nuevo y lo manda. Es para lo que se
sale de la previsión — una entrega que se retrasa una semana deja el enlace
muerto con el camión todavía en la carretera.

Dos detalles que las pruebas sujetan:

- **Solo lo que sigue rodando.** Un enlace que se renueva solo para siempre es
  una dirección pública que nunca muere.
- **Solo lo que tuvo enlace.** Sin esa mitad de la condición, esto pisaría el
  trabajo de `enlacesQueNoSalieron()`, que avisa a la oficina cuando NUNCA salió
  ninguno — otro problema, y se arregla de otra manera.

Se emite uno nuevo en vez de reenviar el viejo porque el testigo no se guarda en
claro en ninguna parte, solo su hash. Reenviarlo es imposible por construcción, y
esa es una propiedad que conviene conservar.

## Y la página de vencido mandaba al sitio equivocado

> Este enlace de rastreo ha vencido. **Pídale a su transportista** un nuevo
> enlace de rastreo.

Quien le mandó el enlace es la casa de despacho. El cliente ni sabe quién lleva
el camión — y si lo supiera, el transportista no tiene forma de emitirle uno.
Ahora dice que escriba a quien le mandó el correo.

## Los guardianes

`tests/Unit/Suite/TrackingLinkLifeTest.php` — 5 comprobaciones: que la promesa
siga declarada con su respaldo y exista en los dos idiomas, que el plazo salga
del viaje y tenga suelo, que la pregunta sea «¿hay alguno vivo?» y no «¿salió
alguno?», que el barrido renueve solo lo que sigue en la carretera y solo lo que
tuvo enlace, y que la página de vencido no mande al transportista.

`tests/Feature/Tracking/LinkLifeTest.php` — 7 pruebas que emiten de verdad y
miran `expires_at`: el viaje de diez días, la carga sin fecha, la entrega ya
pasada, el vencido que ya no bloquea, el vivo que sí bloquea —despachar dos veces
no puede mandarle dos correos al cliente—, y el barrido renovando lo que rueda y
dejando en paz lo entregado.

**11 sabotajes, 11 rojos.**
