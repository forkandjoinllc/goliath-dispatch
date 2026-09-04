# El día hábil que nadie prometía cumplir

## El defecto

La página pública de alta de transportista dice, después de enviar el
formulario:

> Our onboarding team typically responds within one business day. Keep an eye
> on the email address you provided.

Y el formulario de contacto dice «nos pondremos en contacto en breve».

Los dos controladores que reciben esos formularios —`CarrierSignupController` y
`LeadController`— escribían la fila y **no avisaban a nadie**:

```
$ grep -cE "Notifier|Mail::|notification" \
    app/Http/Controllers/Marketing/CarrierSignupController.php \
    app/Http/Controllers/Marketing/LeadController.php
0
0
```

La única superficie era una tarjeta del panel, que solo existe si alguien lo
abre. Un desconocido recibía un compromiso **con plazo** y no había nada en el
sistema capaz de que alguien se enterara dentro de ese plazo.

## Lo que se hizo

**Al llegar.** `App\Support\Leads\Arrival::announce()` avisa a quien tenga
`lead:read` en esa empresa, con el suceso `lead.received`. Se llama desde las
tres puertas públicas: `CarrierSignupController::__invoke`,
`LeadController::storeLead` y `LeadController::storeQuote`.

**Al pasar el plazo.** `notifications:sweep` gana una pasada nueva,
`prospectosSinAtender()`: prospectos en `status = 'new'`, sin asignar, creados
antes de **un día hábil** — no antes de veinticuatro horas. Suceso
`lead.unattended`.

**Lo que la campana no alcanza.** Un alta enviada desde el sitio de la
plataforma no tiene empresa, y `notifications.tenant_id` es `NOT NULL`. Esos
prospectos se cuentan, con la fecha del más antiguo, en la pantalla de salud de
la plataforma (`orphanLeads`), que es donde mira quien los tiene que enrutar.

## Las tres decisiones que importan

### 1. El aviso va FUERA de la transacción

El prospecto se guarda en una transacción; `Arrival::announce()` se llama
**después** de que confirme. Si el aviso fallara dentro, se llevaría por delante
el prospecto — y entre perder el contacto de alguien que quiere trabajar
contigo y perder la campanita, no hay duda de cuál se puede perder.

Para poder hacerlo, la clausura de la transacción pasó a devolver el `Lead` en
sus tres salidas (incluida la del tope de plan, que no crea transportista).

### 2. Sin empresa NO se inventa una

```php
if ($tenantId === null || $tenantId === '') {
    return 0;
}
```

Era fácil rodearlo: crear un tenant «huérfano», o quitar el `NOT NULL`. Las dos
cosas serían mentirle al esquema para que sonara una campana. Se devuelve cero,
y el caso se cuenta donde se puede ver.

### 3. Un día hábil no son veinticuatro horas

```php
public static function unDiaHabilAntes(CarbonImmutable $desde): CarbonImmutable
{
    $anterior = $desde->subDay();

    while ($anterior->isSaturday() || $anterior->isSunday()) {
        $anterior = $anterior->subDay();
    }

    return $anterior;
}
```

Un alta que entra el viernes por la tarde no lleva un día hábil sin atender el
sábado. Restando horas a secas, el barrido del sábado avisaría de un
incumplimiento que no ha ocurrido — y una campana que avisa de lo que no pasó
deja de mirarse.

## Los rótulos ya estaban escritos

`events.lead.received` estaba en los dos idiomas en el diccionario **portado**
`notification.json`, sin usar. Es la segunda vez que ese portado paga —la
primera fue `document.expired`— y su entrada en `PORTADOS_REVISADOS` decía
«repasado». Un repaso que se queda a medias parece un repaso hecho.

Del español había que corregir el género: decía «Nueva prospecto».

`events.lead.unattended` es nuevo, en los dos idiomas, con su `eventNames` para
la casilla de preferencias — un suceso que se manda y no tiene casilla es un
suceso que no se puede apagar.

## Lo que queda fuera, y se dice

- **El correo depende del proveedor.** El aviso se escribe siempre; que además
  salga por correo depende de que haya credenciales de envío configuradas. Sin
  ellas queda la campana dentro de la aplicación, que es donde se ve.
- **El plazo no se mide contra el horario de la empresa.** «Un día hábil» aquí
  es «no cae en sábado ni domingo». No conoce los festivos federales ni el
  horario que cada empresa publique. Es más estricto que la promesa, no menos:
  avisa antes, nunca después.
- **Nadie cierra el aviso al atender el prospecto.** Se marca como leído a mano.
  La clave de deduplicación garantiza que no vuelva a sonar.
- **El 429 del formulario público no dice nada.** Al superar el límite de seis
  envíos por hora, la página vuelve a pintar el formulario sin explicar por qué
  no se aceptó. Se descubrió recorriéndolo; no se tocó en este lote.

## Ficheros

| Fichero | Qué hace |
|---|---|
| `app/Support/Leads/Arrival.php` | **Nuevo.** El único sitio que decide a quién se avisa de un prospecto nuevo. |
| `app/Http/Controllers/Marketing/CarrierSignupController.php` | La clausura devuelve el `Lead`; el aviso, tras el commit. |
| `app/Http/Controllers/Marketing/LeadController.php` | Igual, en las dos puertas. |
| `app/Console/Commands/SweepNotifications.php` | `prospectosSinAtender()`, `unDiaHabilAntes()`, y el total impreso. |
| `app/Http/Controllers/App/NotificationController.php` | Los dos sucesos, en el catálogo de preferencias. |
| `app/Http/Controllers/Platform/HealthController.php` | `prospectosSinEmpresa()` → `orphanLeads`. |
| `resources/js/pages/Platform/Health.tsx` | El bloque ámbar de prospectos sin empresa. |
| `lang/{en,es}/notifications.json` | Los dos sucesos, con `eventNames`. |
| `lang/{en,es}/platform.json` | El bloque de la pantalla de salud. |
| `tests/Support/Scenario.php` | `user(Role::PlatformSuperAdmin)` ya no muere con `Undefined array key`. |
| `tests/Unit/Suite/LeadResponseTest.php` | **Nuevo.** 12 guardianes, 16 sabotajes en rojo. |
| `tests/Feature/Leads/ArrivalTest.php` | **Nuevo.** 8 pruebas del recorrido completo. |
