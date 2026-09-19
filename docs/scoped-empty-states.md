# El guardián que solo cazaba la forma que él escribía

## El defecto

`tests/Unit/Suite/EmptyStateTest.php` existe para que ningún listado acote la
consulta sin decírselo a la vista. Su docblock lo dice con todas las letras:

> Que un listado que ACOTA la consulta y no manda el alcance a la vista esté
> declarado abajo con su motivo. **Es lo que impide que entre el séptimo.**

Entró el séptimo. Esto es lo que el guardián usaba para reconocer un listado
que acota:

```php
$acota = preg_match('/scopeFilter\(|LoadScope::apply|DocumentScope::|MessageScope::/', $fuente) === 1;
$manda = str_contains($fuente, "'scope' => \$scope->value");
```

Dos cadenas de texto. No mide si la consulta se estrecha: **mide cómo está
escrita**. Y `PaymentController` está escrito de otra manera, por una razón que
él mismo explica:

```php
// `payments` no lleva `carrier_id`: se llega al transportista por la
// factura. Con alcance de transportista se estrecha con un EXISTS, que
// es lo que ScopeFilter no sabe expresar por sí solo.
```

Así que cobros acota —con un `whereExists` sobre `invoices`, y con
`whereRaw('1 = 0')` para un usuario de transportista sin transportista— y el
guardián no lo vio. No estaba declarado. Y su pantalla decía, para los cuatro
casos a la vez:

> **Ningún cobro coincide.**

Un transportista que abre /cobros sin poner ningún filtro lee que nada
*coincide*. Nada coincide ¿con qué? No hay nada puesto. La lista viene acotada
a sus propias facturas y la frase culpa a un filtro que no existe.

## Y estaba mal por los dos lados

La otra cadena —`'scope' => $scope->value`— decide si un listado «se lo dice a
la vista». Pero **dos listados se lo dicen de otra forma**: `AssignmentController`
y `CommissionController` mandan `'onlyMine' => ! $scope->atLeast(Scope::Tenant)`,
que dice menos pero dice la verdad, y sus pantallas lo usan («Mis asignaciones»,
el subtítulo de comisiones). El día que el detector los hubiera visto acotar,
los habría contado como deuda que no tienen.

Un detector que solo reconoce su propia forma de escribir falla en las dos
direcciones: se le escapa lo que está escrito de otro modo, y reclama lo que ya
está resuelto de otro modo.

## Lo que decide ahora

El hecho de si a alguien le puede llegar la lista recortada **no está en la
consulta: está en la matriz de permisos**. Un listado puede venir acotado si
algún rol tiene alguno de los permisos que ese controlador autoriza con alcance
por debajo de empresa. Da igual si la consulta lo aplica con `ScopeFilter`, con
un `whereExists` a mano o dentro de una clase de informe.

```php
foreach (permisosQueAutoriza($fuente) as $permiso) {
    foreach (Role::cases() as $rol) {
        $alcance = RoleMatrix::for($rol)[$permiso] ?? null;

        if ($alcance !== null && ! $alcance->atLeast(Scope::Tenant)) {
            $quien[] = "{$rol->value}:{$alcance->value}({$permiso})";
        }
    }
}
```

`RoleMatrix` es la fuente: cuando cambie un alcance, el detector cambia con
ella. Y se comprueba que mide algo — que ve acotado a cobros, que ve acotadas
igual las facturas (mismo permiso, otra forma de consulta) y que **no** ve
acotada la bitácora, porque un detector que dijera «acotado» de todo también
reportaría verde, por el otro lado.

### Tres registros, no uno

| Registro | Qué declara | Qué se comprueba solo |
|---|---|---|
| `DICEN_EL_ALCANCE` | cómo se lo dice cada listado a su vista: `scope` u `onlyMine` | que el controlador la manda **y** que la pantalla la usa para pintar algo |
| `PERSONALES` | bandejas de una sola persona por naturaleza (avisos) | que la consulta de la lista acota por `user_id` del actor |
| `ACOTAN_SIN_DECIRLO` | la deuda que queda, con su motivo | que sigue existiendo: si la matriz deja de acotarla, la entrada sobra |

El de las props se comprueba **en el cuerpo** del componente de React, no en el
fichero: `onlyMine: boolean` y el desestructurado la nombran igual aunque nadie
la mire después. El de las bandejas personales se comprueba **en el método** que
pinta la lista, no en el fichero: quitar el filtro del listado y dejarlo en el
contador de la campana pasaba por bueno.

Y quien exige alcance de empresa —factoring— queda fuera del detector porque su
pantalla contesta 403 antes de consultar nada; también eso se comprueba por lo
que el ayudante hace (`atLeast(Scope::Tenant)`) y no por su nombre.

## Lo que el detector nuevo encontró

Tres listados que nadie contaba:

| Listado | Quién lo ve acotado | Qué se hizo |
|---|---|---|
| `PaymentController` | transportista (`invoice:read`) | **arreglado**: manda el alcance y usa el componente |
| `ReportController` | transportista y despachador (`report:read`) | declarado, con motivo |
| `NotificationController` | los seis roles (`own`) | declarado como bandeja personal, con la comprobación de que lo es |

## Cobros, arreglado

Manda `'scope' => $scope->value` y la pantalla usa `<EmptyState>`, que dice una
cosa distinta en cada uno de los cuatro casos. Comprobado en los dos idiomas
contra la demostración:

| Situación | Lo que dice ahora |
|---|---|
| Transportista, ninguno suyo | «Aquí solo sale su transportista — Esta lista está acotada a su transportista, y todavía no hay nada suyo» |
| Empresa, con un filtro puesto | «Ningún cobro coincide con estos filtros — Quite el filtro de estado, método o factura» |
| Empresa, sin ningún cobro | «Todavía no hay cobros — Un cobro aparece cuando un cliente paga una factura, o cuando alguien lo anota contra ella desde la propia factura. Aquí no se da de alta ninguno» |

### Por qué hizo falta tocar el componente

La cuarta rama del componente pregunta «¿puede usted crear?» y, cuando no,
responde `common.states.emptyNoPermission`:

> Su empresa todavía no ha dado de alta ninguno, y su cuenta no puede crearlos.
> Pídaselo a un administrador.

En cobros eso es falso dos veces: un cobro no se da de alta —aparece cuando el
cliente paga, o cuando alguien lo anota contra la factura, en la pantalla de la
factura— y pedírselo a un administrador no hace que aparezca. Por eso la
pantalla pasa `createdElsewhere`, y entonces la cuarta rama usa la pista del
propio dominio, que es la única que sabe de dónde vienen sus filas.

La salida es fácil de usar como atajo —puesta en una pantalla que sí crea,
esconde el «no tiene permiso» detrás de una pista amable— así que un guardián
exige que quien la declare no pase permiso de crear ni mande uno a la vista.

## Lo que este lote NO hace

No arregla los ocho listados de `ACOTAN_SIN_DECIRLO`, que siguen contados con su
motivo. Y no toca informes más allá de declararlo: su pantalla no es una lista
con filtros sino cinco tablas de un periodo que repiten «Nada en este periodo»,
y decir el alcance ahí obliga antes a decidir si la frase es de cada tabla o de
la pantalla entera.
