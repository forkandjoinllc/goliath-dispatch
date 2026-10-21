# Con quién factoriza un transportista

Lote 46. Qué se guarda, dónde, y por qué **declarado** y **asignado** son dos
cosas distintas que viven en sitios distintos.

---

## El agujero que había

El alta pública tenía, desde el principio, una casilla: «I factor my invoices».
Se marcaba, se escribía `carriers.uses_factoring = 1`, y ahí se acababa. **Nunca
se preguntaba con quién.** La casa de despacho se quedaba con una fila que dice
«sí, hace factoring» y no dice con quién — que es la que luego nadie sabe
explicar cuando hay que mandar una liquidación.

En **goliathdispatch.com** era peor. Allí no hay empresa a la que pertenecer, no
se crea `carriers`, y `leads` no tenía la columna. La respuesta no se guardaba a
medias: **se tiraba entera**. La persona contestaba una pregunta que no iba a
ningún sitio.

Y la ficha del transportista, en el panel, decía «Factoring: Sí» — sin decir con
quién, **aunque la asignación estuviera en la base**.

---

## Lo que ya existía, y que cambió el tamaño del trabajo

El plan de este lote decía añadir `carriers.factoring_company_id`. Leyendo el
código apareció que casi todo estaba hecho:

| Pieza | Dónde | Estado |
|---|---|---|
| Desplegable de factoring en el panel | `CarrierController::factoringOptions()` | Hecho. Solo las activas |
| Validación de que el identificador es de esta empresa | `CarrierController::syncFactoring()` | Hecho |
| Cierre en suave de la asignación anterior | `syncFactoring()` | Hecho |
| La asignación con vigencia, carta de cesión y verificación | `factoring_assignments` | Hecho |

Y un comentario en `CarrierController` que dice, textualmente, que la asignación
vive en `factoring_assignments` **y no en una columna de `carriers`**, porque
tiene vida propia: fechas de vigencia, la carta de cesión, el cambio de
beneficiario y quién lo verificó.

Añadir `carriers.factoring_company_id` habría sido una **segunda respuesta a la
misma pregunta**. Dos sitios que contestan «¿con quién factoriza?» acaban
contestando cosas distintas, que es justo el defecto contra el que el propio
plan avisaba cuando hablaba de dos listas.

---

## Declarado ≠ asignado

Lo que faltaba no era la asignación: era **lo que el transportista dice de sí
mismo**.

- **Asignada** — hay fila en `factoring_assignments`. La casa estableció el
  vínculo. Puede llevar carta de cesión y verificación.
- **Declarada** — el transportista dijo un nombre al darse de alta y nadie lo ha
  convertido en asignación. Es una afirmación suya.
- **Ni una ni otra** — dijo que factoriza y no hay nada más. Pasa cuando un
  despachador marca la casilla sin saber todavía la empresa.

**Un tercero rellenando un formulario público no puede crear un vínculo
verificado.** Si el alta creara la asignación, la fila nacería afirmando una
relación que nadie comprobó — y `factoring_assignments` tiene
`verification_status` precisamente porque esa comprobación la hace la casa.

Pasar de declaración a asignación es un acto de la casa: abrir la ficha y
guardar. El formulario preselecciona lo declarado **y lo dice**.

---

## Las columnas

### `carriers`

```
factoring_declared_company_id  char(36)      null   -- estaba en la lista
factoring_declared_name        varchar(200)  null   -- escribió el nombre
```

### `leads`

```
uses_factoring         tinyint(1)    not null default 0
factoring_company_id   char(36)      null
factoring_company_name varchar(200)  null
```

Nunca las dos a la vez: un nombre suelto y una ficha son dos respuestas a la
misma pregunta.

El texto **se conserva** aunque después alguien cree la ficha y la enlace — la
lección del arrendador del lote 41 (`trucks.lessor_name` se quedó cuando llegó
`lessor_vendor_id`). Vaciarlo al enlazar borraría en silencio lo único que el
transportista llegó a decir.

---

## Lo que la base impide, y lo que NO

**Impide** el estado imposible estrecho:

- si `uses_factoring = 0`, no puede haber ni ficha ni nombre;
- nunca hay ficha **y** nombre a la vez;
- la ficha es de ESTA empresa — la clave foránea es compuesta contra
  `(tenant_id, id)`, igual que `fk_carrier_settlements_factoring_company_xt`. Un
  identificador de la lista de otra empresa no entra aunque alguien lo pegue en
  la petición.

**NO impide** —ni puede— que `uses_factoring = 1` y no haya ninguna de las dos.
Esa comprobación cruzaría con `factoring_assignments`, que es otra tabla, y un
CHECK no mira otras tablas. Además hay un caso legítimo: el despachador que sabe
que el transportista factoriza y todavía no sabe con quién.

