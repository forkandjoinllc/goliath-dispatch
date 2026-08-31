# Mensajes

Los hilos entre despacho, transportistas y conductores. Cierra la última entrada
apagada de OPERACIONES.

## Lo que arregla

No es una pantalla que faltara: es que **hoy «¿le avisaste al transportista de
que la cita cambió?» se contesta por teléfono y no queda nada**. Cuando quince
días después el cliente reclama una detención, la conversación que decide quién
tiene razón está en el móvil de alguien.

Las cuatro tablas —`conversations`, `conversation_participants`, `messages`,
`message_attachments`— llevaban desde el primer día sin una sola consulta. Y la
matriz de roles YA definía `message:read` y `message:send` en los cinco roles con
alcances distintos: alguien diseñó el módulo entero y nunca se construyó.

## La regla: un hilo se ve desde dentro

**Un hilo se ve si estás dentro de él. También si eres administrador.**

Es la única parte del sistema donde el alcance de un rol no basta, y es una
decisión de producto, no un descuido. En el resto el alcance manda —quien tiene
`Scope::Tenant` sobre las cargas ve todas las cargas de su empresa, y está bien:
una carga es un hecho de la empresa—. Una conversación no. Si `message:read` con
alcance de empresa dejara leer cualquier hilo, «hablar en privado con
contabilidad» no existiría en este producto y la gente se iría a WhatsApp, que es
exactamente lo que este módulo viene a evitar. Un sistema que promete un canal y
lo deja abierto es peor que no tener canal.

La casa no queda sin salida: **puede añadirse a un hilo**, y eso queda en la
bitácora (`message.participant_added`). Mirar sin dejar rastro es lo que no
puede. Si esa puerta no dejara rastro, la regla no valdría nada: bastaría
meterse, leer y salirse.

### Y además el alcance

La pertenencia es necesaria pero no suficiente. Encima se aplica el alcance,
y no es redundante — son dos preguntas distintas:

- la pertenencia contesta «¿me metieron en este hilo?»
- el alcance contesta «¿me PODÍAN meter?»

Sin lo segundo, una fila mal escrita en `conversation_participants` le enseñaría
a un transportista la conversación de otro. Y la fila que sobra es justo la que
nadie mira. Con las dos, hace falta equivocarse dos veces.

**El alcance de la carga se pregunta con `LoadScope`, no con una consulta
propia.** La primera versión miraba `conversations.carrier_id` y los
transportistas asignados, y nada más; un despachador alcanza una carga por dos
caminos —el transportista que lleva, o ser él mismo el `dispatcher_user_id`— y
mirando solo el primero recibía un 404 en el hilo que acababa de crear. Lo
encontró el navegador, no las nueve pruebas de alcance. Ver `docs/testing.md`.

## Los mensajes de sistema

`messages.origin` distingue dos clases. La segunda es la interesante:

```sql
-- For system messages: i18n key + params instead of hard-coded text.
system_key         varchar(80)      null,
system_params      json             null,
```

Es una decisión de producto escrita en el esquema. En un hilo de carga hay
despacho —que trabaja en español— y un transportista que puede trabajar en
inglés. Guardando el mensaje ya redactado, quedaría en el idioma del que provocó
el cambio: el transportista leería «La carga pasó a en ruta» y el despachador
leería «Load moved to in transit», cada uno a medias. Guardando la clave, **cada
uno lo lee en el suyo** y el mismo hilo se cuenta bien dos veces.

Los parámetros también son claves: `{"from": "dispatched", "to":
"en_route_to_pickup"}`, no etiquetas. La pantalla las traduce al pintarlas.

`body` sigue siendo NOT NULL, así que se escribe también una redacción en el
idioma de la empresa para que quien mire la tabla en crudo no vea filas mudas.
**La pantalla no la usa.**

### Narrar no crea hilos

`Narrator` anota los cambios de estado en el hilo de la carga **si lo hay**. No
lo crea, y es deliberado: si lo creara, cada cambio de estado de cada carga
abriría una conversación, y una empresa con seiscientas cargas al mes tendría una
bandeja de seiscientos hilos que nadie ha abierto nunca, con los cinco que
importan enterrados debajo.

