# Buscar en el registro federal desde el alta pública

El alta de transportista empieza ahora por **un número**: USDOT o MC. Se
consulta el registro federal y el formulario aparece relleno con lo que publica,
para que la persona solo corrija lo que esté desactualizado.

## Lo que ya estaba construido

`FmcsaDirectory` —con `byDot()`, `byDocket()`, el adaptador real
(`QcMobileDirectory`), el simulado (`MockFmcsaDirectory`) y `FmcsaLookup` con su
campo `live`— llevaba lotes en el código. La ficha interna de transportista lo
usaba. **El alta pública no**: pedía el USDOT como un campo más entre veinte y
no preguntaba nada a nadie.

El comentario de `FmcsaLookup` ya decía que de `live` «depende que la pantalla
bloquee los campos o los deje escribir». No había ninguna pantalla que lo
leyera. Este lote es, sobre todo, enchufar lo que estaba hecho.

## Por qué NO es el mismo método que el de dentro

`CarrierController::lookup()` contesta además la pregunta más útil para quien
despacha: **«¿este transportista ya lo tengo dado de alta?»**. Aquí eso no puede
salir.

Al otro lado de este extremo hay un desconocido sin sesión. Devolverle si un
USDOT está o no en la cartera de esta empresa le deja **enumerar la cartera
entera** probando números. Por eso el controlador público no toca la base de
datos en absoluto: solo devuelve lo que contestó el registro, que es público.

Un guardián comprueba que ahí dentro no aparezcan `DB::`, `Carrier::` ni
`existing`, y una prueba siembra un transportista con ese mismo USDOT para que,
si algún día alguien copia el método de dentro, se caiga.

## Las tres defensas

1. **El tope por IP**, en la ruta: `throttle:12,60`. Su propio tope y no el de
   los envíos — buscar no es enviar, y las dos cuentas no deben gastarse la una
   a la otra. Doce por hora le sobran a cualquier persona.
2. **El sello firmado** del formulario, que ata la consulta a una página que
   servimos nosotros.
3. **El campo trampa**, igual que en el envío.

El rechazo **no dice cuál de las tres lo paró**: explicárselo a un bot es
enseñarle a rodearla. Misma regla que los envíos.

Y una razón de fondo: FMCSA es un servicio público y gratuito. Un formulario
abierto que le pega sin freno es la forma más rápida de que dejen de
contestarnos — y entonces se rompe también la ficha de dentro, que sí hace
falta.

### La pausa de tres segundos no vale aquí

`FormToken` rechaza un sello de menos de tres segundos: nadie rellena veinte
campos tan rápido, así que quien lo hace es un script. Para una **búsqueda**
esa regla dice lo contrario de lo que quiere decir — a esa casilla llega alguien
con el número del DOT ya en la mano, lo pega y pulsa buscar. El camino rápido
era justo el que se rechazaba.

Así que `verify()` admite ahora `exigirPausa`, y la búsqueda lo pasa en falso.
Lo que no podía pasar es que eso aflojara los envíos: la pausa sigue siendo lo
que se exige por omisión, el formulario público común no la desactiva, y hay un
guardián y una prueba que lo sujetan.

## Lo que la pantalla no se puede callar

1. **De dónde salieron los datos y cuándo.** El registro publica fichas que
   llevan años sin tocarse. Pintarlas con la misma letra que lo que escribió la
   persona las presenta como suyas, y la primera vez que alguien lo nota es
   cuando la documentación llega a una dirección donde ya no hay nadie.
2. **Que se pueden corregir.** Ningún campo se bloquea. Es una promesa
   declarada en `PublicClaims`, y basta un `readOnly` en un campo prerrellenado
   —un cambio que suena prudente— para que pase a ser mentira. Hay guardián.
3. **Si NO es una consulta de verdad.** Sin credenciales se ata el simulado, que
   fabrica una ficha coherente para poder construir y demostrar. Veinte casillas
   rellenas con datos inventados y presentadas como venidas del registro federal
   serían la mentira más cara de este formulario.
4. **Que ese transportista no puede operar**, cuando el registro lo dice
   (`allowedToOperate`). No bloquea el alta —eso lo decide la casa al revisarla—
   pero no se lo calla.

## «No encontrado» no es un error

Un USDOT recién sacado todavía no está en el registro. Esa persona tiene que
poder seguir a mano sin que la pantalla la trate como si se hubiera equivocado:
el aviso es neutro, no rojo, y el enlace de «rellenar a mano» está **siempre**,
no solo cuando algo falla.

Los cuatro desenlaces se dicen distinto a propósito, porque se arreglan
distinto: `not_found` escribiendo bien el número, `error` esperando, `invalid`
corrigiendo la forma, `found` revisando.

## El prerrellenado no pisa lo escrito

Solo se rellena lo que esté **vacío**. Un valor nulo del registro es «no lo sé»,
no «bórralo»: con un `?? ''` por medio, buscar por segunda vez vaciaría las
casillas que alguien acabara de corregir a mano.

## Dónde está

| Pieza | Fichero |
|---|---|
| El extremo público | `app/Http/Controllers/Marketing/CarrierLookupController.php` |
| El buscador | `resources/js/components/Marketing/FmcsaLookup.tsx` |
| El alta | `resources/js/pages/Marketing/CarrierSignup.tsx` |
| El sello | `app/Support/Forms/FormToken.php` |
| Guardianes | `tests/Unit/Suite/CarrierLookupPublicTest.php` |
| Pruebas | `tests/Feature/Marketing/CarrierLookupTest.php` |

## Pendiente de servidor

La credencial de FMCSA en el `.env` de Forge. Hasta entonces se ata el
adaptador simulado — y la pantalla lo dice con todas sus letras.

---

Ver también: [testing.md](testing.md)
