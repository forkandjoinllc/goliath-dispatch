# La parada que se borraba de verdad

Tres defectos en el mismo método de veinticinco líneas —
`LoadController::syncStops()`, que corre cada vez que se crea o se edita una
carga.

## 1. Se podía pisar la parada de otra empresa

```php
DB::table('load_stops')->where('id', $stop['id'])->update($columns);
```

Sin `load_id`, sin `tenant_id`, y con la validación pidiendo solo:

```php
'stops.*.id' => ['nullable', 'string', 'size:36'],
```

`DB::table` no pasa por el ámbito global de Eloquent, así que ahí no había nada
que lo parara. Cualquiera que pudiera editar una carga podía mandar el id de una
parada de **otra carga de otra empresa** y sobrescribirle instalación,
dirección, contacto, ventana horaria e instrucciones.

Se comprobó antes de tocar nada, montando dos empresas: la parada de la segunda
pasó de `Laredo` a lo que mandó la primera.

## 2. Una parada nueva puesta la primera se guardaba la última

`$request->validate()` **no devuelve el array en el orden de envío**: lo monta
regla por regla, así que las paradas que traen `id` aparecen antes que las que
no. El método hacía `array_values($stops)` y asignaba `sequence` por posición.

Resultado comprobado: el usuario manda `[nueva, Laredo, Dallas]` y la carga
queda `[Laredo, Dallas, nueva]`.

Y `sequence` no es decorativo: es el orden de la ruta, y `StopProgress` impide
anotar la llegada a una parada si otra de `sequence` menor no ha llegado
todavía. Una carga con las paradas al revés bloquea el seguimiento de la de
verdad.

Esto pasaba **con uso normal y correcto**, sin nadie manipulando nada.

## 3. Quitar una parada la borraba de verdad

`load_stops` tiene `deleted_at`, `deleted_by` y `deletion_reason`, `LoadStop`
usa `SoftDeletes`, y **las trece lecturas del proyecto** filtran
`whereNull('deleted_at')`. El borrado blando estaba diseñado por todas partes; a
este método no le había llegado.

`load_documents.stop_id` es `ON DELETE SET NULL`, así que un comprobante de
entrega subido **para** esa parada se quedaba sin saber de qué parada era. El
papel sobrevive; lo que se pierde es qué prueba.

### Por qué el arreglo empieza en el esquema

No era pereza de quien lo escribió: era el único camino que dejaba el índice.

```sql
UNIQUE KEY `load_stops_load_sequence_uq` (`load_id`, `sequence`)
```

Ese índice no mira `deleted_at`, así que una parada borrada en blando se quedaba
con su número **ocupado para siempre**: quita la parada 2 y esa carga no vuelve
a tener una parada 2 nunca. Con eso puesto, borrar de verdad era lo único que
funcionaba.

La migración `2026_09_13_100000` usa la forma que el esquema ya tenía en
`carrier_contacts`: una columna generada que vale NULL salvo en la fila viva, y
el índice sobre ella. MySQL ignora los NULL en un índice único, así que las
vivas siguen sin poder repetir número y las borradas caben todas.

```sql
live_sequence int generated always as (
    case when `deleted_at` is null then `sequence` end
) stored
```

La columna generada **no mira `load_id`**, y eso importa: `load_id` es columna
de una clave ajena con `ON DELETE CASCADE`, y MySQL no admite las dos cosas a la
vez. Va en el índice, que es donde no estorba — misma nota que ya estaba escrita
en `carrier_contacts` y en la migración de requisitos.

## El arreglo no se inventó nada

Es el patrón que `syncRequirements()` ya usaba **cuarenta líneas más arriba en
el mismo fichero**: resolver la fila dentro del dueño, actualizar por el id ya
resuelto, y quitar lo que sobra con un UPDATE de borrado blando. Siete de los
ocho métodos `sync*` del proyecto lo hacían bien. `syncStops` era el único que
no.

Además:

- **Un id que no resuelve no se convierte en una parada nueva.** Se rechaza con
  `stopNotOnLoad`. Convertirlo taparía el intento: quien mandó un id ajeno vería
  «guardado» y se llevaría una parada creada. El mensaje es el mismo para un id
  inventado y para uno ajeno, a propósito: distinguirlos confirmaría que el
  segundo existe.
- **El error señala la fila que mandó el formulario**, no la posición dentro del
  array reordenado por la validación. Señalando la segunda, el formulario marcaba
  en rojo una parada inocente.
- **Los números de orden se apartan antes de reasignarse** (`+1000`). Sin eso,
  intercambiar dos paradas choca contra el índice único consigo mismo.

## Lo que queda fuera, y se dice

- **La migración no repara lo ya perdido.** Las paradas borradas antes de este
  lote no están, y los comprobantes que apuntaban a ellas tienen `stop_id` en
  NULL. No hay forma de saber cuál era cuál; inventarlo sería peor.
- **`down()` puede fallar.** Al revertir se vuelve a poner el índice antiguo, y
  si mientras tanto se quitaron paradas en blando, saltará por duplicado. Es
  correcto que falle en vez de borrar filas para poder revertir.
- **La parada quitada conserva su `sequence` desplazada** (1001, 1002…). No
  molesta —`live_sequence` es NULL— pero si algún día alguien lee `sequence` de
  filas borradas, verá números raros.
- **Los otros siete `sync*` no se han tocado.** Se comprobaron uno a uno y todos
  resuelven la fila dentro del dueño. Lo que hay ahora es un guardián que exige
  que el octavo también lo haga.

## Ficheros

| Fichero | Qué hace |
|---|---|
| `database/migrations/2026_09_13_100000_load_stops_live_sequence.php` | **Nuevo.** El índice único pasa a mirar solo las paradas vivas. |
| `app/Http/Controllers/App/LoadController.php` | `syncStops` reescrito: dueño, orden y borrado blando. |
| `tests/Unit/Suite/SyncOwnershipTest.php` | **Nuevo.** 8 guardianes sobre los ocho `sync*`. |
| `tests/Feature/Loads/StopSyncTest.php` | **Nuevo.** 9 pruebas de los tres defectos. |
