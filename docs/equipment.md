# Equipo: cuándo una unidad puede salir

## El defecto

El diccionario de equipos decía esto, y lo decía desde el primer día:

> «Una unidad se da de alta pendiente de verificación. **No se puede poner en
> una carga hasta que alguien la haya revisado.**»

Y el comentario de `EquipmentController` lo repetía con otras palabras:
«`pending_verification` es lo que impide despacharla sin que alguien la haya
mirado».

Las dos frases eran falsas. La asignación solo rechazaba `out_of_service`. Un
camión recién dado de alta, que nadie había mirado, se enganchaba a una carga y
salía a la carretera.

Peor: al asignar se GUARDA `next_inspection_due_at` en la instantánea, como
prueba de lo que se sabía en ese momento… sin mirar si ya había vencido. El
sistema anotaba diligentemente «la inspección de este camión venció hace ocho
meses» y lo asignaba igual.

Y la asimetría estaba dentro de la MISMA función: al conductor se le comprobaba
el carné vencido y la tarjeta médica vencida; a la unidad, nada.

## Qué bloquea, y qué no

`App\Support\Equipment\Eligibility` es la única regla, y la leen los tres sitios
que hablan de ello: la puerta de asignación, el desplegable que la precede y la
ficha de la unidad. Que sean tres importa — el desplegable marcaba en regla
unidades que la puerta iba a rechazar, y ahí es donde el usuario descubre el muro
chocándose con él.

| Motivo | Cuándo |
|---|---|
| `outOfService` | La unidad está fuera de servicio |
| `archived` | Está archivada |
| `notVerified` | Sigue en `pending_verification` |
| `inspectionOverdue` | `next_inspection_due_at` es anterior a hoy |
| `registrationExpired` | `registration_expires_at` es anterior a hoy |
| `insufficientMedia` | Falta alguno de los cuatro lados fotografiados |

**Una fecha que no consta NO bloquea.** Nula es «nadie lo ha rellenado», no
«está vencido». Cerrar la puerta por un dato que falta pararía la operación de
quien no lleve el mantenimiento aquí, y le enseñaría a rellenar cualquier cosa
con tal de seguir — que es peor que no tener el dato. Es la misma regla que la
validación de sobredimensión (lote 55) y los topes del plan (lote 56).

Se devuelven TODOS los motivos, no el primero: quien prepara un camión quiere
saber de una vez todo lo que le falta.

## Las cuatro fotos

La página de transportistas del sitio público promete que «cada camión y remolque
necesita al menos cuatro fotos antes de activarse», y la portada mete las fotos en
la lista de cosas que «se verifican automáticamente antes de asignar una carga».
`equipment_media` estaba vacía. En el lote 57 dejé `insufficient_media` FUERA de
los bloqueos precisamente para no prometer una puerta que no existía; este es ese
cabo suelto, atado.

**Se piden cuatro ÁNGULOS, no cuatro ficheros.** Frente, detrás, izquierda y
derecha. «Al menos cuatro fotos» se cumple con cuatro fotos del mismo faro, y eso
no sirve para nada: lo que hace falta —para una reclamación, para un seguro, para
saber en qué estado salió la unidad— son los cuatro lados. Es más estricto que la
frase y la cumple, y la pantalla dice cuál falta en vez de un número que no
explica nada.

Hay ángulos opcionales además de los obligatorios: placa del VIN, odómetro,
daños, otro.

Quitar una foto la MARCA como borrada; el fichero lo retira el barrido de
huérfanos del lote 53. Una foto que documenta el estado de un camión el día que
salió es exactamente el dato que alguien reclama nueve meses después.

Se guarda el `sha256` del contenido: sirve para ver si dos fotos son la misma
subida dos veces —que en un expediente de cuatro ángulos pasa— y para comprobar
años después que el fichero del almacén sigue siendo el que se subió.

## Qué significa «verificada»

Salir de `pending_verification` era pulsar un desplegable. Nada quedaba escrito
sobre qué se había revisado, contra qué, ni quién lo dijo. Una puerta cuya llave
la tiene cualquiera y no deja rastro es decoración.

