# El plazo de aviso que dos pantallas ignoraban

## El defecto

Ajustes deja fijar **«Avisar de documentos por caducar (días)»**, con la nota
«Con cuánta antelación un documento cuenta como “caduca pronto”».

Documentos y el Panel lo respetaban. Conductores y Equipos llevaban esto:

```php
private const WARN_DAYS = 45;
```

Medido: puse el ajuste de la empresa en **20 días** y la pantalla de Conductores
siguió listando como «Por vencer» una licencia que caduca dentro de **30**.

## Lo que hace peor el hallazgo

**El arreglo ya estaba escrito.** El docblock de `DocumentController::warnDays()`
describía este mismo defecto y su solución:

> Era una constante de 45 días que ignoraba esa columna — y la columna trae 30
> por defecto, así que la aplicación avisaba con quince días más de los que la
> empresa había pedido. Los **CUATRO sitios** que lo usaban (el aviso al subir,
> el filtro de «caducan pronto», su contador y la etiqueta de la ficha) tienen
> que contestar lo mismo, o la lista y el contador se contradicen.

Se corrigió en Documentos y se quedó ahí. Las dos pantallas que siguieron con la
constante son justo donde viven la **CDL**, la **tarjeta médica**, la
**matrícula** y la **inspección**: los papeles que paran un camión en la
carretera, no los que dan un aviso en una pantalla.

Es la forma de los últimos seis lotes, con una vuelta de tuerca: no es que la
regla se cumpliera en todas partes menos en una. Es que **el defecto ya se había
encontrado, arreglado y documentado**, y el arreglo no se aplicó donde más
importaba.

## Por qué una clase y no un tercer método privado

Copiar `warnDays()` a los otros dos controladores deja tres sitios donde volver a
divergir, que es exactamente cómo se llegó hasta aquí.

`App\Support\Compliance\ExpiryWindow` tiene `days()`, `limit()` y `flag()`, y las
**tres** pantallas pasan por ahí — incluida Documentos, que ya estaba bien. Una
regla que se cumple en tres sitios por acuerdo no es una regla; es una
coincidencia que dura hasta el próximo cambio.

`PANTALLAS` es el registro de quién tiene que contestar lo mismo, y hay dos
guardianes: uno recorre **todos** los controladores buscando una constante de
plazo propia, y otro recorre los que tienen filtro `expiring` y exige que estén
declarados. Una pantalla nueva con su propio número no llega a producción.

## Lo que caduca hoy no está caducado

`flag()` compara **días**, no marcas de tiempo. Una licencia que vence hoy a las
once de la noche no está caducada a las nueve de la mañana, y decirle a un
despachador que lo está le hace rechazar una carga que sí podía salir.

## Comprobado en el navegador

Con el plazo de la empresa en 20 y luego en 60, en los dos idiomas:

| Pantalla | 20 días | 60 días |
|---|---|---|
| Conductores | 2 | 3 |
| Equipos | 1 | 2 |
| Documentos | 1 | 3 |

Antes de este lote, las dos primeras columnas de Conductores y Equipos habrían
sido idénticas: el ajuste no las tocaba.

## Lo que NO se toca

- El ajuste sigue llamándose «documentos» en el diccionario. Cambiar la etiqueta
  para que diga «documentos, conductores y equipos» es un cambio de texto que no
  he hecho por mi cuenta: la nota ya dice lo general («un documento cuenta como
  caduca pronto») y la CDL y la matrícula son documentos.
- El Panel ya usaba `document_expiration_warning_days` por su cuenta y sigue
  igual: no tiene filtro `expiring`, así que queda fuera del registro.
- Los umbrales de FMCSA y de la tarjeta TWIC no son plazos de caducidad de este
  tipo y no entran aquí.

## Guardianes

`tests/Unit/Suite/ExpiryWindowTest.php` (6) y
`tests/Feature/Compliance/ExpiryWindowTest.php` (11). **11 sabotajes, 11
cazados**, incluidos devolver la constante a cada pantalla por separado,
descolgar el contador de su lista, y descolgar Documentos —que era la que ya
estaba bien y es la que este lote mueve de sitio—.
