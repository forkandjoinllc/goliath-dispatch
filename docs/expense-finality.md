# El gasto aprobado que nadie puede revertir

## La pantalla prometía una puerta que no existe

Al intentar rechazar un gasto ya aprobado, el diccionario tenía escrito esto:

> Un gasto aprobado no se puede rechazar directamente. **Comuníquese con un
> administrador para revertirlo.**

No hay reversión. Ni para un administrador, ni para nadie:

- `approve` y `reject` solo aceptan un gasto en `submitted`;
- `reimburse` solo uno en `approved`;
- no existe ruta, acción ni permiso que devuelva un gasto decidido a ningún
  estado anterior.

El mensaje mandaba a una persona a pedirle a otra lo que esa otra tampoco puede
hacer.

Y no es una molestia de trámite. Un gasto aprobado **cuenta en la base de
comisión** —`countingCents` suma `approved` y `reimbursed`—, así que un clic
equivocado se queda dentro del cálculo del dinero para siempre, mientras el
producto asegura que alguien lo deshace.

## La frase falsa no la leía nadie, y eso lo empeora

Esa copia vive en `lang/{es,en}/finance.json`, con la clave
`errors.cannotRejectApprovedExpense`, y **ningún código la pide**. Lo que el
controlador lanzaba de verdad era otra:

> `expenses.errors.badTransition`: «Ese gasto ya no está en un estado donde esto
> se pueda hacer. Recargue la página.»

Que también miente, de otra manera: sugiere una vista desactualizada —algo que
se arregla recargando— cuando lo que pasa es que la decisión es permanente.

Dos textos equivocados sobre lo mismo, uno muerto y otro vivo. El muerto me
engañó a mí: lo cité como si fuera lo que el usuario ve. Por eso el guardián de
este lote vigila **también la copia que nadie lee**: engaña igual al siguiente
que la encuentre.

## Qué se ha hecho

1. **La tabla de transiciones sale a un sitio con nombre**:
   `app/Support/Finance/ExpenseTransitions.php`. Vivía dentro de un `match` en
   un método privado del controlador, y la copia del error se escribía aparte:
   dos sitios que hablan de lo mismo sin mirarse. Ahora la pantalla puede
   **preguntarle** en vez de suponer.

2. **El mensaje de error se deriva de la tabla**. Dos frases para las dos
   situaciones que ocurren de verdad:

   - `expenses.errors.onlyThese` — «Un gasto aprobado solo puede pasar a:
     reembolsado.» Nombra lo que sí queda.
   - `expenses.errors.noWayOut` — «Un gasto reembolsado ya no se mueve a ningún
     sitio.» Dice que ahí se acabó.

3. **El aviso va antes del clic**, que es cuando sirve
   (`expenses.index.decisionIsFinal`): «Decidir no se deshace: un gasto aprobado
   o rechazado no vuelve a estar pendiente, y el aprobado entra en la base de
   comisión.» Un aviso debajo de los botones lo lee quien ya decidió.

4. **Se borran las dos frases falsas**: `finance.errors.cannotRejectApprovedExpense`
   y `expenses.errors.badTransition`, en los dos idiomas.

5. **Una tercera promesa falsa, encontrada por el propio guardián**:
   `customer.contacts.deleteConfirm` decía «¿Eliminar este contacto? Un
   administrador puede deshacer esta acción» / «This can be undone by an
   administrator». No hay ruta de restauración de contactos en toda la
   aplicación: el borrado es en suave, pero el formulario busca al contacto
   existente con `whereNull('deleted_at')`, así que volver a añadirlo crea una
   fila nueva, con otro id y sin su historial ni sus ubicaciones. La línea se ha
   eliminado.

## Dos métodos que solo usan las pruebas, y por qué se quedan

`sinRetorno()` y `esFinal()` no los llama el código de producción. Escribí
`sinRetorno()` para una tercera frase de error —«a este estado no se vuelve»— y
luego la quité: **ninguna ruta pide esa transición**, así que era copia que nadie
podía leer, la enfermedad exacta que este lote cura. Los métodos se quedan
porque son quienes sujetan el registro `SIN_RETORNO`: el guardián `cada callejón
sin salida está declarado con su motivo` los usa para comprobar que la tabla y
el registro dicen lo mismo. Si algún día sobra uno, sobra con su guardián.

La distinción entre los dos no es cosmética, y me costó dos intentos:
`approved` **no** es final —va a `reembolsado`, con su botón al lado— pero
tampoco tiene vuelta. Confundirlos hacía que la pantalla dijera que un gasto
aprobado no puede ir a ninguna parte, con el botón de «Marcar reembolsado»
visible en la misma tarjeta.

## Lo que este lote NO decide: ¿debería haber vuelta?

**Esto te toca a ti.** El lote dice la verdad sobre lo que hay; no cambia lo que
nadie puede hacer.

El argumento a favor de construir la reversión: un gasto aprobado por error
contamina la base de comisión, y hoy la única salida es crear otro gasto que lo
compense —contabilidad creativa a mano, hecha por quien menos debería.

El argumento en contra: añadirle una puerta al dinero ya aprobado es un cambio
de producto, no un arreglo. Necesitaría su permiso propio (¿quién?), su motivo
obligatorio, su rastro en auditoría, y una decisión sobre qué pasa si la carga
ya está facturada o liquidada —sus cifras están congeladas en
`financial_snapshots`, y una reversión que no las toque deja la factura diciendo
una cosa y el gasto otra.

Si decides que sí, el sitio donde se declara es `ExpenseTransitions::DESDE`, y
el guardián `ninguna ruta pide una transición que la tabla no tiene` te obligará
a declararla antes de poder usarla.

## Deuda vecina, nombrada y no tocada

`lang/{es,en}/finance.json` tiene **24 claves bajo `errors` que no lee nadie**.
Y `lang/{es,en}/customer.json` —122 hojas, en los dos idiomas— parece un
diccionario entero muerto: el espacio `customer.` no lo pide ningún `t()` ni
ningún `__()`, y lo que la pantalla de clientes usa es `customers.json`. No se
ha borrado aquí porque borrar 244 cadenas es su propio lote, y porque conviene
que lo mires antes.

## Ficheros

| Fichero | Qué |
|---|---|
| `app/Support/Finance/ExpenseTransitions.php` | La tabla: `permitida` y `salidasDe` en producción; `esFinal` y `sinRetorno` los usan los guardianes |
| `app/Http/Controllers/App/ExpenseController.php` | `decide()` pregunta a la tabla; `porQueNo()` deriva el mensaje |
| `resources/js/pages/App/Expenses/Index.tsx` | El aviso antes del clic |
| `lang/{es,en}/expenses.json` | `errors.onlyThese`, `errors.noWayOut`, `index.decisionIsFinal`; fuera `errors.badTransition` |
| `lang/{es,en}/finance.json` | Fuera `errors.cannotRejectApprovedExpense` |
| `lang/{es,en}/customer.json` | Fuera `contacts.deleteConfirm` |
| `tests/Unit/Suite/ExpenseFinalityTest.php` | 9 guardianes de estructura |
| `tests/Feature/Expenses/FinalityTest.php` | 5 pruebas que miden la imposibilidad, rol por rol |