Lo que se hace con ese estado es **enseñarlo** —la ficha dice «Sí — sin empresa
registrada»— en vez de fingir que la base lo ha prevenido.

---

## El formulario público

### Un solo campo, dos formas de rellenarlo

El desplegable y la casilla de «Other» escriben **el mismo campo**:
`factoring_company_name`. Quien elige de la lista manda el nombre que leyó;
quien escribe manda el que teclea. El servidor decide si eso tiene ficha detrás
(`PublicFactoring::resolve()`).

Dos campos —uno con el identificador elegido y otro con el nombre escrito—
habrían permitido mandar los dos y dejar al servidor decidiendo cuál de las dos
respuestas creerse. Con uno solo ese estado no existe.

### Por nombres, no por identificadores

A la página pública viaja un `list<string>`. Mandar los UUID de
`factoring_companies` al navegador sería publicar los identificadores internos
de una tabla de la empresa **a cambio de nada**: el nombre ya es único por
empresa (`factoring_companies_tenant_name_uq`) y el servidor puede resolverlo.

La comparación la hace MySQL con el cotejamiento de la columna
(`utf8mb4_0900_ai_ci`): insensible a mayúsculas y acentos, que es como la gente
escribe el nombre de su empresa de factoring.

### Lo que esto SÍ publica, dicho claro

**Los nombres** de las empresas de factoring con las que trabaja la casa de
despacho quedan visibles para cualquiera que abra el alta pública. Es una
decisión deliberada: sin lista no hay desplegable, y sin desplegable el
transportista escribe el nombre a mano con una coma de más y la pregunta vuelve
a no tener respuesta.

Lo que **no** sale, y hay un guardián que lo sujeta: contactos, correos,
teléfonos e `funding_instructions`. La ficha de una empresa de factoring lleva
instrucciones de pago.

Solo salen las **activas**, igual que en el panel: una inactiva sigue valiendo
para quien ya la tiene —la carta de cesión no se anula porque cambiemos una
casilla— pero no debe poder elegirse de nuevo.

### Sin empresa no hay lista

En goliathdispatch.com `factoringCompanies` llega vacía y la pantalla enseña
directamente la casilla de texto. Un desplegable vacío sería un filtro que no
puede encontrar nada — el mismo defecto que se arregló en el lote 43.

---

## La regla del formulario

Decir que se factoriza **obliga** a decir con quién
(`required_if_accepted:uses_factoring`). La casilla sin el nombre es exactamente
la fila que este lote viene a quitar.

Y un nombre colgando de un «no» se rechaza antes de llegar a la base
(`prohibited_if_declined:uses_factoring`), para que el CHECK no tenga que
rechazarlo **después** de que la persona haya pulsado enviar.

El nombre se recorta antes de validarlo: « ACME » y «ACME» son la misma empresa,
y sin recortar la primera no coincide con la ficha y acaba guardada como texto
suelto.

---

## Lo que se ve en el panel

**Ficha del transportista** — con quién, y en qué calidad:

| Estado | Qué se pinta |
|---|---|
| Asignada | el nombre de la empresa |
| Declarada, con ficha | el nombre + «declarada, sin asignar» |
| Declarada, sin ficha | el nombre + «declarada, sin ficha» |
| Solo «sí» | «Sí — sin empresa registrada», en gris |

**Formulario del transportista** — si no hay asignación y sí declaración, el
desplegable queda preseleccionado y un aviso dice que guardar la asigna. Si el
transportista escribió un nombre que no está en la lista, el desplegable no
puede ofrecerlo: el aviso enseña el texto y dice que no tiene ficha, en vez de
dejar la casilla marcada y el desplegable en blanco sin explicar por qué.

Una ficha **desactivada después del alta** no se preselecciona: el desplegable
solo lleva las activas, y preseleccionar un valor que no está entre las opciones
deja el desplegable enseñando otra cosa de la que dice tener.

**Prospectos** — la respuesta aparece solo cuando dijo que sí. Pintar «Factoring:
No» en un prospecto del formulario de contacto, que nunca vio la pregunta, sería
ponerle en la boca una respuesta que no dio.

---

## Qué queda fuera

- **No se crea la ficha de factoring desde el formulario público.** Un
  desconocido no da de alta datos maestros de la empresa: sería una vía directa
  para ensuciar la lista.
- **No se verifica nada.** `verification_status` sigue siendo cosa de la casa.
- **Nada de esto decide a quién se paga.** La liquidación sigue mirando
  `factoring_assignments`, como antes.
