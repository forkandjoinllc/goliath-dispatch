# Las notas internas que el transportista leía

## El defecto

Dos campos del producto llevan la promesa escrita en su propia etiqueta:

| Campo | Lo que dice la pantalla |
|---|---|
| `carriers.notes` | «Visibles para su equipo. **No se le muestran al transportista**.» |
| `loads.internal_notes` | «Solo para su equipo. **Nunca se le muestran al transportista** ni al cliente.» |

Los dos salían. Medido entrando como el usuario del portal del transportista y
abriendo **su propia ficha** y **su propia carga**:

```
carriers.notes        200  >>> SALE <<<
loads.internal_notes  200  >>> SALE <<<
```

No hace falta hacer nada raro. El transportista pincha en su nombre y lo lee.

## En la carga era peor

La pantalla pintaba:

```tsx
{load.specialInstructions ?? load.internalNotes ?? t('loads.detail.noNotes')}
```

bajo un rótulo que dice **«Notas»** a secas. Una carga sin instrucciones para el
conductor —que es lo normal— enseñaba las notas internas **en el hueco de las
instrucciones**. Ni el transportista sabía que estaba leyendo algo que no era
para él, ni el despachador que lo que escribía acababa ahí.

El diccionario ya tenía `loads.detail.internalNotes` («Notas internas») y la
pantalla no lo usaba en ninguna parte.

## Lo que hace peor el hallazgo

El resto de la familia cumplía. Ni el enlace público de rastreo, ni la factura
pública, ni el papel de la tarifa emiten una sola nota; las notas del cliente
tampoco salen por ningún lado. Un barrido de los diccionarios encontró seis
campos que se declaran internos, y **las dos únicas que fallaban eran las dos
que lo prometen por escrito**.

Es la misma forma que los cuatro lotes anteriores: una regla que el código
cumple en todas partes menos donde está más dicha.

## La regla no es un permiso

No hay un `load:internalnotes:read` que conceder, y no debe haberlo. Esto es **de
qué lado de la mesa está quien mira**: el equipo de la casa de despacho escribe
estas notas, y el transportista y el conductor son la otra parte. Un permiso se
concede; el lado de la mesa no.

`App\Support\Privacy\Internal` decide por **rol**, no por si el actor trae
`carrierId`, para que un rol nuevo obligue a decidir. El `match` no tiene
`default`: en cuanto alguien añada `Role::Customer`, o el guardián lo dice con el
nombre del rol o `match` revienta. Un actor sin rol tampoco es del equipo — en un
campo que promete confidencialidad, la duda se resuelve callando.

`DECLARADAS` empareja cada campo con la clave del diccionario donde está escrita
su promesa. El guardián falla de las dos maneras: si se borra la promesa dejando
el campo declarado, y si un campo declarado deja de pasar por la puerta.

## No se manda y se esconde

`soloEquipo()` devuelve `null`, no un texto que React tapa. Es exactamente lo que
el bloque de dinero de la carga ya tenía escrito al lado:

> Enviarlo y esconderlo en React lo dejaría al alcance de cualquiera que abra las
> herramientas del navegador.

Un sabotaje de la campaña hace precisamente eso —mandar el texto entero y añadir
una bandera `internalNotesHidden`— y queda cazado.

## Y la tarjeta tampoco

Al transportista no se le enseña «Sin notas registradas». Eso le contaría que
existe un sitio donde se escriben notas sobre él, y le mentiría los días que sí
las hay. `can.readInternalNotes` decide si la tarjeta se pinta.

En la carga ahora hay dos tarjetas donde había una: «Notas» con las instrucciones
del conductor, y «Notas internas» solo para el equipo. Comprobado en los dos
idiomas:

```
TRANSPORTISTA es ficha: []                          carga: [NOTAS]
TRANSPORTISTA en ficha: []                          carga: [NOTES]
EQUIPO        es ficha: [NOTAS]                     carga: [NOTAS | NOTAS INTERNAS]
EQUIPO        en ficha: [NOTES]                     carga: [NOTES | INTERNAL NOTES]
```

## Lo que NO se toca

- **Contabilidad sigue viendo las notas del transportista**, que las lee para
  cobrar bien. Cerrar por «no es despachador» habría sido cerrar de más, y hay
  una prueba que lo sujeta.
- Las notas de conductores y equipos llevan el rótulo «Notas internas» pero **no
  prometen nada por escrito**, y el transportista no llega a esas pantallas hoy.
  Quedan fuera de `DECLARADAS` a propósito: declarar una promesa que la pantalla
  no hace sería inventarse el defecto.
- Las notas del cliente no salían y siguen sin salir. Hay una prueba que lo fija.

## Guardianes

`tests/Unit/Suite/InternalNotesTest.php` (8) y
`tests/Feature/Privacy/InternalNotesTest.php` (6). **17 sabotajes, 17 cazados**,
incluidos abrir la puerta a medias (solo al conductor), cerrarla de más (dejando
fuera a contabilidad), y devolver el encadenado que ponía las notas internas en
el hueco de las instrucciones.
