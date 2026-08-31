# Retención y bloqueo legal

Cuánto tiempo se conservan los registros, qué se archiva, qué se purga, y cómo
se detiene todo eso cuando hay una reclamación de por medio.

> **Este módulo no garantiza el cumplimiento de ninguna norma.** Aplica los
> plazos que alguien configure. Si esos plazos son los correctos para la
> jurisdicción, el tipo de carga y los contratos de una empresa es una decisión
> de un abogado, no de este software. Lo mismo vale para el bloqueo legal: la
> herramienta detiene el borrado, y qué hay que preservar y desde cuándo lo
> decide quien lleva el asunto. Ver **Lo que esto NO es** al final.

## Lo que arregla

La pantalla de configuración llevaba desde el primer día diciéndole al usuario
esto, palabra por palabra:

> Retención: los registros están activos {months} meses, se purgan {purge} años
> después de archivarse, y los financieros se conservan {financial} años.

Y no era verdad. Las tres cifras se guardaban en `tenant_settings`, se pintaban
en pantalla, y **ninguna línea de la aplicación las leía nunca**. Además:

- **30 tablas** llevan una columna `legal_hold` que nadie escribía.
- **34** llevan `archived_at` y `purge_eligible_at`, tampoco escritas por nadie.
- `legal_holds` y `retention_jobs` existían vacías, con `retention_jobs` llegando
  al detalle de tener `skipped_legal_hold_count`.
- Dos acciones de auditoría —`legal_hold.applied` y `legal_hold.released`—
  declaradas y nunca emitidas.

Estaba diseñado entero y no se ejecutaba nada. El efecto práctico era doble:
nada se purgaba jamás —los borrados suaves se acumulan para siempre— y, al
revés, cuando surgía una reclamación no había forma de decir «esto no se toca».

Una pantalla que promete una política que no existe es peor que no tener la
pantalla: quien la lee deja de preguntar.

## Las dos clases de registro

| Clase | Qué incluye | Cuándo se archiva |
|---|---|---|
| `operational` | Cargas, hilos, mensajes, avisos, seguimiento, permisos, documentos, firmas | Al cumplir `operational_active_months` |
| `financial` | Facturas, cobros, gastos, liquidaciones, comisiones, instantáneas | Al cumplir `financial_retention_years` |

No es un capricho: los papeles de un viaje y los papeles del dinero de ese viaje
se conservan durante plazos distintos, y el segundo es más largo. Mezclarlos
obligaría a usar el plazo largo para todo —la forma cara de equivocarse— o el
corto —la forma grave—.

La lista está enumerada a mano en `Policy::ENTITIES` y no se deduce de «¿tiene
columna `archived_at`?»: tenerla no significa que se deba barrer. La lista dice
qué se ha **decidido** barrer.

## Archivar y purgar no se parecen

| | Archivar | Purgar |
|---|---|---|
| Qué hace | Pone `archived_at` y `purge_eligible_at` | `DELETE` |
| Se deshace | Sí, poniéndolas a nulo | **No** |
| De fábrica | Encendido | **Apagado** |

La purga permanente va detrás de `RETENTION_PURGE_ENABLED`, apagada de fábrica.
No es cobardía: el coste de las dos equivocaciones no se parece en nada. Purgar
de menos deja unos gigabytes de más en una tabla. Purgar de más borra la prueba
de un pleito. Una empresa la enciende el día que ha leído en la pantalla —en
seco— qué se va a borrar.

**No hay botón de purgar en la interfaz.** Un botón así es un botón que alguien
pulsa por curiosidad un viernes. La purga la ejecuta el planificador.

### Las cuatro condiciones para purgar una fila

1. Su tabla está en la política y no es de las intocables.
2. Está archivada y su `purge_eligible_at` ya pasó.
3. `legal_hold` es 0.
4. Ningún bloqueo vigente cubre su tipo — comprobado **aparte** de la columna.

La cuarta es deliberadamente redundante con la tercera. En todo lo demás evito
comprobar dos veces lo mismo; aquí no, porque el precio de que la copia esté
desactualizada es un borrado permanente. Si alguna vez discrepan, gana la que
dice «no borres».

### La fecha de purga se guarda, no se recalcula

`purge_eligible_at` se calcula **al archivar**. Si se calculara al purgar,
cambiar la política movería hacia atrás la fecha de filas archivadas hace años, y
un ajuste de configuración podría borrar mañana lo que hoy estaba a salvo.
Guardada, la fecha es una promesa hecha el día del archivado.

