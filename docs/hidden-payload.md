# Mandado y escondido no es escondido

## La regla, escrita tres veces en este proyecto

`LoadController`, sobre el bloque de dinero:

> Si el bloque de dinero se enviara y se ocultara en React, ese conductor podría
> leerlo abriendo las herramientas del navegador. Por eso el bloque **no se
> calcula siquiera** cuando el permiso falta.

`Privacy\Internal`:

> `soloEquipo()` devuelve `null`, no una cadena que React esconde.

`Public\TrackingController`, en su cabecera:

> NO viajan al cliente: lo que se cobra, lo que se le paga al transportista, los
> otros clientes, las notas internas de las llamadas, **ni un solo identificador
> con el que probar otra dirección**.

Tres piezas que lo dicen. Dos sitios donde no se aplicaba.

## 1. La pantalla de firmas mandaba la empresa entera

```php
'carriers' => DB::table('carriers')
    ->where('tenant_id', $actor->tenantId)   // ← y nada más
    ->limit(500)
```

Sin mirar el alcance. Un **transportista** tiene `signature:request:read` con
alcance propio: abría la pantalla de firmas de sus propios documentos y su
respuesta de Inertia traía hasta quinientas razones sociales — sus competidores.

El desplegable que las pinta está detrás de `can.create`, que el transportista no
tiene. O sea: **mandado y escondido**, que es exactamente la forma que las tres
citas de arriba prohíben.

Ahora la lista se construye solo si el actor **puede pedir una firma** —un dato
que no alimenta nada no viaja— y con el mismo estrechamiento que las filas de la
pantalla, para que la lista y lo que se ve no puedan decir cosas distintas.

## 2. La cronología pública llevaba identificadores

`Timeline::paraCliente()` reenviaba tal cual lo que arma `paraDespacho()`,
filtrando solo los sucesos de consentimiento. Dentro iban `stopId` —el UUID de la
parada— y `provider` —el nombre del proveedor de rastreo—.

La pantalla pública no los pinta. Están en el JSON, en la página que abre un
cliente sin cuenta, mientras el `stops()` de ese mismo controlador quita el `id`
y el `customer_location_id` **a mano** y lo explica en un comentario.

Se quitan por nombre, sobre la lista ya filtrada. Lo que sí se queda:
`reportedByPerson`, que es la frase que el cliente lee —«lo reportó una
persona»— y que se deriva del proveedor sin nombrarlo. Hay un sabotaje que lo
quita también, para que nadie lo «limpie» de paso.

## Lo que la prueba tuvo que aprender

La primera versión buscaba `"provider"` en el HTML entero de la página pública.
Falla — y no por un fuga: la palabra aparece **veintiuna veces** en el diccionario
que la página lleva embebido («no telematics provider is connected»). Una aguja
de texto sobre el documento completo da rojo por el motivo equivocado, que es tan
inútil como dar verde por el motivo equivocado.

Se mide sobre las **props**, que es lo que de verdad viaja como dato.

## Los guardianes

`tests/Unit/Suite/HiddenPayloadTest.php` — 2 comprobaciones de estructura: que la
consulta suelta no vuelva al payload de firmas, que la lista dependa del permiso
de crear y del alcance, y que la cronología pública se quite las dos claves
mientras el despacho las conserva.

`tests/Feature/Signatures/HiddenPayloadTest.php` — 4 pruebas que abren las
pantallas y miran **las claves que llegan**: el transportista recibe lista vacía,
la oficina la recibe entera —un lote que esconde datos y de paso rompe el
desplegable de quien sí puede usarlo no arregla nada—, y la cronología del
cliente no lleva identificadores mientras la del despacho sí.

**8 sabotajes, 8 rojos**, incluidos los dos que se pasan de listos: recortar la
lista también para la oficina, y quitarle al cliente la frase que sí es suya.
