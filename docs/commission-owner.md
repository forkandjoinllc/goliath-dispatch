# La comisión que se restaba del margen y no era de nadie

## El defecto

`loads.dispatcher_user_id` se escribía en **un solo sitio y una sola vez**, al
dar de alta la carga:

```php
$load->dispatcher_user_id = $actor->role === Role::Dispatcher ? $actor->userId : null;
```

Ninguna otra escritura en toda la aplicación: ni al asignar, ni al editar, ni
una pantalla donde cambiarla. Y la matriz de roles remata la trampa:

| Rol | ¿Crea cargas? | ¿Toca el dinero? | ¿Queda como dueño? |
|---|---|---|---|
| Administrador | sí | sí | **no** — no es despachador |
| Contabilidad | no | sí | no |
| Despachador | sí | **no** | sí, solo si la crea él |

O sea: en una oficina donde las cargas las mete un administrador —lo normal— **no
se devengaba ninguna comisión, nunca**.

## Lo que pasaba, en orden

1. `Calculator` calcula la comisión igual. Sale de `dispatcher_commission_bps`,
   que por omisión es la política de la empresa (25 % en la base de
   demostración), y **se congela en la instantánea financiera** al facturar.
2. `LoadFinancials::netAfterCommission` la **resta**: el informe del periodo dice
   que la casa ganó menos.
3. `CommissionLedger::accrue()` miraba la columna, la encontraba nula y
   **devolvía sin escribir nada**.

Resultado: dinero descontado del margen que no se le debe a nadie, ninguna fila
que pagar, la pantalla de Comisiones vacía, y ni un mensaje. La pantalla de la
carga, mientras tanto, enseñaba «Comisión del despachador − $62.50» como si
alguien fuera a cobrarlo.

Y la base de demostración **sí** tiene despachador en diez de once cargas —lo
escribe el sembrador, no la aplicación—, así que el demo enseña un módulo de
comisiones funcionando que una instalación real casi no puede producir.

## Qué se ha hecho

1. **`App\Support\Finance\CommissionOwner`** contesta en un sitio las dos
   preguntas que estaban repartidas: quién gana la comisión de esta carga, y si
   nadie, **por qué** — con el motivo declarado y su texto, no un `return null`
   sin frase.

2. **Se puede asignar.** El dueño viaja con el resto del dinero de la carga
   (`load:financials:update`), se valida contra la misma lista que se ofrece en
   el desplegable, y esa lista son **despachadores activos de esta empresa**: un
   id de otra empresa o de alguien suspendido crea una comisión que nadie
   reclama, que es este mismo defecto con otra ropa.

3. **Quien crea siendo despachador sigue quedándose la suya** sin tener que
   decirlo. Lo que cambia es que ya no es la única forma.

4. **Se acabó el silencio.** Cuando hay comisión calculada y no hay dueño, el
   hecho se anota en la pista de auditoría con su motivo y `accrued: false`. Es
   lo que contesta «¿por qué el informe de marzo dice que ganamos menos y no hay
   comisión que pagar?» seis meses después.

5. **La pantalla lo dice donde se mira la cifra**: justo bajo la línea de la
   comisión y antes del margen neto.

## Lo que este lote NO decide

**Si el margen debería seguir restando una comisión que no se devenga.** Hoy la
resta —`netAfterCommission = grossMargin − dispatcherCommission`— y este lote no
lo cambia, a propósito: tocar la fórmula cambia lo que significan los informes y
lo que se congela en las instantáneas futuras, y eso se decide mirándolo de
frente. Las dos posturas son defendibles:

- **Dejarlo como está**: el porcentaje es una política de la carga y el margen
  neto es «lo que queda después de repartir», tenga o no tenga destinatario hoy.
- **No restarla sin dueño**: si nadie va a cobrarla, la casa se la queda y el
  margen real es mayor. Los informes dirían la verdad de la caja.

Con el aviso nuevo, al menos nadie lee la cifra creyendo que hay alguien
esperando ese dinero. **Queda abierto y es tuyo.**

## Lo que esto destapó en la propia suite

`tests/Feature/Finance/CommissionTest.php` —de otro lote— tiene un ayudante que
escribe `dispatcher_user_id` **a mano en la tabla**, con este comentario:

> «El despachador importa: sin `dispatcher_user_id` no hay comisión de nadie, y
> el escenario no lo pone porque sus cargas no se despachan a mano.»

Tenía razón, y el defecto estaba ahí a la vista: las pruebas llevaban lotes
plantando lo que la aplicación no sabía producir, y eso hacía que el módulo
pareciera cubierto.

## Ficheros

| Fichero | Qué |
|---|---|
| `app/Support/Finance/CommissionOwner.php` | Quién la gana, por qué no, y quién puede serlo |
| `app/Support/Finance/CommissionLedger.php` | Pregunta al registro y anota la huérfana |
| `app/Http/Controllers/App/LoadController.php` | El dueño se asigna, se valida y se enseña |
| `resources/js/pages/App/Loads/Form.tsx` | «Comisión para», junto al porcentaje |
| `resources/js/pages/App/Loads/Show.tsx` | El aviso, bajo la cifra |
| `lang/{es,en}/loads.json` | Campo, aviso y error, en los dos idiomas |
| `tests/Unit/Suite/CommissionOwnerTest.php` | 7 guardianes de estructura |
| `tests/Feature/Finance/CommissionOwnerTest.php` | 10 que miden el dinero |
