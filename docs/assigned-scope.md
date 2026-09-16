# El despachador que veía la empresa entera

## El defecto

Dos pantallas se estrechaban a mano, y las dos escribían exactamente lo mismo:

```php
return match ($scope) {
    Scope::Platform, Scope::Tenant, Scope::Assigned => $consulta,
    Scope::Carrier => …,
    default => $consulta->whereRaw('1 = 0'),
};
```

`Assigned` es el ámbito del **despachador**. Esa línea le devolvía la empresa
entera.

| Pantalla | Lo que veía de más |
|---|---|
| tablero de altas | nombre legal, número DOT, estado del alta, qué papeles le faltan y cuándo se revisó su FMCSA, de transportistas que no son suyos |
| firmas (lista) | todas las solicitudes de la empresa, con el correo del firmante |
| firmas (ficha) | podía **abrirlas**: el mismo `scoped()` decide `show()`, el certificado y la anulación |
| «mandar a firmar» | el desplegable le ofrecía esos transportistas |

El último ya no es ver de más: es poder mandarle un acuerdo a otro.

Medido sobre la demostración antes y después: el despachador pasa de **7 de 7**
transportistas en el tablero de altas a **2**, los dos que tiene asignados. El
administrador sigue viendo los siete.

## El síntoma que lo delataba

El tablero le ofrecía un **botón de movimiento** sobre el transportista ajeno.
La ruta de transición sí estrecha por asignación, así que contestaba 404. Dos
piezas contestando distinto a la misma pregunta: la que enseña decía «este es
tuyo» y la que actúa decía «no existe».

Es la forma del lote 23 al revés. Allí la lista era permisiva y la puerta no
existía; aquí la lista es permisiva y la puerta sí existe — así que el lado
permisivo es una fuga y el estricto, un botón muerto.

## Por qué no se aplicó la regla que existía

`Authorization\ScopeFilter` lleva desde siempre traduciendo `Assigned` a
`assignments->carrierIds`, y **catorce** sitios la usan. Pero `apply()` pide un
`Builder` de Eloquent, porque saca el nombre de la tabla del modelo:

```php
$table = $query->getModel()->getTable();
```

Y estas dos pantallas usan `DB::table('carriers as c')` con alias y join. Ante
una pieza que no encajaba se escribió el `match` a mano, y se escribió mal.

**La lección: cuando una pieza no encaja, lo que sale no es «otra forma de
hacerlo» — es una copia peor.** Encajar la pieza es más barato que la copia, y
mucho más barato que la fuga.

Ahora encaja: `ScopeFilter::applyToQuery($consulta, $alias, $columnas)`. Las dos
entradas delegan en un `narrow()` privado, así que el `match` de ámbitos vive
**una** vez — un guardián lo cuenta.

### Lo que `applyToQuery()` NO hace

No filtra por `tenant_id`. Sin modelo no puede comprobar que la columna exista,
y adivinarlo sería peor. Lo pone quien llama, antes, y un guardián lo exige:
olvidarlo sería una fuga **entre empresas**, varios órdenes peor que esta.

## La mitad que el lote 22 dejó a medias

`transportistasElegibles()` se estrechó en aquel lote con:

```php
if ($scope === Scope::Carrier) { … }
```

y su comentario decía, con razón, «el mismo estrechamiento que las FILAS de la
pantalla, para que la lista y lo que se ve no puedan decir cosas distintas». Era
verdad: el mismo, incluido el agujero. Medio `match` copiado cubre medio
problema. Su guardián en `HiddenPayloadTest` exigía esa línea literal; se
corrigió con el motivo escrito, no se relajó.

## Los guardianes

1. **Ningún brazo de `match` en `app/` mete `Scope::Assigned` en el mismo cajón
   que `Scope::Tenant`.** Es el defecto en su forma exacta y buscable.
2. **Todo `scoped()` que recibe un ámbito usa una pieza declarada** —
   `scopeFilter()`, `LoadScope`, `DocumentScope`, `MessageScope`— o está en
   `ESTRECHAN_A_MANO` con su motivo. Hoy hay una sola excepción,
   `PaymentController`: `payments` no lleva `carrier_id` y se llega al
   transportista por la factura con un EXISTS que la pieza no sabe expresar. No
   es esta fuga: comprueba `$scope->atLeast(Scope::Tenant)`, que para `Assigned`
   es **falso** —rango 3 contra 4—, así que cierra en vez de abrir.
3. **Lo declarado sigue haciendo falta.** Una excepción que ya no lo es deja de
   explicar nada y se convierte en permiso para copiarla.
4. Y el que ya existía y ahora muerde: `EmptyStateTest` obliga a que un listado
   que acota le diga el ámbito a la vista, o lo declare. Las dos pantallas
   entraron en esa lista **al arreglarse**, con su motivo: ninguna de las dos
   usa el panel de estado vacío, y ahora un despachador sin transportistas
   asignados ve un tablero vacío sin saber si es que no hay altas o es que no
   son suyas. Es el siguiente lote, no este.

## El despachador recién llegado

Cuando `assignments->carrierIds` viene vacío no hay columna que casar, y la
pieza cierra (`1 = 0`) en vez de abrir. Lo destapó un sabotaje que cambiaba ese
cierre por `1 = 1` y se quedó en verde: todas las pruebas tenían un despachador
CON una asignación. Séptima vez que aparece la misma forma — un fixture de una
sola fila no prueba el `where`.

## Lo que esto NO arregla

Que el reparto de asignaciones sea el correcto. `dispatcher_resource_assignments`
dice quién lleva qué; esto solo hace que las pantallas lo respeten.

## Guardianes

- `tests/Unit/Suite/AssignedScopeTest.php` — siete comprobaciones.
- `tests/Feature/Authorization/AssignedScopeTest.php` — diez, con los tres roles.
- `tests/Unit/Suite/HiddenPayloadTest.php` y `EmptyStateTest.php`, corregidos.

Diez sabotajes verificados uno a uno.
