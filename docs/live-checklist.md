# El visto verde que se guardó el día que se guardó

## El defecto

La ficha del transportista pintaba una lista de cumplimiento con vistos verdes
—certificado de seguro, autoridad operativa, contrato firmado, FMCSA, W-9—
leídos de la columna JSON `carrier_onboardings.checklist`.

**Nadie la escribía.** En el alta se guardaba `json_encode([])` y ningún camino
la actualizaba jamás; los únicos valores de verdad los ponía el sembrador de
datos de demostración.

De ahí salen dos defectos a la vez:

- Con datos de demostración, el visto verde era una foto del día en que se
  sembró. Seguía diciendo «Certificado de seguro ✓» después de que el
  certificado caducara.
- Con datos reales, la lista era `[]` siempre, así que la tarjeta **no salía
  nunca**. Quien lleva cumplimiento no tenía ese resumen en la ficha.

## Lo que hace peor el hallazgo

El argumento en contra ya estaba escrito en el repositorio, en el docblock de
`App\Support\Onboarding\Readiness`:

> **SE CALCULA, NO SE GUARDA.** `carrier_onboardings` tiene una columna
> `checklist` de tipo JSON y este servicio NO la escribe, a propósito: una lista
> guardada dice «listo» el día que se guardó y sigue diciéndolo el día que
> caduca el certificado de seguro. La pregunta «¿puede llevar carga HOY?» solo
> la puede contestar el estado de hoy.

Ese servicio ya calculaba el estado en vivo, tirando de `Guards` —la misma clase
que decide si una carga se puede despachar—, y la pantalla de Incorporación ya
lo usaba. La ficha del transportista leía la columna.

Es la forma del lote anterior repetida: **el defecto ya estaba diagnosticado por
escrito, y el diagnóstico no llegó a una de las pantallas.**

## De dónde salen ahora las filas

De `requiredDocuments`, o sea de `DocumentTypes::requiredFor('carrier')`, no de
una lista escrita a mano. Si mañana el esquema exige un documento más, la lista
lo enseña sin tocar el fichero — y si se escribiera a mano, esta tarjeta diría
«listo» mientras `Guards` bloquea el despacho, que es exactamente la
contradicción que `Readiness` existe para no tener.

Cada fila se rotula con `documents.types.<tipo>`: el mismo nombre que ese papel
tiene en la pantalla de Documentos, en vez de una copia aparte que se despiste.

## Dos cosas que cambian de significado

**El W-9 desaparece de la lista.** No está en `requiredFor`, así que no bloquea
nada, y un visto verde a su lado sugería que sí. Que deba exigirse es una
decisión de negocio y le toca a quien lleva la casa.

**La fila de FMCSA va marcada como aviso.** Hoy no impide despachar —lo dice el
docblock de `Readiness`— y pintarla igual que las demás haría creer lo
contrario. En pantalla lleva «(aviso, no bloquea)».

## La columna se va

Una columna que nadie escribe y que nadie puede leer sin equivocarse es una
trampa esperando a la siguiente persona.
`2026_09_15_100000_drop_frozen_onboarding_checklist` la quita. No se pierde
ningún dato de una empresa real: todas las filas de producción valen `[]`.

## Comprobado en el navegador

```
es Atlas (aprobado): LISTA DE COMPROBACIÓN | Calculada ahora mismo, no guardada.
   ✓ certificado de seguro Sí | ✓ autoridad operativa Sí | ✓ contrato del
   transportista Sí | ✓ Verificación FMCSA (aviso, no bloquea)

en Atlas (approved):  CHECKLIST | Worked out just now, not stored.
   ✓ certificate of insurance Yes | ✓ operating authority Yes | ✓ carrier
   agreement Yes | ✓ FMCSA verification (warning, not a block)
```

Y un transportista en borrador enseña las mismas filas con «No».

## Requiere `php artisan migrate` en el despliegue

Es la tercera migración pendiente, con las de `3445093` y `514a328`.

## Guardianes

`tests/Unit/Suite/LiveChecklistTest.php` (6) y
`tests/Feature/Onboarding/LiveChecklistTest.php` (8). **12 sabotajes, 12
cazados**, incluidos marcarlo todo hecho, escribir las filas a mano, dar FMCSA
por comprobada sin comprobarla, y devolver un sitio donde guardar la lista.

`OnboardingQueueTest::no guarda ninguna lista de comprobación` se queda,
apuntando ahora a que la columna no vuelva a existir.