El hilo lo abre una persona cuando tiene algo que decir; a partir de ahí, y solo
a partir de ahí, los hechos se van anotando solos.

También significa que narrar no puede romper un cambio de estado: sin hilo no
hace nada.

## El hilo de una carga

Uno por carga, buscado-o-creado. Dos hilos de la misma carga es peor que ninguno:
la mitad de la conversación queda en el otro.

Al crearlo entra quien lo abre **y los usuarios del transportista**. Un hilo con
un solo lado es el fallo que este módulo viene a arreglar, así que crear el hilo
y meter al otro lado son la misma operación.

Cuando el transportista está dado de alta pero su gente todavía no tiene cuenta
—el estado normal las primeras semanas— no hay a quién meter, y **la pantalla lo
dice en voz alta**. La alternativa era que la única señal fuese una lista de
participantes corta, que es pedirle a alguien que note una ausencia.

`POST /loads/{load}/messages`, no GET, aunque «abrir el hilo» suene a lectura: la
primera vez escribe. Un GET que escribe es un GET que un prefetch del navegador
dispara solo.

Y se comprueba el alcance de la **carga**, no el de los mensajes: si solo se
comprobara el segundo, un despachador podría abrir el hilo de una carga ajena y
meterse dentro — y a partir de ahí la regla de pertenencia le daría acceso
legítimamente.

## Detalles que tienen motivo

| Qué | Por qué |
|---|---|
| `last_message_at` desnormalizado | La bandeja ordena por él y el esquema le pone índice. Calcularlo con un MAX() en cada carga recorrería todos los mensajes de la empresa para pintar veinte filas. Se escribe en la MISMA transacción que el mensaje. |
| No leídos por `last_read_at`, no por contador | Un contador hay que mantenerlo en dos sitios y se desincroniza en cuanto alguien borra un mensaje. Una marca de tiempo siempre da la cuenta correcta. |
| Salir del hilo pone `left_at`, no borra la fila | Borrarla dejaría los mensajes de esa persona sin autor conocido. Y el único `(conversation_id, user_id)` no admitiría volver a entrar. |
| `addParticipant` revienta si no consta el rol | Quien llama está CONCEDIENDO ACCESO. Un retorno callado deja al que llama creyendo que metió a alguien: el despachador manda el mensaje, el transportista no lo recibe nunca, y nadie se entera hasta que hay una reclamación. |
| Hilo ajeno → 404, no 403 | Un 403 sobre un hilo privado confirmaría que esa conversación existe, que es la mitad de lo que quien fisgonea quiere saber. |
| Abrir el hilo lo marca leído | Un «marcar como leído» que hay que pulsar deja la bandeja mintiendo para todo el que no lo pulse, que es todo el mundo. |
| `is_operational` en los hilos de carga | Ahí se acuerdan citas y se avisan retrasos. La columna marca lo que la retención no puede tirar sin más. |

## Dónde está

| | |
|---|---|
| Regla de visibilidad | `app/Support/Messaging/MessageScope.php` |
| Crear hilos y participantes | `app/Support/Messaging/Threads.php` |
| Escribir | `app/Support/Messaging/Posting.php` |
| Bandeja y lectura | `app/Support/Messaging/Inbox.php` |
| Mensajes de sistema | `app/Support/Messaging/Narrator.php` |
| Controlador | `app/Http/Controllers/App/MessageController.php` |
| Pantallas | `resources/js/pages/App/Messages/{Index,Show}.tsx` |
| Diccionario | `lang/{es,en}/messages.json` |
| Pruebas | `tests/Feature/Messaging/` |

## Lo que no lleva

- **Tiempo real.** La bandeja se refresca al cargar la página. Un hilo de
  despacho no es un chat: los mensajes que importan se leen en minutos, no en
  segundos, y un canal de tiempo real es infraestructura que hay que sostener.
- **Hilos `direct` y `broadcast` desde la interfaz.** El esquema los admite y el
  código los trata, pero solo se crean hilos de carga por ahora: es donde está el
  problema que este módulo viene a resolver.
- **Editar y borrar mensajes.** `edited_at` existe en el esquema y la pantalla ya
  sabe pintarlo.
- **Notificaciones.** Un mensaje nuevo no manda correo todavía.
