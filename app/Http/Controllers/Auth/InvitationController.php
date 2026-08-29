<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Actions\Fortify\PasswordValidationRules;
use App\Actions\Tenancy\AcceptInvitation;
use App\Support\InertiaPage;
use App\Support\Invitations\Invitations;
use App\Support\TenantContext;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;
use stdClass;

/**
 * Aceptar una invitación. Pública: quien llega aquí todavía no tiene sesión.
 *
 * Un vale caducado, uno ya usado y uno inventado dan EXACTAMENTE la misma
 * pantalla. Distinguirlos sería decirle a quien prueba cadenas al azar cuándo
 * ha acertado una.
 *
 * Aceptar inicia la sesión. No se le manda al login a escribir la contraseña que
 * acaba de elegir: ya demostró que controla el correo y acaba de fijar la
 * credencial, así que pedírsela otra vez no comprueba nada nuevo.
 */
final class InvitationController
{
    use InertiaPage, PasswordValidationRules;

    public function show(Request $request, string $token): Response
    {
        $this->usesDictionary($request, ['users', 'auth', 'validation']);

        $fila = Invitations::find($token);

        if ($fila === null) {
            return Inertia::render('Auth/AcceptInvitation', ['invitation' => null]);
        }

        return Inertia::render('Auth/AcceptInvitation', [
            'invitation' => $this->present($fila),
        ]);
    }

    public function store(Request $request, string $token, AcceptInvitation $accept): RedirectResponse
    {
        $fila = Invitations::find($token);

        if ($fila === null) {
            return redirect()->route('login')->withErrors(['email' => __('users.accept.invalid')]);
        }

        $datos = $this->present($fila);

        $reglas = [
            'first_name' => ['required', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
        ];

        // A quien ya tenía cuenta no se le pide contraseña: la suya sigue siendo
        // la suya. Pedírsela aquí dejaría que un tercero se la cambiara con solo
        // invitarle.
        if ($datos['needsPassword']) {
            $reglas['password'] = $this->passwordRules();
        }

        $validado = $request->validate($reglas);

        $user = $accept(
            $fila,
            $datos['needsPassword'] ? (string) $validado['password'] : null,
            (string) $validado['first_name'],
            (string) $validado['last_name'],
        );

        Auth::login($user);
        $request->session()->regenerate();

        return redirect()->route('home')->with('success', __('users.accept.welcome'));
    }

    /**
     * Lo que la página puede saber del vale.
     *
     * Sale el correo —es el suyo, ya lo tiene delante en el mensaje— y el nombre
     * de la empresa. No sale el id de nadie ni el vale.
     *
     * @return array{email: string, company: string, role: string, firstName: string, lastName: string, needsPassword: bool}
     */
    private function present(stdClass $fila): array
    {
        $context = app(TenantContext::class);

        return $context->withoutTenant(function () use ($fila): array {
            $user = DB::table('users')
                ->where('id', $fila->user_id)
                ->first(['first_name', 'last_name', 'password']);

            $company = DB::table('tenants')->where('id', $fila->tenant_id)->value('display_name');

            /** @var array<string, mixed> $payload */
            $payload = json_decode((string) ($fila->payload ?? '{}'), true) ?: [];

            return [
                'email' => (string) $fila->email,
                'company' => (string) ($company ?? ''),
                'role' => (string) ($payload['role'] ?? ''),
                'firstName' => (string) ($user->first_name ?? ''),
                'lastName' => (string) ($user->last_name ?? ''),
                'needsPassword' => ($user->password ?? null) === null,
            ];
        });
    }
}
