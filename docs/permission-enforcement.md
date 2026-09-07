# El permiso que no mandaba

## El defecto

Dieciséis claves de `Permissions::ALL` estaban repartidas en `RoleMatrix` y
**ningún código las consultaba jamás**.

`RoleMatrix` no es documentación: es lo que lee un administrador para decidir a
quién le da qué rol. Un permiso que nadie comprueba es una frontera dibujada en
un mapa que el terreno no tiene.

## El caso grave

`document:delete` — «Soft-delete a document» — lo tiene **solo el admin**.

La acción que quita un documento del expediente de una carga autorizaba contra
otra cosa:

```php
$scope = $checker->authorize($actor, 'load:document:upload', null, $policy);
```

Y `load:document:upload` lo tienen el admin, el despachador, el transportista
**y el conductor**. La frontera real era cuatro roles más ancha que la dibujada:
un transportista podía quitar del expediente de su carga un papel que había
subido la casa.

Encima, el botón «Descolgar» **no llevaba ninguna comprobación en el cliente**.
No era el patrón conocido de «escondido en el navegador y abierto en el
servidor»: estaba abierto en los dos.

El segundo caso: `savePreferences` no comprobaba **nada** más allá de estar
autenticado, teniendo `notification:preference:update` definido exactamente para
eso.

## Lo que se hizo

**Los que gobiernan algo real, conectados:**

- `document:delete` guarda ahora el descuelgue, y la pantalla manda `can.detach`
  para no ofrecer lo que va a rechazar.
- `notification:preference:update` guarda el guardado de preferencias.

**Los que no nombran nada que exista, anotados:** `App\Authorization\Enforcement`
lleva la lista con el motivo de cada uno. **No se borran.**

**El agujero, cerrado:** `tests/Unit/Suite/PermissionEnforcementTest` exige que
toda clave del catálogo o se consulte en el código, o esté en esa lista con su
motivo. Una clave nueva no puede volver a aparecer sin gobernar nada.

## Un cambio de comportamiento, dicho en voz alta

**Antes de este lote, el despachador, el transportista y el conductor podían
quitar documentos del expediente de una carga. Ahora no.**

Eso es lo que la matriz decía desde el principio, así que el código ha pasado a
obedecerla — pero es un cambio visible y puede que la matriz sea lo que hay que
revisar, no el código. Si en la operación real hace falta que un despachador
descuelgue un papel mal colgado, lo correcto es **darle `document:delete` en
`RoleMatrix`**, no volver a autorizar contra el permiso de subir. La una es una
decisión escrita donde se leen las decisiones; la otra es un agujero.

Dos fijaciones existentes de `LoadDocumentTest` descolgaban con el despachador y
pasaban en verde: **habían aprendido el defecto y lo defendían**. Ahora suben con
el despachador y descuelgan con el admin, que es la separación que la matriz
describe.

## Lo que queda fuera, y se dice

- **`Enforcement::SIN_APLICAR` documenta un estado, no lo arregla.** Doce claves
  siguen sin gobernar nada. Lo que cambia es que consta y que no crecerá en
  silencio.
- **Dos de ellas son la mitad hecha de una función que no existe:**
  `tenant:integration:read` y `tenant:integration:update`. Hay tabla, modelo y 28
  claves de diccionario para una pantalla de integraciones que no está
  construida. Cuando se construya, esos dos permisos son los que la guardan — y
  por eso no se borran.
- **`signature:sign` e `invoice:pay` no son descuidos:** las dos ceremonias son
  enlaces públicos sin sesión, y sin actor no hay contra quién comprobar nada.
  Está anotado para que nadie los «arregle» metiendo una sesión donde no debe
  haberla.
- **No se ha revisado si la matriz reparte de más en otros sitios.** Este lote
  comprueba que lo declarado se aplica, no que lo declarado sea la política
  correcta. Eso es una decisión tuya, no una verificación mía.

## Ficheros

| Fichero | Qué hace |
|---|---|
| `app/Authorization/Enforcement.php` | **Nuevo.** Qué permisos no gobiernan nada, y por qué. |
| `app/Http/Controllers/App/LoadDocumentController.php` | Descolgar pide `document:delete`; la pantalla recibe `can.detach`. |
| `app/Http/Controllers/App/NotificationController.php` | Guardar preferencias pide su permiso. |
| `resources/js/pages/App/Loads/Documents.tsx` | El botón se pinta solo a quien puede. |
| `tests/Unit/Suite/PermissionEnforcementTest.php` | **Nuevo.** 8 guardianes, 9 sabotajes en rojo. |
| `tests/Feature/Authorization/DocumentDeleteTest.php` | **Nuevo.** 7 pruebas de la frontera real. |
| `tests/Feature/LoadDocuments/LoadDocumentTest.php` | Dos fijaciones que defendían el defecto, corregidas. |
