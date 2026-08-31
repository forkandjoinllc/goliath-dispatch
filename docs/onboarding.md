# Cola de incorporación

`/onboarding`. Qué transportista espera qué, y quién no puede llevar carga.

## Lo que había y lo que faltaba

Las transiciones existían desde hace lotes: enviar, empezar revisión, pedir
correcciones, aprobar, rechazar, suspender, reinstaurar — cada una con su
permiso y su motivo obligatorio. `carriers.onboarding_status` se escribía.

Lo que no había era **la cola**: el sitio donde quien lleva cumplimiento ve su
trabajo del día sin abrir siete fichas. El menú la tenía en gris desde el primer
lote.

## Esta pantalla no inventa ninguna regla

Lo que bloquea a un transportista lo decide `Guards::carrierBlocking()`, que es
**exactamente la misma función** que consulta la puerta de despacho
(`Guards::forAssign` y `forDispatch`). Antes era privada; se hizo pública y la
cola la llama.

Si hubiera dos implementaciones, el problema no sería la discrepancia entre
ellas: sería que alguien confía en la que se equivoque. Una prueba compara las
dos respuestas y falla si divergen.

## Bloquea vs. avisa

Dos cosas distintas, separadas en la pantalla y en los datos:

| | Qué es | Ejemplos |
|---|---|---|
| **Bloquea** | Impide despachar hoy. Sale de `Guards`. | Incorporación no aprobada, falta un documento obligatorio, uno vencido, uno sin revisar |
| **Avisa** | No impide nada. Lo añade `Readiness`. | La verificación de FMCSA nunca se hizo, o está fuera de plazo |

Mezclarlas haría que un aviso pareciera una puerta cerrada, o —peor— que una
puerta cerrada pareciera un aviso.

**La verificación de FMCSA fuera de plazo NO bloquea el despacho, y no lo he
cambiado.** Endurecer esa puerta es una decisión de negocio con consecuencias en
la operación del día: le toca tomarla a quien lleva la casa, no a un lote de
software. Pero quien mira esta cola tiene que verlo, y ahora lo ve.

Y se distingue **«nunca comprobado»** de **«comprobado hace mucho»**: uno es una
tarea que nadie empezó, el otro una que se dejó de hacer. Son cosas distintas y
se hacen cosas distintas con ellas.

## Los aprobados que no pueden llevar carga

Es la sección que no existía en ningún sitio y el motivo principal para
construir esto.

Un transportista al que se le aprobó la incorporación en marzo y se le venció el
seguro en julio **sigue en `approved`**. Ninguna lista por estado lo enseña —
está donde debe estar— y sin embargo su camión no puede salir. Aparece arriba
del todo, en rojo, con lo que le falta nombrado.

## Nada se guarda

`carrier_onboardings.checklist` es una columna JSON y este módulo **no la
escribe**. Una lista guardada dice «listo» el día que se guardó y sigue
diciéndolo el día que caduca el certificado de seguro. La pregunta «¿puede
llevar carga HOY?» solo la puede contestar el estado de hoy.

Hay una prueba que comprueba que la columna sigue vacía.

## Qué cuenta como «lo tiene»

Un documento cuenta si está **aprobado** y **no vencido**. Las dos condiciones:

- Uno pendiente de revisión no cuenta. Que alguien haya subido un PDF no
  significa que nadie lo haya mirado.
- Uno vencido no cuenta. Un seguro caducado es no tener seguro.

Cada uno que falta se **nombra**. «Faltan documentos» obligaría a abrir la ficha
y compararla con una lista que solo está en la cabeza de quien lleva
cumplimiento.

## El orden de la cola

`submitted` y `under_review` primero, porque son trabajo de la casa;
`corrections_required` después, que es trabajo del transportista; `draft`,
`suspended`, `approved` y `rejected` al final. Ordenar alfabéticamente pondría
`approved` arriba y enterraría lo urgente.

«Esperando desde» sale de la marca que corresponde a **su** estado —
`submitted_at` para uno enviado, `corrections_requested_at` para uno con
correcciones — y no de la fecha de alta. Lo que interesa es cuánto lleva ESTE
transportista parado en ESTE punto.

## Lo que falta

- **El tablero de tarjetas.** El diccionario portado tiene una sección `board.*`
  con despachador asignado y última actividad. Esta cola es una lista; el
  tablero por columnas es otra forma de lo mismo.
- **Las transiciones desde aquí.** Los botones siguen en la ficha del
  transportista. Duplicarlos habría creado dos puertas al mismo cambio de estado
  con sus propias comprobaciones que mantener.
- **`carrier_onboardings.required_document_types`**, que permitiría exigir
  documentos distintos a transportistas distintos. Hoy el catálogo es el mismo
  para todos.

## Dónde vive

| Fichero | Qué hace |
|---|---|
| `app/Support/Onboarding/Readiness.php` | Qué le falta a un transportista, calculado |
| `app/Support/Loads/Guards.php` | `carrierBlocking()`, la única fuente de lo que bloquea |
| `app/Http/Controllers/App/OnboardingController.php` | La cola, el orden y la sección de aprobados bloqueados |
| `resources/js/pages/App/Onboarding/Index.tsx` | La pantalla |
