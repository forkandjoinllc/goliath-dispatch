# «Se le avisará 45 días antes»

## El defecto, y de quién es

Del lote anterior. Unifiqué el plazo de aviso de caducidad en las tres pantallas
—`ExpiryWindow`, con el número que la empresa fija en Ajustes— y **dejé este
texto en pie**, en los dos idiomas:

> Se le avisará **45 días** antes, y la puerta de despacho bloquea en cuanto
> vence.

Se pinta en el campo de caducidad al subir un documento. El aviso real sale de
`tenant_settings`, con **30** por defecto. Una empresa que hubiera puesto 20
recibía el aviso a 20. Quien leía ese texto al subir una póliza planeaba la
renovación contando con quince días que el producto no le daba.

El guardián que escribí entonces comprobaba que la clave del ajuste existiera en
el diccionario. No que ningún texto llevara el número escrito.

## Es el mismo defecto, una capa más arriba

`WARN_DAYS = 45` era una copia del ajuste en el código. `«45 días»` en el
diccionario es una copia del ajuste en el texto. Las dos se despistan igual, y
la segunda es peor de encontrar: no aparece en ningún `grep` de constantes.

## El barrido

Recorridos los 43 diccionarios en los dos idiomas buscando duraciones escritas.
**`documents.form.expirationHint` es el único texto vivo del producto que dice
un número que el producto calcula.** Lo demás son tramos de verdad fijos:

| Qué | Por qué puede llevar número |
|---|---|
| `reports.aging.*`, `finance.invoice.aging.*` | El reparto de siempre en cobros, fijo también en `PeriodReport::aging()` |
| `drivers.form.moreThan30`, `*.nYearsOne`, `*.nDaysOne` | El número **es** el texto: un tope de desplegable y dos singulares |
| `report.filters.presets.weekly` | Un atajo de fechas cuyo nombre es su definición |

Van declarados uno a uno con su motivo en `duracionesFijas()`. La lista es corta
a propósito: entrar en ella es una decisión que se toma a conciencia.

## El guardián

Recorre los diccionarios y falla si un texto lleva una duración escrita sin
estar declarada. Un texto que **recibe** el número —lleva `{`— no cuenta.

Y tiene una puerta cerrada por dentro: la salida fácil cuando esta prueba se
pone roja es meter la clave nueva en la lista de excepciones y seguir.
`documents.form.expirationHint` está en una lista de **prohibidas**, con su
motivo, para que esa salida no exista.

Marketing queda fuera del barrido: describe el producto a quien todavía no lo
usa, y ahí un número redondo es una frase, no una promesa sobre SU empresa.

## Lo que la campaña de sabotajes NO puede comprobar

Dos de los nueve sabotajes tocaban el propio fichero de pruebas: desactivar su
condición, y hacerle mirar solo un idioma. Los dos salieron verdes, y el verde
era correcto — **ninguna prueba caza que alguien desarme esa misma prueba**. La
pregunta estaba mal planteada, no el guardián. Se retiraron en vez de construir
una torre de pruebas que se vigilan unas a otras.

El tercero sí valía: meter la clave arreglada en la lista de excepciones. Ese
está cazado.

## Comprobado en el navegador

```
ajuste = 30    es: Se le avisará 30 días antes…    en: You will be warned 30 days before…
ajuste = 20    es: Se le avisará 20 días antes…    en: You will be warned 20 days before…
```

## Lo que NO se toca

Facturación dice «Si esta empresa pasa a estar sujeta a los topes, **se avisa
antes**», y activarlos solo deja un apunte de auditoría: ningún aviso sale. Es
un defecto de la misma familia —una promesa sin quien la cumpla— pero de otro
mecanismo, y va en su propio lote.

## Guardianes

`tests/Unit/Suite/DurationsInCopyTest.php` (4) y
`tests/Feature/Compliance/WarnDaysInCopyTest.php` (3). **7 sabotajes, 7
cazados.**
