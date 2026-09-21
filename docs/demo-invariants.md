# La demostración enseñaba estados que la aplicación prohíbe

## El defecto

`DemoDataSeeder` no es un fixture de pruebas: es lo que corre en la instalación
de demostración y lo que ve cualquiera que recorra el producto. Escribe con
`DB::table(...)->insert()`, saltándose los controladores — y por eso puede
escribir combinaciones que ninguna ruta puede producir.

Medido sobre la base sembrada, antes de este lote:

| Lo que había | Lo que la aplicación exige |
|---|---|
| un gasto **aprobado** de 3.400 $ con recibo exigido y sin recibo | `ExpenseController` rechaza esa transición, y `ExpenseTransitions` no tiene camino de vuelta a `submitted` para repararlo |
| los **once** gastos en `approved` | nada — pero así la cola de revisión no se ve nunca en la demostración |
| un documento con `review_status = 'expired'` | ese valor no lo escribe nadie: `review()` admite `approved`, `rejected` e `in_review` |
| trece documentos decididos y **cero** `document_reviews` | `review()` escribe una fila por decisión, siempre |
| una carga **facturada** sin ninguna fila de camión | `Guards::forDispatch()` devuelve `noTruck` |
| y con un conductor que no trabaja para su transportista | `checkResource()` lo rechaza con `driverWrongCarrier` |

## Por qué es peor que un fixture malo

Un fixture malo rompe una prueba. Una demostración mala **enseña un producto
que no existe**. Quien la recorre concluye que la suspensión de un
transportista es un aviso, que el recibo obligatorio se cumple solo, que el
permiso de sobredimensión es una casilla que alguien marca. Y quien programa
contra ella **nunca ejecuta la rama donde vive el defecto de verdad**: el gate
del recibo no se ejecutó ni una vez en la demostración, porque no había ningún
gasto pendiente al que aplicárselo.

Hay un caso que lo resume: el filtro de documentos ofrecía «Vencido», y ese
valor no lo escribe ningún código. Debería haber devuelto cero filas siempre —
la señal que levanta la pregunta. Devolvía una: la que sembraba la
demostración. **La demostración era la única razón de que una opción muerta
pareciera viva.**

## Lo que ya estaba escrito y no se aplicó

En el mismo método que sembraba `review_status = 'expired'`, veinte líneas más
abajo:

> `unavailable` y no `clean`. Sembrar «limpio» enseñaba un estado que producción
> NO PUEDE alcanzar: no hay antivirus atado… Una demostración que enseña un
> visto bueno de seguridad que el producto no sabe dar es la peor clase de
> demostración que hay.

La lección estaba escrita, en ese fichero, a la altura de los ojos. Y el estado
de revisión de al lado seguía siendo uno que producción no puede alcanzar.

Lo mismo en `loadCrew()`: la consulta del conductor lleva este comentario —

> El conductor tiene que ser de ESE transportista y estar al día. Coger uno
> cualquiera sembraría justo la incoherencia que esto viene a arreglar, solo
> que más difícil de ver.

— y cuarenta líneas más abajo había un respaldo que cogía **uno cualquiera**.
El único al que le tocó fue el de la carga del transportista suspendido, que es
donde menos se mira.

## El guardián

`tests/Feature/Database/DemoInvariantsTest.php` siembra la demostración y
comprueba, fila a fila, que no haya ninguna en un estado que ninguna ruta pueda
producir. Cada invariante declara tres cosas:

1. **qué contar** — una consulta que devuelve el número de filas que lo rompen;
2. **dónde lo exige la aplicación** — el fichero;
3. **qué texto de esa exigencia tiene que seguir estando.**

La tercera es la que impide que un invariante sobreviva a su regla. Sin ella,
el día que alguien quite la comprobación del recibo esta prueba seguiría verde
exigiendo algo que ya no exige nadie, y eso es peor que no tenerla porque
parece cobertura.

Quién necesita papeles no se decide con un `if` escrito en la prueba: se le
pregunta a `NeedsPapers::enConsulta()`, que es la pieza de la aplicación.
Repetir la regla en el guardián la habría duplicado — y preguntar solo por
`is_oversize` fue exactamente el defecto que esa clase vino a cerrar.

### El sembrador también es un productor

`Reachable` contesta «¿puede la aplicación escribir este valor?» leyendo el
código de la aplicación. El sembrador también escribe valores y **no estaba
contado**. Ahora un guardián comprueba que la demostración no siembre ningún
valor que el registro declare imposible, y `documents.reviewStatus` entra en el
registro con sus cuatro productores y sus dos imposibles:

- `expired` — vencido es una **fecha**, no una decisión de revisión.
- `superseded` — subir una versión nueva deja el documento en `pending`; no
  marca la anterior.

El filtro y las facetas de la pantalla salen ya del registro, y el valor se
normaliza **en la entrada**: pedir `?status=expired` por la URL dejaba el filtro
diciendo «Vencido» con la lista entera debajo, que es el defecto que ese mismo
método describe doce líneas más abajo sobre el filtro de dueño.

## Lo arreglado en la siembra

- **El gasto sin recibo se queda sin aprobar.** Pendiente dice lo mismo y es
  cierto: es el gasto que está pidiendo su papel. Y con él la demostración
  enseña por fin la cola de revisión — el contador «Esperando revisión: 3.400 $»
  y los botones de aprobar y rechazar.
- **El seguro de Bluewater está aprobado y caducado hace 34 días**, que es lo
  que de verdad le pasa y lo que bloquea a su transportista.
- **Cada documento decidido lleva su revisión**, con quién y cuándo, apuntando a
  la versión concreta que se revisó.
- **Bluewater tiene camión, remolque y conductor propios.** Su carga es de
  antes de la suspensión: esa historia —trabajó, y hoy está suspendido— es
  cierta y es interesante. Lo que no podía ser es que rodara sin camión.
- **Fuera el respaldo de «cualquier conductor».** Si mañana falta un conductor
  apto, el hueco se ve en vez de taparse con uno ajeno.

## Lo que queda declarado y sin arreglar

Las tres cargas sobredimensionadas salen firmadas —`oversize_validated_at` y
`permit_ready_approved_at`— y la base tiene **cero** evaluaciones, permisos,
escoltas y reglas estatales. `PermitController::validate()` exige una evaluación
previa y `approveReady()` exige además que `Papers::faltan()` no encuentre nada:
ese estado no lo escribe ninguna ruta.

Y por el otro extremo, GD-24011 es de **sobrepeso** y el sembrador solo firma
las marcadas `is_oversize` — el hueco exacto que `NeedsPapers` vino a cerrar—
así que rodó sin papeles aprobados.

Las dos están en `ROTAS_A_PROPOSITO` con su motivo, y el guardián comprueba que
sigan correspondiendo a un invariante de la lista. Sembrar la cadena entera
—reglas por estado, evaluación con sus entradas, validación, permisos con su
documento y escoltas— es un lote por sí solo. Quitar la firma mientras tanto
dejaría tres cargas despachadas y pagadas que no pudieron despacharse: se
cambiaría una incoherencia por otra.
