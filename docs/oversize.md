# Permisos, escoltas y sobredimensión

Qué calcula este módulo, qué NO afirma, y de dónde salen los números.

## Lo que se afirma, y lo que no

Esto **compara** las medidas de una carga con unos límites que están escritos en
la base de datos de la empresa, y enseña estado por estado qué se excede y por
cuánto.

Esto **no determina** que haga falta un permiso, ni que no haga falta. Las
columnas del esquema se llaman `permit_likely_required` y
`escort_likely_required` —con «likely» dentro del nombre— y toda evaluación nace
en `human_validation_status = 'pending'` porque una persona tiene que firmarla
antes de despachar.

No es prudencia genérica. Al cálculo le faltan cosas que **no puede tener**:

- **Los estados de paso**, mientras no haya proveedor de rutas. Una carga de
  Texas a Illinois cruza estados que esto no ha mirado. Se avisa en cada
  evaluación afectada.
- **Las restricciones horarias, de fin de semana y de festivos.** La tabla tiene
  `travel_restrictions` y el diccionario tiene los textos; nada las llena
  todavía.
- **Los puentes, las obras y las excepciones** que cada estado publica y que no
  caben en cinco números.

Un programa que dijera «no hace falta permiso» con esa información sería peor
que uno que no dijera nada, porque el que no dice nada no da tranquilidad.

## De dónde salen los números sembrados

`App\Support\Oversize\DefaultRules` siembra la **línea de base federal de
Estados Unidos** para el Sistema Nacional de Autopistas:

| Qué | Valor | Es |
|---|---|---|
| Ancho | 102" (8'6") | Límite federal real |
| Peso bruto | 80.000 lb | Límite federal real |
| Eje simple | 20.000 lb | Límite federal real |
| Altura | 162" (13'6") | **NO es federal** — la fija cada estado |
| Largo | 636" (53') | Habitual para el remolque, no universal |

La altura es el caso que más cuidado pide: el gobierno federal **no la regula**,
y va de 13'6" en buena parte del este a 14'0" en buena parte del oeste. Se
siembra la más restrictiva, porque equivocarse por abajo hace pedir un permiso
que no hacía falta y equivocarse por arriba mete un remolque debajo de un
puente.

**Por qué la misma línea para los cincuenta estados y no cincuenta tablas.**
Porque cincuenta números plausibles y sin fuente son peores que uno correcto
repetido: dan una precisión que no existe y nadie los revisaría. Sembrando lo
mismo en todos, `last_reviewed_at` queda en NULL y la pantalla lo dice en cada
estado — «sin revisar, valores sembrados, no verificados con el estado». Editar
una regla marca esa fecha, porque quien cambia un número lo ha mirado.

Los límites son **datos de la empresa**, no del programa: la tabla lleva
`tenant_id` y el comentario del esquema dice «fully tenant-editable».

## El recorrido

`routes.provider` viene con `default 'mock'` en el esquema, así que estaba
previsto desde el principio. Hay una interfaz `RouteProvider` y un adaptador
`StopDerivedRouteProvider` que:

- **Sabe** en qué estados están las paradas, porque están escritas en la carga.
- **No sabe los estados de paso.** Avisa de ello, y ese aviso viaja hasta
  `oversize_evaluations.missing_data_warnings` y hasta la pantalla.
- **No sabe las millas.** Devuelve NULL en vez de una distancia en línea recta,
  que parecería un dato.

El día que haya un proveedor con credenciales, cambia una línea en
`AppServiceProvider` y nada más se entera.

## Tres decisiones del evaluador

- **Las entradas se congelan.** `inputs` guarda las medidas tal como estaban al
  evaluar. Si mañana alguien corrige el ancho, la evaluación vieja sigue
  diciendo sobre qué medidas se hizo — que es lo que permite entender por qué se
  firmó lo que se firmó. La pantalla detecta que cambiaron y pide volver a
  evaluar.
- **Faltar un dato NO es estar dentro de límite.** Una carga sin ancho escrito
  no es una carga de 102 pulgadas: es una carga que no se sabe. Sale
  `insufficient_data` y un aviso por cada medida que falta.
- **El peso por eje se teclea en cada evaluación** y no se guarda en la carga.
  Depende de cómo se cargue el remolque ese día, no de la mercancía. Lo decía ya
  el diccionario portado.

## La compuerta

`loads.permit_ready_approved_at` llevaba desde el primer día en el esquema sin
que nada la encendiera. Ahora la enciende `permit:approve_ready`, que es un
permiso APARTE del de tramitar permisos: quien consigue los papeles y quien
firma que están todos pueden ser la misma persona, pero la casa debe poder
decidir que no lo sean.

No se aprueba:

- si no hay evaluación **validada** por una persona;
- si queda algún permiso en `pending`, `requested`, `expired` o `rejected`.

Y **añadir un permiso pendiente reabre una compuerta ya aprobada**. Si no lo
hiciera, una carga aprobada el lunes seguiría aprobada el martes con un permiso
nuevo sin tramitar dentro.

## Lo que falta

- **Las restricciones de viaje.** `oversize_rules.travel_restrictions` es un
  JSON vacío y el diccionario ya trae los textos de noche, fin de semana,
  festivo y horario. Falta el editor y falta que el evaluador las lea.
- **La pantalla de reglas por estado.** Se siembran y se pueden editar por
  código (`Rules::update`), pero no hay formulario. El diccionario portado
  describe uno completo, con umbrales de escolta y autoridad de permisos.
- **Los avisos de permisos por vencer.** `expiryWarnings.*` está en el
  diccionario y `permits.expires_at` se guarda; falta engancharlo al barrido de
  avisos, que ya existe.
- **Los documentos de permiso y de estudio de ruta.** Las columnas
  `permits.document_id` y `permits.route_survey_document_id` están y no se
  llenan.
- **`escorts.document_id`**, igual.

## Dónde vive

| Fichero | Qué hace |
|---|---|
| `app/Support/Oversize/DefaultRules.php` | Los números federales y de dónde salen |
| `app/Support/Oversize/Rules.php` | Sembrar, leer y editar los límites de la empresa |
| `app/Support/Oversize/Evaluator.php` | La comparación, los avisos y la firma humana |
| `app/Support/Routing/RouteProvider.php` | La interfaz del proveedor de rutas |
| `app/Support/Routing/StopDerivedRouteProvider.php` | El adaptador sin credenciales, y lo que no sabe |
| `app/Support/Routing/Routes.php` | Guardar el recorrido y sus estados |
| `app/Http/Controllers/App/PermitController.php` | Las nueve rutas y quién puede cada cosa |
