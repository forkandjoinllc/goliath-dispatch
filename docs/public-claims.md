# Las promesas de la página pública

## Por qué este lote

Todos los barridos anteriores miraron pantallas de dentro. Esas las usa quien ya
compró y puede comprobarlas: si la lista dice «por vencer» y no lo está, se
nota.

La página pública la lee quien **todavía no tiene el producto** y no tiene cómo
verificar nada. Nunca se había comprobado. Una afirmación de más ahí no es una
molestia: es una venta hecha sobre algo que no existe.

## Lo que salió

De las 31 afirmaciones con forma de promesa funcional en las páginas vivas,
auditadas una a una contra el código: **cinco ciertas, dos falsas, catorce a
medias.**

### Las dos falsas

| Decía | Lo que hace el código |
|---|---|
| «Se coteja con sus números de DOT y MC ante la FMCSA **antes de activarlo**» | Aprobar un transportista no comprueba FMCSA en absoluto. `Readiness` la trata como **aviso**, y su propio docblock lo dice. |
| «Una carga no puede despacharse con un permiso **o escolta** pendiente» | `escorts.status` no lo lee **ningún** guardián. Una escolta en `pending` no impide nada. |

La segunda es la más seria: es una promesa de seguridad en carretera.

### Una muestra de las catorce a medias

- **«Enlaces de descarga con marca de agua»** — `download` escribe
  `'watermarked' => false` a fuego y devuelve el fichero crudo. Lo de «corta
  duración» sí es verdad: el enlace firmado caduca a los cinco minutos.
- **«El VIN se coteja con el COI»** — lo confirma una persona.
  `Equipment\Verification` dice literalmente que el certificado no se lee nunca.
- **«usando las reglas base de cada estado»** — las reglas sembradas son **una**
  línea base federal copiada igual a los cincuenta estados, hasta que la empresa
  las ajuste.
- **«se eliminan de forma permanente a más tardar 5 años»** — el purgado viene
  **apagado** (`RETENTION_PURGE_ENABLED`), y «se trasladan a un archivo
  protegido» describe un sello `archived_at` en su sitio, no una mudanza.
- **«Cada certificado … tiene una fecha de vencimiento»** — la fecha es
  opcional, y un documento sin ella no se vigila ni bloquea.
- **«una razón por escrito para cada excepción»** — aprobar no pide ninguna.

## Qué se hizo

**Corregir el texto, no construir las funciones.** Catorce afirmaciones
reescritas en los dos idiomas para que digan lo que el producto hace hoy. Cada
matiz que se añade —«cuando su equipo marca una carga como sobredimensionada»,
«si esa empresa tiene configurado el acceso a la FMCSA», «el plazo que fije cada
casa de despacho»— es una condición que el código impone de verdad.

Construir las funciones que faltan son varios lotes y varias decisiones de
negocio. Lo que no podía seguir es venderlas como hechas.

## El registro

`App\Support\Marketing\PublicClaims::RESPALDOS` empareja cada afirmación con el
símbolo que la sostiene. El guardián falla de cuatro maneras:

1. Aparece en la página una promesa funcional nueva **sin declarar**.
2. El código que sostiene una promesa deja de existir.
3. El registro nombra una clave que ya no está en el diccionario.
4. Una promesa funcional se declara como texto legal o trabajo humano.

La cuarta es la que cierra la puerta trasera: la salida fácil ante un guardián
rojo es declarar la frase nueva como «legal» y seguir. Las veinte afirmaciones
que esta auditoría estableció como funcionales no pueden declararse así.

Lo que **no** dice el registro: que la promesa sea buena, ni que el código haga
lo suficiente. Dice que alguien emparejó las dos cosas a conciencia. Leer si el
texto describe bien ese código lo hace una persona, y de eso salió esta
auditoría.

## Comprobado en el navegador

Cinco páginas —inicio, servicios, transportistas, sobredimensión, privacidad— en
los dos idiomas: las diez cargan, y ninguna de las tres promesas retiradas
aparece en pantalla.

## Lo que queda por construir, si se quieren esas promesas de vuelta

- Que una escolta sin confirmar impida despachar (`escorts.status` existe y no
  lo mira nadie).
- Comprobar FMCSA al aprobar un transportista, no solo avisar.
- Cotejar el VIN contra el COI de verdad, en vez de anotar que alguien lo miró.
- Reglas de sobredimensión por estado de verdad, y evaluación obligatoria a
  partir de las dimensiones en vez de una casilla.
- Marca de agua en las descargas.
- Un permiso que vuelve a `pending` debería reabrir la puerta: hoy solo la
  reabre crear uno nuevo.

## Guardianes

`tests/Unit/Suite/PublicClaimsTest.php` (7). **8 sabotajes, 8 cazados**,
incluidos devolver la promesa de la escolta solo en inglés y colar una promesa
funcional como texto legal.
