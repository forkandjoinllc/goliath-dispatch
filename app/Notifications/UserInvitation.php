<?php

declare(strict_types=1);

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * El correo que invita a alguien a una empresa.
 *
 * Va en el idioma DE LA PERSONA INVITADA, no en el de quien invita ni en el del
 * servidor. Es lo primero que esa persona ve del producto; mandárselo en inglés
 * a alguien a quien se ha dado de alta con el idioma en español es empezar mal
 * una aplicación que se anuncia bilingüe.
 *
 * El vale viaja en la URL y NO se guarda en claro en ninguna parte: la base de
 * datos solo tiene su sha256. Ver App\Support\Invitations\Invitations.
 */
final class UserInvitation extends Notification
{
    use Queueable;

    public function __construct(
        private readonly string $token,
        private readonly string $companyName,
        private readonly string $inviterName,
        private readonly string $roleLabelKey,
        private readonly string $locale,
    ) {}

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $url = route('invitations.show', ['token' => $this->token]);
        $rol = $this->t($this->roleLabelKey);

        return (new MailMessage)
            ->subject($this->t('users.mail.subject', ['company' => $this->companyName]))
            ->greeting($this->t('users.mail.greeting'))
            ->line($this->t('users.mail.intro', [
                'inviter' => $this->inviterName,
                'company' => $this->companyName,
                'role' => $rol,
            ]))
            ->action($this->t('users.mail.action'), $url)
            // Se dice cuánto dura. Un enlace que deja de funcionar sin haber
            // avisado parece una aplicación rota, no una medida de seguridad.
            ->line($this->t('users.mail.expiry'))
            ->line($this->t('users.mail.ignore'));
    }

    /**
     * @param  array<string, string>  $replace
     */
    private function t(string $key, array $replace = []): string
    {
        return (string) __($key, $replace, $this->locale);
    }
}
