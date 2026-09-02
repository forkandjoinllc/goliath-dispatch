# El cliente: quién es su gente y en qué idioma se le escribe

## Tres defectos, y el tercero es de otra clase

**1. No se podía crear un contacto de cliente.** `customer_contacts` se leía en
dos sitios —la ficha del cliente y `CustomerLink`, que decide a quién mandarle el
enlace de rastreo— y no la escribía nadie. Ni la aplicación, ni el sembrador.
La sección de contactos de la ficha solo podía estar vacía, y la búsqueda de
`CustomerLink` no encontraba nunca a nadie: el enlace acababa siempre en
`customers.email`, que suele ser la dirección de facturación. La dirección menos
indicada para avisar de que un camión va de camino.

Es la misma clase de defecto que `load_stops.actual_arrival_at` del lote 63: una
tabla que tres pantallas leen y nadie escribe.

**2. El idioma era de la empresa.** Ni `customers` ni `customer_contacts` tenían
columna, así que se usaba `tenants.default_locale`. Una casa que trabaja en
inglés les escribía en inglés a sus clientes hispanohablantes. Los
transportistas lo tienen desde el lote 34 y los conductores desde el principio;
la asimetría no tenía ninguna razón de ser, y estaba apuntada como pendiente en
`docs/tracking-link.md` desde que se construyó el envío.

**3. Cuando el correo no salía, no se enteraba nadie.** Esto es de otra clase.
`sendForLoad()` devolvía `bool` y quien llamaba lo tiraba: quedaba `sent_at` en
nulo, una línea en el registro que no lee nadie, y el cliente esperando un aviso
que el sitio público le promete en cinco sitios distintos. Un fallo silencioso
en una promesa pública es peor que un fallo ruidoso en cualquier otro lado.

## A quién se le manda

Por cargo, y en este orden:

| Orden | Cargo | Por qué |
|---|---|---|
| 0 | quien lleva el sitio de entrega | Añadido en el lote 65 — ver docs/customer-places.md |
| 1 | `traffic` | Quien mueve la carga día a día |
| 2 | `dock` | Quien la carga o descarga y quiere saber a qué hora llega |
| 3 | `purchasing` | Quien contrató el flete |
| 4 | el principal | Cuando no hay ninguno de los tres |
| 5 | cualquiera con correo | |
| 6 | `customers.email` | Cuando el cliente no tiene contactos |

**`billing` no está en la lista, y esa ausencia es la decisión.** A contabilidad
se le escribe para cobrar —eso lo hace `InvoiceLink`, con la lista al revés— y
no para contarle que un camión salió de Laredo. Mandar las dos cosas al mismo
sitio es cómo se consigue que no lean ninguna.

Que las dos clases se parezcan no es casualidad: la pregunta «¿a quién de esta
empresa le importa esto?» es la misma y solo cambia el esto.

## En qué idioma

En el **del contacto elegido**. Si se cae al correo general del cliente, en
`customers.preferred_locale`, que es el espejo de su contacto principal — igual
que `carriers.preferred_locale` es el del suyo.

El idioma va por persona y no por empresa por la misma razón que en los
transportistas: quien lleva las compras puede trabajar en inglés y el del muelle
leer solo español. Tener un control de empresa y otro por persona garantizaba
que un día dijeran cosas distintas y nadie supiera cuál manda; por eso la
columna de la ficha es un espejo y no un campo aparte.

El prefijo del idioma viaja **en la dirección** (`/es/t/{token}`): el cliente la
abre desde su correo, sin sesión ni cookie, y sin él leería lo que dijera el
navegador de su oficina.

## El cargo es una lista cerrada

`customer_contacts.position` era `varchar(120)` de texto libre. Pasa a lista
cerrada —ver `App\Enums\CustomerContactPosition`— porque ahora **decide algo**, y
eso no se puede hacer sobre un campo donde caben «tráfico», «Trafico» y «OPS» a
la vez.

Es más corta que la de los transportistas porque un cliente se organiza con menos
papeles: aquí no hay seguridad, ni cumplimiento, ni jefe de conductores.

## Que se note cuando no sale

Tres capas, y hacen falta las tres:

**En el momento.** `sendForLoad()` devuelve el motivo y no un sí o un no, y quien
despacha lo ve al instante. Los cuatro «no» no son lo mismo:

| Motivo | Qué pasó | ¿Se dice? |
|---|---|---|
| `disabled` | La empresa apagó los enlaces públicos | No: es correcto |
| `alreadySent` | Ya salió uno | No: es correcto |
| `noRecipient` | El cliente no tiene ni un contacto con correo | Sí |
| `failed` | Se intentó y no salió | Sí |

Los dos correctos callan a propósito: un aviso que aparece cuando todo va bien
deja de leerse, y entonces tampoco se lee el que importa.

**En la pantalla de rastreo.** Una carga que ya salió y a la que nunca se le
mandó un enlace lo dice arriba del todo. Es la pantalla a la que manda el aviso
del barrido, y conviene que al llegar se vea sin leer la lista enlace por enlace.

**En el barrido diario.** `notifications:sweep` busca las cargas en la carretera
sin ningún enlace mandado y avisa a quien tenga `tracking:read`. Es la red de
abajo: el aviso del momento lo ve quien está delante, y quien está delante puede
estar despachando cinco cargas seguidas a las seis de la mañana.

Se avisa **una vez por carga** — la clave de deduplicación lleva la carga y nada
más. Con la fecha dentro volvería a avisar cada mañana, y una campana que repite
deja de mirarse.

No se avisa de las entregadas ni de las canceladas: en la primera el enlace llega
tarde y en la segunda no lleva a ninguna parte.

## Un tercer canal de avisos

`flash` llevaba `success` y `error`, y hacía falta un tercero. «La carga se
despachó y al cliente no se le pudo avisar» no es ninguna de las dos cosas: con
dos canales había que elegir entre callarlo o teñir de rojo una operación que
salió bien, y lo que pasaba era lo primero.

`warning` es ámbar y lleva `role="status"`, no `role="alert"`: no ha fallado nada
que haya que deshacer.

## Lo que sigue faltando

- **No hay reintento.** Si el correo falla, falla. Ahora se ve —en pantalla y en
  la campana— pero alguien tiene que reenviarlo a mano. La tabla `job_queue`
  existe y sigue vacía.
- **Solo el despacho manda correo al cliente.** Ni la entrega, ni un retraso, ni
  el comprobante.
- ~~`customer_contact_locations` sigue sin usarse.~~ Hecho en el lote 65: cada
  contacto se ata a los sitios que lleva, y el enlace va antes a quien lleva el
  sitio donde se ENTREGA que a quien lleva el tráfico de toda la empresa. Ver
  docs/customer-places.md.
