# El transportista que se borraba con el camión en la carretera

## El defecto

La regla existía, escrita entera y con su motivo, dentro de
`CustomerController::destroy`:

> Un cliente con cargas vivas no se borra. No es una regla de conveniencia: la
> carga necesita saber a quién facturar, y un cliente borrado en mitad de un
> viaje deja una factura sin destinatario.

**Al transportista no se le aplicó nunca.** Y de las dos fichas que se pueden
borrar, el cliente pone el dinero y el transportista pone el camión.

Medido sobre los datos de demostración, antes de arreglarlo:

```
carga GD-24002 · estado in_transit · transportista Transportes Cordillera
DELETE /carriers/{id}   ->   sin negativa, borrado suave aplicado
ficha de la carga       ->   «—» donde va quién la lleva
pantalla de rastreo     ->   «Transportes Cordillera S. de R.L.»
```

La aplicación decía **dos cosas distintas sobre la misma carga viva**, y ninguna
pantalla había avisado.

## Y el diálogo prometía la regla del otro

El texto de confirmación del transportista es casi la misma frase que el del
cliente:

> Este transportista dejará de aparecer en los listados. Las cargas y facturas
> históricas siguen nombrándolo. ¿Continuar?

Habla solo de lo **histórico**. Es exacta para el cliente, cuyo código se niega
cuando hay algo vivo. Para el transportista describía una situación —«solo queda
lo viejo»— que su código no garantizaba.

## Qué cuenta como trabajo abierto

`App\Support\Deletion\OpenWork`, un sitio para las dos fichas.

| Ficha | Qué se cuenta |
|---|---|
| Las dos | cargas que no estén ni `paid` ni `cancelled` — los dos únicos estados terminales de `loads.status` |
| Transportista | además, liquidaciones en `draft` o `issued` (dinero que se le debe) |
| Transportista | además, facturas **con saldo** (dinero que él debe) |

Dos decisiones que no son obvias:

**`delivered` no es terminal.** Una carga entregada y sin facturar sigue
debiendo una liquidación. Un sabotaje que metía `delivered` entre los estados
cerrados pasó en verde hasta que se añadió una prueba que lo ejercita: se podía
borrar al transportista que acababa de entregar.

**Las facturas se miran por SALDO, no por estado.** Una `sent` con saldo cero
está cobrada; una `disputed` con saldo sigue viva. El estado no contesta la
pregunta.

**No cuentan sus conductores ni sus equipos.** No son trabajo abierto: son fichas
que quedan colgando. Es un problema distinto y menor que borrar a quien está
llevando una carga; queda dicho aquí y no se toca.

## La pantalla avisa antes de ofrecer el botón

Es el patrón que las cargas ya usan con `Guards::blocking`: el servidor manda
**qué** bloquea y la pantalla lo explica, en vez de dejar pulsar y contestar con
un error.

```
CON trabajo abierto   No se puede borrar todavía
                      Tiene 1 carga sin cerrar, 1 factura con saldo. Un
                      transportista borrado en mitad de un viaje deja la carga
                      sin saber quién la lleva.

SIN trabajo abierto   [ Eliminar transportista ]
```

El servidor se niega igual —nunca se confía en el cliente— y devuelve 422 con el
mismo detalle. Comprobado en los dos idiomas.

El mensaje dice **qué** está abierto y cuánto, no solo que no se puede: un «no se
puede» a secas manda a buscar. La concordancia de número pasa por
`App\Support\Plural`, que es la misma regla que aplica el cliente sobre el mismo
diccionario JSON.

## El guardián

`tests/Unit/Suite/OpenWorkTest.php` — 11 comprobaciones, **18 sabotajes**:

1. Las dos fichas consultan la misma pieza, y la consulta ya no está suelta en
   el controlador del cliente. Escrita dos veces se separa, que es exactamente
   cómo llegó a estar en una sola.
2. `CARGAS_CERRADAS` es **exactamente** `['paid','cancelled']`, y los dos existen
   en un CHECK del esquema — un estado renombrado haría que la comparación no
   casara con nada y no bloqueara nada.
3. Las dos pantallas reciben lo que bloquea y **cortan antes** de ofrecer el
   botón; se fija la condición, no solo el texto.
4. Todo `destroy()` de una ficha comprueba sus dependencias y está declarado en
   `BORRADOS_DE_FICHA` con **cuál** y **por qué**.

`tests/Feature/Carriers/DeleteBlockedTest.php` — 11 pruebas que piden la ruta:
bloquea con carga en tránsito, entregada, facturada, con liquidación sin pagar y
con factura con saldo; **no** bloquea con una factura ya cobrada; borra cuando
todo está cerrado y lo hace en suave; y la pieza cuenta lo de cada transportista
y no lo de la empresa.

## Por qué el registro no fuerza una sola pregunta

`BORRADOS_DE_FICHA` declara tres controladores y **dos preguntas distintas**:

- `OpenWork` responde «¿queda trabajo sin terminar?». Una carga cerrada hace años
  no impide borrar a su transportista.
- `FactoringController` cuenta por su cuenta sobre `factoring_assignments`: ahí
  la pregunta es «¿lo nombra algo, lo que sea?», y una asignación cerrada lo
  nombra igual.

Forzar las dos a una sola sería falsa uniformidad. Lo que el guardián exige es
que cada borrado compruebe **algo**, que se niegue **por lo que contó** —un
sabotaje con `if (false)` pasó en verde hasta que la aguja usó una
retrorreferencia— y que diga aquí cuál de las dos preguntas hace.