## La contradicción del esquema

Seis tablas llevan las columnas de retención **y** un disparador `before delete`
que lanza `SIGNAL`:

`audit_events`, `signature_audit_events`, `signature_records`,
`load_status_history`, `financial_snapshots`, `stripe_events`.

Con unas columnas el esquema dice «puedes purgar esto»; con un disparador dice
«no puedes borrar esto jamás». **Gana el disparador**: son libros de solo-añadir
cuyo valor entero es que nadie los pueda tocar, y un libro que se puede podar no
demuestra nada. Se archivan —que es marcarlas— y no se purgan nunca.

Sin `Policy::NEVER_PURGE`, la contradicción se descubriría del peor modo: un
barrido nocturno reventando con un error de MySQL a mitad de una transacción, en
el cliente que primero acumulara cinco años de datos. Lo guarda
`tests/Unit/Suite/PurgeableTablesTest.php`, que lee el DDL de los disparadores.

## El bloqueo legal

Tres alcances: toda la empresa, un tipo de registro, o un registro concreto.

Al aplicarlo se marca `legal_hold = 1` en las filas que cubre. Se podría no
marcar y preguntar por `legal_holds` en cada barrido; no se hace por dos motivos
y el segundo pesa más:

1. El barrido recorre veintiuna tablas cada noche.
2. **La columna existe en treinta tablas y no la escribía nadie.** Una columna
   que nadie escribe es una columna que miente: quien mire `documents.legal_hold`
   y vea ceros concluye que no hay bloqueos.

### Levantar no es restar

Al levantar un bloqueo **no** se puede poner `legal_hold = 0` sin más: otro
bloqueo vigente puede cubrir las mismas filas. Dos reclamaciones sobre la misma
carga es lo normal, no lo raro —el cliente por un lado, el seguro por otro— y
cerrar la primera dejaría la carga desprotegida frente a la segunda. Se limpia
todo y se vuelve a marcar desde los bloqueos que siguen vigentes.

### El motivo es obligatorio, al aplicar y al levantar

Un bloqueo sin motivo es un bloqueo que dentro de tres años nadie sabe si puede
levantar, y entonces no se levanta nunca: la retención deja de funcionar por
acumulación de bloqueos que nadie se atreve a tocar. Levantar también exige
explicación: es el acto que vuelve a poner en marcha el reloj de borrado sobre
unas pruebas.

Las dos cosas quedan en la bitácora: `legal_hold.applied` y
`legal_hold.released`.

## Cuándo corre

```
Schedule::command('retention:sweep')->weeklyOn(0, '04:00')
```

Semanal y no diario: un registro que cumple veinticuatro meses el martes puede
archivarse el domingo sin que nada cambie, y las dos operaciones tocan muchas
filas. Domingo a las cuatro UTC es la una de la madrugada del domingo en la costa
oeste.

Aparece en `/platform/health` junto a `notifications:sweep`. Si el cron del
planificador no está activado en Forge, esa pantalla lo dice.

```bash
php artisan retention:sweep --dry-run    # cuenta y no escribe
php artisan retention:sweep --tenant=<id>
```

## Lo que esto NO es

- **No es asesoramiento legal ni una garantía de cumplimiento.** Es un mecanismo
  que aplica unas fechas. Los plazos correctos para una empresa concreta —FMCSA,
  el estado, el seguro, los contratos con sus clientes— los determina un abogado.
- **No cubre lo que vive fuera de la base de datos.** Los ficheros del
  almacenamiento de documentos no se borran con la fila; hoy la fila se va y el
  objeto se queda. Es una tarea pendiente y conviene saberlo antes de encender la
  purga.
- **No anonimiza.** `retention_jobs.action` admite `anonymize` y no está
  implementado: hoy solo hay `archive` y `purge`.
- **No preserva nada por sí solo.** Un bloqueo legal detiene ESTE mecanismo. No
  impide que alguien borre una fila a mano desde la aplicación.

## Dónde está

| | |
|---|---|
| Política y clases | `app/Support/Retention/Policy.php` |
| Bloqueos | `app/Support/Retention/Holds.php` |
| Barrido | `app/Support/Retention/Sweeper.php` |
| Comando | `app/Console/Commands/SweepRetention.php` |
| Pantalla | `resources/js/pages/App/Retention/Index.tsx` |
| Interruptor | `config/retention.php` · `RETENTION_PURGE_ENABLED` |
| Pruebas | `tests/Feature/Retention/`, `tests/Unit/Suite/PurgeableTablesTest.php` |
