# La puerta que no cerraba para el sobrepeso

## El defecto

`Guards::blocking` cierra dos puertas antes de despachar: el permiso tiene que
estar aprobado por una persona, y —si la empresa lo pide— un administrador tiene
que haber validado la evaluación. Las dos preguntaban lo mismo:

```php
if ((bool) $load->is_oversize && $load->permit_ready_approved_at === null) {
if ((bool) $load->is_oversize && $load->oversize_validated_at === null && …) {
```

`Evaluator` pone las dos banderas **por separado**:

```php
'is_oversize'   => $sobredimensionada ? 1 : 0,
'is_overweight' => $sobrepeso ? 1 : 0,
```

Una carga de maquinaria compacta —medidas legales, peso de más— sale con
`is_oversize = 0` y `is_overweight = 1`. Se despachaba **sin permiso aprobado y
sin validación**. El puente no distingue si además es ancha.

## Lo que hacía que no se notara

La pantalla de permisos sí la listaba. Su consulta preguntaba por las dos
banderas:

```php
$q->where('loads.is_oversize', 1)->orWhere('loads.is_overweight', 1);
```

Así que la carga aparecía en el listado con «Evaluación: pendiente de firma» y
«Listo para despachar: todavía no aprobado» en rojo. Quien lleva esa pantalla
creía que esas dos columnas eran puertas. Para esa carga eran **etiquetas**.

Es la forma de siempre: la misma pregunta contestada en dos sitios acaba
contestándose distinto, y el sitio que se olvida es el que cierra la puerta — el
que enseña los datos casi nunca se olvida, porque se ve.

## La pieza

`App\Support\Oversize\NeedsPapers` declara las banderas con su motivo:

```php
public const BANDERAS = [
    'is_oversize'   => 'Medidas fuera de límite. …',
    'is_overweight' => 'Peso fuera de límite, con medidas legales o sin ellas. …',
];
```

Y contesta la pregunta en las dos formas en que se necesita: `laCarga($carga)`
para las puertas y `enConsulta($query)` para los listados. El guardián exige que
`Guards` no vuelva a nombrar ninguna bandera a mano y que el controlador no
vuelva a escribir el `||`.

El motivo no es decoración: una bandera nueva —`is_hazmat`, el día que exista—
hay que clasificarla ahí, o se queda fuera de las puertas sin que nadie lo note,
que es exactamente lo que le pasó al sobrepeso.

## La segunda mitad de la frase

El panel de aprobación decía, en los dos idiomas y sin condición:

> El despacho permanece bloqueado para una carga sobredimensionada o con
> sobrepeso hasta que un administrador valide esta evaluación.

Eso solo es cierto con `tenant_settings.require_oversize_admin_validation`
encendido, y **viene apagado de fábrica**. Una frase así es de las que alguien
lee, delega y deja de mirar.

Ahora la descripción dice lo que el panel es —un administrador revisa y deja
constancia— y debajo va la consecuencia real, elegida con datos que manda el
servidor:

| Estado | Frase |
|---|---|
| lo exige y la carga lleva banderas | «Mientras no la valide, esta carga no se puede despachar.» |
| lo exige y la carga no lleva banderas | «Esta carga no está marcada… así que la validación no detiene su despacho.» |
| no lo exige | «…queda como constancia. Se activa en Configuración.» |

Por eso `exigeValidacion()` vive en `NeedsPapers` y no escondida en `Guards`: la
pantalla tiene que poder contestar la misma pregunta con el mismo código.

## Los motivos de bloqueo

`loads.blocking.permitNotApproved` decía «Es una carga **sobredimensionada** y su
permiso no está aprobado», sobre una carga que no lo es. Los dos motivos —y el
texto equivalente de `errors.json`— hablan ahora de medidas **o** peso. Un
guardián comprueba que la palabra no vuelve.

Lo mismo con la etiqueta del ajuste en Configuración, que seguía prometiendo un
control solo sobre la sobredimensión.

## El sembrador escondía el caso

La demostración no tenía **ni una** carga con sobrepeso y medidas legales:

```php
'is_overweight' => $weight > 80_000,
```

`$weight` es lo que va encima del remolque. El límite de 80.000 libras es sobre
el **conjunto**, que es lo que compara `Evaluator`
(`max_gross_weight_pounds` contra `gross_vehicle_weight_pounds`). Con el peso de
la carga, ninguna fila sembrada llegaba al umbral salvo las que además eran
anchas.

Así que el estado donde vivía este defecto no existía en la demostración y nadie
podía tropezar con él mirando. Ahora se deriva del bruto y del mismo límite
(`DefaultRules::PESO_BRUTO`), y GD-24011 —un bastidor de prensa, medidas legales,
90.200 libras brutas— es la carga que enseña el caso.

## Lo que esto NO decide

Si hace falta permiso de verdad. Eso lo dice una persona: `Evaluator` lo explica
en su cabecera —«ESTO ORIENTA. NO DETERMINA»— y por eso las columnas se llaman
`permit_likely_required`. `NeedsPapers` solo contesta qué cargas tienen que pasar
por la mesa de alguien antes de rodar.

Y nada de esto hace legalmente válido un despacho: los permisos y las escoltas
siguen siendo responsabilidad del operador ante cada estado.

## Guardianes

`tests/Unit/Suite/NeedsPapersTest.php` — diez comprobaciones, doce sabotajes
verificados uno a uno.
`tests/Feature/Oversize/OverweightGateTest.php` — las dos puertas y la pantalla,
con la carga de solo sobrepeso.
