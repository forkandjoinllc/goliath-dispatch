# El gasto que el conductor entrega y no vuelve a ver

## El defecto

Un conductor tenía `expense:submit` y **no** `expense:read`. Entregaba el recibo
del combustible y se acababa ahí: `ExpenseController::index()` lo detectaba y lo
devolvía al formulario, con este comentario como justificación —«es lo único que
este dominio le ofrece»—. No podía ver si se lo aprobaron, si se lo rechazaron,
ni por qué.

Y rechazar un gasto **exige un motivo** de cinco caracteres como mínimo, escrito
para él, sobre una decisión que **no vuelve**: `ExpenseTransitions` lo sujeta
desde su propio lote —aprobar y rechazar son definitivos—. Es decir: la
aplicación le pedía a alguien de la oficina que explicara por escrito una
decisión permanente, a un lector al que le cerraba la puerta.

Es la misma forma que el lote del transportista, un rol más abajo, y peor: el
transportista al menos podía llegar a la ficha del documento. El conductor no
tenía a dónde llegar.

## Las dos mitades

Dejarle mirar sin avisarle es media solución. Avisarle sin dejarle mirar es la
otra media —y habría sido peor: un aviso que le cuenta que hay algo y una
pantalla que no se lo enseña—. Por eso van juntas:

1. **`expense:read` con alcance PROPIO** en la matriz del conductor.
   `ScopeFilter` lo resuelve por `submitted_by_user_id`, que ya estaba declarado
   en el controlador: ve los suyos y ni uno más. Lo que puede HACER no cambia —
   decidir sigue siendo `expense:approve`, que no tiene—.

2. **El aviso `expense.rejected`**, de público PROPIO, a quien lo presentó, con
   el motivo dentro y diciendo que la decisión es definitiva. Solo al rechazar:
   una campana que también suena con las buenas noticias deja de mirarse, y lo
   que hay que explicar es el «no».

El público PROPIO es el tercero del registro, junto a la oficina y el
transportista. Su regla: le llega a cualquier rol que pueda leer esa cosa,
porque la cosa **es suya por construcción**.

## Lo que cambia para cada rol

| Rol | Gastos que ve | Avisos que puede configurar |
|---|---|---|
| Administrador / Contabilidad | los de la empresa | 18, incluido el suyo propio |
| Despachador | los de sus asignados | 3 |
| Transportista | los suyos | 3 |
| **Conductor** | **los que presentó él** (antes: ninguno) | **1** (antes: 0 de 17 que podían llegarle) |

## Lo que apareció al abrirle la pantalla

El aviso de «esta carga ya está facturada o liquidada… haría falta una nota de
crédito o un ajuste» se le enseñaba también a él. Habla de mecanismos de la
oficina —y de una nota de crédito que, por cierto, este producto todavía no sabe
emitir: ver `docs/ported-dictionaries.md`—. A quien entregó el recibo del
combustible no le dice nada que pueda usar. Ahora se enseña solo a quien puede
decidir. **Lo vi en el recorrido, no en la suite**: ninguna prueba se fija en a
quién se le enseña un párrafo informativo.

## Lo que este lote NO hace

- **No avisa al aprobar.** Discutible: al conductor le interesa saber que su
  dinero va en camino. No se ha hecho porque el motivo de este lote es la
  explicación obligatoria del «no», y porque una campana que suena siempre se
  deja de mirar. Si lo quieres, es una línea en `Events::CATALOGO` y otra en el
  controlador.
- **No le da al conductor los otros silencios**: `document.rejected` le llega
  hoy al transportista y no a él, aunque el documento sea su licencia. Su ficha
  de documentos sí la ve (`document:read` con alcance propio), pero nadie le
  avisa.
- **No toca al despachador**, que sigue pudiendo recibir 3 de 19. Ver
  `docs/carrier-notices.md`.

## Ficheros

| Fichero | Qué |
|---|---|
| `app/Authorization/RoleMatrix.php` | `expense:read` con alcance propio para el conductor |
| `app/Support/Notifications/Events.php` | El público PROPIO y `expense.rejected` |
| `app/Support/Notifications/Notifier.php` | `toOwner()`, con la comprobación de permiso y de membresía activa |
| `app/Http/Controllers/App/ExpenseController.php` | Avisa al rechazar, con el motivo |
| `resources/js/pages/App/Expenses/Index.tsx` | El aviso de cifras congeladas, solo para quien decide |
| `lang/{es,en}/notifications.json` | El aviso, en los dos idiomas |
| `tests/Unit/Suite/DriverExpenseTest.php` | 7 guardianes de estructura |
| `tests/Feature/Expenses/DriverVisibilityTest.php` | 10 que miden, incluido que no ve lo ajeno |