Lo que se comprueba es que **el VIN de la unidad aparezca en el certificado de
seguro del transportista**. Un camión que no está en la póliza circula sin
cobertura, y eso no se descubre hasta que hay un siniestro.

`equipment_verifications` guarda cada acto:

| Salida | Qué significa | Quién |
|---|---|---|
| `verified` | Una persona vio el VIN en el certificado vigente | `equipment:status:update` |
| `manually_overridden` | Se pone en servicio a pesar de todo, con motivo escrito | `equipment:verification:override` |

Se guarda **contra qué documento y qué versión** se miró. Si la póliza se
sustituye mañana, la verificación de ayer sigue diciendo lo que se miró ayer.

La anulación existe porque la alternativa es peor: sin una salida razonada, quien
tiene prisa acaba buscando otro camino. Una anulación con nombre y motivo se
audita; un atajo silencioso, no. El motivo se queda en la ficha de la unidad.

Y la asimetría de la matriz de roles, que estaba escrita desde el principio y no
usaba nadie: el despachador y el portal del transportista dan de alta la unidad,
y **no** deciden que entre en servicio sin póliza.

### Poner en servicio exige verificación

Subir a `active` desde cualquier otro estado exige una verificación. Solo al
SUBIR: una unidad que ya estaba activa antes de que esto existiera no se cae de
servicio sola. Se le exigirá la próxima vez que alguien la mueva, no hoy y por
sorpresa — mismo trato que los topes del plan.

### Tres impedimentos, no dos

Cuando no hay certificado contra el que mirar, se dice cuál de las tres cosas
pasa, porque son tres llamadas de teléfono distintas:

- `no_coi_on_file` — no hay ninguno: pídalo.
- `coi_not_approved` — hay uno subido y sin revisar: revíselo.
- `coi_expired` — hubo uno aprobado y ha vencido: pida el nuevo.

Con dos casos, un certificado pendiente de revisión se anunciaba como «vencido» y
mandaba a quien lo leyera a pedirle a un transportista un papel que ya había
mandado. **Lo encontró el navegador**, con la suite en verde: la empresa de
demostración tiene justo ese caso.

## Lo que falta

- **No se lee el certificado.** `extracted_vins`, `ocr_provider` y
  `ocr_confidence` están y se quedan vacías. Sacar los VIN de un PDF con capa de
  texto es fácil; de un certificado escaneado necesita un proveedor de OCR que
  aquí no hay. Construir solo la mitad fácil dejaría un sistema que a veces
  propone VIN y a veces no, sin que quien lo usa sepa cuál de las dos cosas está
  pasando. La pantalla lo dice con todas las letras: «el sistema no lee el
  certificado: lo mira una persona».
- **`media_count` de `equipment_verifications` sigue en cero.** Las fotos se
  cuentan desde `equipment_media`, que es la fuente; esa columna era un contador
  cacheado del que nadie depende y no se rellena.
- **La verificación no caduca.** El estado `expired` del CHECK no lo escribe
  nadie. Cuando el certificado de seguro vence, la verificación hecha contra él
  sigue diciendo `verified`. Lo natural es engancharlo al barrido de avisos, que
  ya existe.
- **No se reverifica al cambiar de transportista.** Una unidad que pasa a otro
  transportista conserva su verificación, hecha contra la póliza del anterior.

## Dónde vive

| | |
|---|---|
| La regla | `app/Support/Equipment/Eligibility.php` |
| Los hechos | `app/Support/Equipment/UnitFacts.php` |
| La verificación | `app/Support/Equipment/Verification.php` |
| La puerta | `app/Http/Controllers/App/LoadAssignmentController.php` |
| El desplegable | `app/Http/Controllers/App/LoadController.php` |
| La ficha y las acciones | `app/Http/Controllers/App/EquipmentController.php` |
| Pantalla | `resources/js/pages/App/Equipment/Show.tsx` |
| Pruebas | `tests/Feature/Fleet/UnitEligibilityTest.php`, `tests/Unit/Suite/EquipmentBlockingTest.php` |
