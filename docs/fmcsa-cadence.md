# Los siete días que la web no puede prometer

## El defecto

Dos páginas **públicas** —`services.onboardingCompliance` y
`forCarriers.verification`, las dos renderizadas— le decían a un transportista
desconocido, en los dos idiomas:

> Your FMCSA authority is checked against the DOT/MC you provide and re-verified
> automatically **every 7 days** for as long as you're active, not just once at
> signup.

Dos cosas iban mal, y son distintas.

### Los siete días no son de la web

Son el valor **por omisión** de `tenant_settings.fmcsa_reverification_days`, una
columna `int NOT NULL DEFAULT 7` que cada empresa fija entre 1 y 365 desde su
pantalla de ajustes.

O sea que la página prometía una cadencia concreta **en nombre de una empresa
que no la ha prometido**, a alguien que todavía no es cliente de nadie. Una casa
de despacho con el plazo puesto en 90 tenía una web diciéndole a sus
transportistas que se les revalida cada 7.

### Hoy no se revalida a nadie

El directorio de FMCSA está atado al adaptador de demostración: `isLive()`
devuelve falso, y el barrido lo dice por consola —«Sin credenciales de FMCSA: no
se revalidó a nadie»— donde no lo lee nadie.

Eso es de servidor y **no se arregla desde el código**. Lo que sí se arregla es
que la decisión se tome con la información delante.

## Lo que se hizo

**La web deja de dar la cifra.** Sigue diciendo «automáticamente» —porque la
revalidación periódica sí es automática por diseño— y añade de quién depende el
plazo: «la casa de despacho con la que trabaje decide cada cuánto». Quitar la
cifra sin decir quién la fija habría dejado una vaguedad que no ayuda: quien lo
lee no sabría a quién preguntar.

**La pantalla donde se decide dice si la decisión tiene efecto.** El campo
«Volver a comprobar FMCSA cada (días)» aceptaba un número y no decía nada más.
Ahora, debajo, `App\Support\Fmcsa\RevalidationState` pone una de tres cosas:

- sin proveedor conectado: que no se está revalidando a nadie, que **ese número
  todavía no gobierna nada**, y cuántos transportistas llevan más del plazo;
- con proveedor y sin ninguna revalidación aún: que conviene comprobar el
  planificador;
- con proveedor y con historial: la fecha de la última.

## Las dos decisiones que importan

### El proveedor y la última ejecución van separados

Que haya proveedor conectado **no** significa que la revalidación esté
corriendo: hace falta además que el planificador ejecute `notifications:sweep`.
Por eso `RevalidationState` devuelve `providerLive` y `lastVerifiedAt` por
separado y la pantalla los cuenta por separado. Juntarlos en un solo semáforo
verde sería inventarse una garantía — que es exactamente el defecto que este
lote arregla, en pequeño.

### `NULL` no es «al día»

Un transportista sin `fmcsa_last_verified_at` cuenta como vencido. Sin eso, una
empresa recién montada vería un cero tranquilizador teniendo a todos sin
comprobar.

## Un guardián que ya existía hizo su trabajo

`tests/Unit/Suite/CarrierPromisesTest` fija desde un lote anterior las frases
exactas «re-verified automatically» y «revalida automáticamente», con este
comentario:

> Si alguien las reescribe, esta prueba lo dice y hay que revisar si lo que se
> cumple sigue siendo lo que se promete.

Mi primera redacción quitó «automáticamente» de paso, y la prueba lo cazó. La
promesa de automatismo **sí** se cumple; lo único que sobraba era la cifra. El
guardián no estaba de más: evitó que el arreglo de una mentira se llevara por
delante una verdad.

## Lo que queda fuera, y se dice

- **Esto NO hace que se revalide a nadie.** El cron del planificador y las
  credenciales de FMCSA son de servidor. Mientras no estén, lo que hay es una
  pantalla que lo dice claramente en vez de un número que aparenta gobernar.
- **La web podría decir el número real** en el dominio propio de una empresa,
  interpolando su ajuste. No se ha hecho: duplicaría la copia pública en dos
  variantes —con empresa y sin ella— y cada variante es una frase más que puede
  quedarse desfasada. Si algún día se hace, el número tiene que salir del ajuste
  y no escribirse a mano; el guardián de este lote lo exige.
- **`dueCount` cuenta transportistas, no urgencia.** No distingue al que lleva
  un día de más del que lleva un año.
- **Nadie avisa por campana de esto.** Se ve al abrir ajustes. Meterlo en el
  barrido de avisos sería razonable y no se ha hecho aquí.

## Ficheros

| Fichero | Qué hace |
|---|---|
| `app/Support/Fmcsa/RevalidationState.php` | **Nuevo.** Si la revalidación pasa de verdad, y desde cuándo. |
| `app/Http/Controllers/App/TenantSettingController.php` | Manda ese estado a la pantalla. |
| `resources/js/pages/App/Settings/Index.tsx` | El aviso debajo del campo. |
| `lang/{en,es}/marketing.json` | Las dos frases públicas, sin cifra. |
| `lang/{en,es}/settings.json` | Los tres avisos del campo. |
| `tests/Unit/Suite/PublicCadenceTest.php` | **Nuevo.** 8 guardianes, 9 sabotajes en rojo. |
| `tests/Feature/Settings/RevalidationStateTest.php` | **Nuevo.** 6 pruebas del estado real. |
