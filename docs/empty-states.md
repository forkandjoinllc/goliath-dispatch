# La pantalla vacía que mentía

## El defecto, tal como se veía

El conductor de la base de datos de demostración abre `/documents` y lee:

> **Todavía no hay documentos**
> Suba el primero. Un transportista no puede despachar sin su certificado de
> seguro.

Tres cosas falsas en dos frases:

1. **La empresa tiene treinta y dos documentos.** El alcance de ese conductor es
   `own` y él no tiene ninguno. La frase habla de la empresa, y quien la lee no
   ve la empresa.
2. **El consejo es de otro rol.** Los papeles de un conductor son su CDL y su
   tarjeta médica, no el certificado de seguro de un transportista.
3. **«Agregue el primero» se decía sin mirar el permiso.** Comprobado ocultando
   los transportistas y entrando como contabilidad: leía una instrucción que su
   cuenta no puede seguir. Contabilidad lee transportistas, conductores, equipos
   y clientes, y no puede crear ninguno de los cuatro.

Y las seis pantallas **ya recibían `scope` y `can`**. La información estaba ahí;
el estado vacío no la miraba.

## El censo

| | |
|---|---|
| Pantallas de listado con estado vacío | 20 |
| Que consultaban el alcance o el permiso al decidir el texto | **0** |
| Que ACOTAN la consulta por alcance | 13 |
| Que le dicen el alcance a la vista | **6** |

Los seis que dicen el alcance son exactamente los seis que dicen «Todavía no hay
X / Agregue el primero» — la forma peor del defecto y, por suerte, la que ya
tenía los datos para arreglarse.

## La regla

`resources/js/components/App/EmptyState.tsx`, cuatro casos en este orden:

| Situación | Qué se dice |
|---|---|
| Hay filtros puestos | «nada coincide con estos filtros» — ya era honesto |
| El alcance no es la empresa | que la lista está **acotada**, y a qué |
| Alcance de empresa y puede crear | «todavía no hay» + «agregue el primero» |
| Alcance de empresa y **no** puede crear | «todavía no hay» + a quién pedírselo |

**El orden importa y es la única parte que puede equivocarse sin que se note.**
Un despachador crea conductores en su cartera: si el permiso se mirara primero,
saldría que sí y la pantalla le diría «todavía no hay conductores» a alguien que
solo ve su cartera. El guardián comprueba las posiciones en el fichero.

`platform` no cuenta como acotado: quien mira desde la plataforma lo ve todo, y
para él la frase de empresa es tan cierta como para un administrador.

## Por qué el texto del alcance vive en `common`

Porque la verdad que hay que decir —«esta lista está acotada a usted y su parte
está vacía»— es la misma en los seis dominios. Escrita seis veces se separa.

Y se escribe **sin el nombre del dominio** a propósito: interpolar el sustantivo
obliga a concordar género y número en español —«Ningún transportista» frente a
«Ninguna carga»— y eso es una fuente de frases mal escritas por cada idioma que
entre. Los titulares hablan de la lista, no de lo que hay en ella:

```
own       Aquí solo salen los suyos
assigned  Aquí solo sale su cartera
carrier   Aquí solo sale su transportista
```

## Lo que se arregló de paso

**`Documents` deducía «hay filtros» de todos los valores de `filters`:**

```tsx
const filtered = Object.values(filters).some((v) => v !== '')
```

En las otras cinco pantallas por ahí viaja también el orden —`sort` y
`direction`, **con valor por omisión**— así que con esa forma `filtered` sería
siempre cierto: el estado vacío diría «nada coincide con estos filtros» para
siempre, sin filtros puestos, y las otras tres ramas no se alcanzarían nunca.
Documentos hoy no ordena, así que no fallaba todavía. Ahora nombra sus cuatro
filtros uno a uno y el guardián lo exige en las seis.

## Comprobado

Recorrido con navegador en los dos idiomas, las cuatro ramas, ocultando los
transportistas para llegar a la de empresa:

```
ALCANCE own          driver      Aquí solo salen los suyos | Esta lista está
                                 acotada a usted, y todavía no tiene ninguno.
EMPRESA sin permiso  accounting  Todavía no hay transportistas | Su empresa
                                 todavía no ha dado de alta ninguno, y su
                                 cuenta no puede crearlos. Pídaselo a un
                                 administrador.
EMPRESA con permiso  admin       Todavía no hay transportistas | Agregue el
                                 primero, o envíeles el enlace público…
FILTRO               admin       Ningún transportista coincide con estos
                                 filtros | Limpie los filtros…
```

`tests/Unit/Suite/EmptyStateTest.php` — 11 comprobaciones, **18 sabotajes**:
las seis usan la pieza, ninguna se queda con el panel a mano, el orden de las
ramas, cada alcance con titular y pista en los dos idiomas, y los textos de
empresa conservados porque la cuarta rama todavía los usa.

`tests/Feature/Screens/EmptyStateTest.php` — 15 pruebas que piden las páginas:
el alcance que llega es el de cada rol (los cinco), el permiso que llega es el
de cada rol, y las seis pantallas mandan las tres cosas que deciden el texto.

## Deuda contada

`ACOTAN_SIN_DECIRLO`, en el guardián: **siete listados que acotan la consulta y
no mandan el alcance a la vista**, cada uno con su motivo. El guardián falla si
aparece el octavo sin declarar, y también si uno declarado ya se arregló.

Los dos que más importan:

- **`InvoiceController`** — el transportista tiene `invoice:read` con alcance
  `Carrier`, así que ve solo lo que se le cobra. Su lista vacía dice «No hay
  facturas que coincidan», que además culpa a filtros que no hay puestos.
- **`UserController`** — acota por transportista para el rol `carrier` y dice
  «Todavía no hay nadie más». Su estado vacío es un párrafo dentro de dos
  secciones, no el panel de las otras seis, así que la pieza no encaja sin
  rediseñar la pantalla.

`MessageController` está en la lista aunque **hoy dice la verdad** («No estás en
ningún hilo todavía»): se declara para que el guardián no dé por bueno un
cableado que no existe.

Y hay una forma más suave del mismo defecto que este lote no toca: cinco
pantallas dicen «ningún X coincide» sin que haya filtros puestos —el espejo de
la mentira: culpar a un filtro que no está—. Necesitan la distinción
filtro/vacío que no tienen, y eso es un cambio distinto.
