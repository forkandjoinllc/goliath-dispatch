# El aviso materializado que no se cerraba nunca

## El defecto

`document_expirations` es la tabla que el barrido nocturno escribe y que lee
Salud de plataforma. Su rótulo dice «Avisos materializados por el barrido, **sin
resolver todavía**», y presenta dos cubos excluyentes: «Por vencer» y «Ya
vencidos».

Cerrar un aviso estaba repartido en dos sitios, y ninguno veía lo que veía el
otro:

- `Expirations::resolveOrphans()` cerraba los documentos **borrados** o a los que
  se les había quitado la caducidad.
- El barrido, al materializar, cerraba los de **fecha anterior**:
  `whereDate('expiration_date', '<', $vence)`.

Entre las dos quedaron dos agujeros, y los dos suman al mismo contador.

### 1. La transición

Cuando un documento pasa de «por vencer» a «vencido», **la fecha de caducidad es
la misma**: lo único que cambia es el calendario. El índice único es
`(document_id, kind, expiration_date)`, así que la fila nueva entra sin chocar, y
la consulta que cerraba lo viejo buscaba una fecha *estrictamente anterior* — no
encontraba nada.

```
Certificado con caducidad 2026-09-20, plazo de aviso 30 días
 01 sep   se escribe kind=warning
 21 sep   se escribe kind=expired  ·  la fila warning sigue sin resolver
 Salud    «Por vencer: 1 · Ya vencidos: 1»   ← un solo documento
```

### 2. La renovación

Si alguien renueva el papel, su caducidad se va un año adelante y el documento
**deja de entrar en la consulta del barrido**, que solo mira lo que vence dentro
del plazo. `materializar()` no vuelve a ejecutarse para él jamás, así que sus
filas viejas se quedan colgadas para siempre: Salud dice «Ya vencidos: 12» sobre
papeles renovados hace meses, mientras el listado del inquilino —que recalcula
con `ExpiryWindow::flag()`— dice cero.

## La regla, que es una sola

> Un aviso materializado se cierra **en cuanto deja de describir el estado de hoy
> de su documento**.

Eso cubre los dos agujeros y también los huérfanos, que resultan ser un caso
particular: un documento borrado no tiene estado que describir.

`Expirations::resolveStale()` compara tres cosas, y cada una cierra un caso:

| Comparación | Qué cierra |
|---|---|
| misma fecha de caducidad | el papel renovado a otra fecha |
| dentro del plazo de aviso | el papel que dejó de estar por vencer, incluido cuando la empresa **estrecha** el plazo en los ajustes |
| mismo tipo que el estado de hoy | la transición de «por vencer» a «vencido» |

El estado de hoy se deriva y no se lee de ningún sitio, porque no está guardado
en ninguna parte: antes de hoy es `expired`, dentro del plazo es `warning`, y más
allá no hay aviso que valga.

## Y corre DESPUÉS de materializar

Antes corría primero, y tenía que ser así: cerraba huérfanos y luego se escribía.
Ahora la regla mira el estado de hoy, y el estado de hoy **incluye la fila que el
barrido acaba de escribir**. Puesta antes, el aviso aparecería y desaparecería en
la misma pasada. Hay un guardián que compara las dos posiciones en el fichero.

## Lo que los sabotajes enseñaron

Tres de los ocho salieron **verdes** a la primera, y los tres por el mismo
motivo: mis pruebas simulaban el paso del tiempo **moviendo la fecha del
documento**. Con eso, la fila vieja se cerraba por la comparación de fechas y
ninguna de las otras dos comparaciones hacía falta para pasar.

Lo que hay que mover es el reloj. La prueba de la transición usa `travel(11)
->days()` y no toca el documento, que es exactamente lo que ocurre en el
calendario. Las otras dos se escribieron después, una por comparación:

- renovar a otra fecha **cercana**, que sin la comparación de fechas deja dos
  avisos vivos del mismo papel;
- **estrechar el plazo** de la empresa de 30 a 10 días, que es el único caso
  donde la fila vieja tiene la misma fecha y el mismo tipo y aun así ya no
  describe nada.

## Los guardianes

`tests/Unit/Suite/ExpiryResolutionTest.php` — 4 comprobaciones: que cerrar viva
en un solo sitio, que corra después de materializar, que la consulta compare las
tres cosas, y que la función vieja no siga al lado de la nueva.

`tests/Feature/Platform/ExpiryResolutionTest.php` — 8 pruebas que corren el
barrido de verdad, mueven el reloj y lo vuelven a correr. Incluyen las dos
mitades: que lo que ya no es verdad se cierre, y que **el aviso vivo no se cierre
solo** —una regla que cierra todo lo que no reconoce vaciaría la pantalla y
parecería que no hay nada que vigilar— y que dos documentos distintos sigan
contando dos.

**8 sabotajes, 8 rojos** tras rehacer las pruebas.
