<?php

declare(strict_types=1);

namespace App\Support\Leads;

use App\Models\Lead;
use App\Support\Notifications\Notifier;

/**
 * Avisar de que ha llegado un prospecto.
 *
 * ## El defecto
 *
 * La página pública de alta de transportista dice, después de enviar el
 * formulario: «Nuestro equipo de incorporación suele responder en un día hábil.
 * Esté pendiente del correo que nos dio». Y el formulario de contacto dice «nos
 * pondremos en contacto en breve».
 *
 * Los dos controladores escribían la fila y no avisaban a nadie: ni una llamada
 * al notificador, ni un correo, ni un suceso en el barrido diario. La única
 * superficie era una tarjeta del panel, que solo se ve si alguien lo abre. Un
 * desconocido recibía un compromiso CON PLAZO y el sistema no tenía forma de que
 * nadie se enterara dentro de ese plazo.
 *
 * El rótulo del aviso no había que inventarlo: `events.lead.received` estaba
 * escrito en los dos idiomas en el diccionario PORTADO `notification.json`
 * desde el puerto. Es la segunda vez que ese portado paga —la primera fue
 * `document.expired`— y su entrada en `PORTADOS_REVISADOS` decía «repasado».
 * Un repaso que se queda a medias parece un repaso hecho.
 *
 * ## Fuera de la transacción, a propósito
 *
 * El prospecto se guarda en una transacción; esto se llama DESPUÉS de que
 * confirme. Si el aviso fallara dentro, se llevaría por delante el prospecto —
 * y entre perder el contacto de alguien que quiere trabajar contigo y perder la
 * campanita, no hay duda de cuál se puede perder.
 *
 * ## Sin empresa no hay a quién avisar
 *
 * `notifications.tenant_id` es NOT NULL, y un alta enviada desde el sitio de la
 * PLATAFORMA no tiene empresa: `CarrierSignupController` lo explica y se niega a
 * inventarse una. Aquí se sigue esa decisión en vez de rodearla. Esos
 * prospectos se cuentan en la pantalla de salud de la plataforma, que es el
 * sitio donde mira quien los tiene que enrutar.
 */
final class Arrival
{
    public const SUCESO = 'lead.received';

    /**
     * Avisa a quien puede ver prospectos en esa empresa.
     *
     * @return int cuántos avisos se escribieron
     */
    public static function announce(Lead $lead, ?string $tenantId): int
    {
        if ($tenantId === null || $tenantId === '') {
            return 0;
        }

        $nombre = trim("{$lead->first_name} {$lead->last_name}");

        return Notifier::toPermissionHolders(
            tenantId: $tenantId,
            permission: 'lead:read',
            eventKey: self::SUCESO,
            // Una vez por prospecto y para siempre. Con la fecha dentro, el
            // mismo contacto volvería a sonar cada vez que corriera algo.
            dedupeKey: self::SUCESO.':'.$lead->id,
            params: [
                'name' => $nombre !== '' ? $nombre : (string) $lead->email,
                'company' => (string) ($lead->company_name ?? '—'),
            ],
            actionUrl: '/leads',
            subjectType: 'lead',
            subjectId: (string) $lead->id,
        );
    }
}
