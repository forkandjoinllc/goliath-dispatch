<?php

declare(strict_types=1);

namespace App\Http\Controllers\Marketing;

use App\Enums\Locale;
use App\Http\Requests\Marketing\StoreLeadRequest;
use App\Http\Requests\Marketing\StoreQuoteRequestRequest;
use App\Models\Lead;
use App\Models\QuoteRequest;
use App\Support\Locales;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Recibe los formularios públicos de contacto y de presupuesto.
 *
 * `tenant_id` no se toca: lo pone el scope a partir del contexto que resolvió
 * ResolveTenant. Un envío desde goliathdispatch.com produce un lead de la
 * plataforma; el mismo formulario en el dominio propio de una empresa produce un
 * lead de esa empresa. Que lo decida el host y no el formulario es lo que impide
 * que alguien elija a qué empresa mandarle sus leads.
 */
final class LeadController
{
    public function storeLead(StoreLeadRequest $request): RedirectResponse
    {
        $data = $request->validated();

        Lead::create([
            'first_name' => $data['first_name'],
            'last_name' => $data['last_name'],
            'email' => $data['email'],
            'phone' => $data['phone'] ?? null,
            'company_name' => $data['company_name'] ?? null,
            'message' => $data['message'] ?? null,
            'locale' => $this->locale($request)->value,
            'source' => 'contact_form',
            'source_path' => mb_substr((string) $request->headers->get('referer'), 0, 500) ?: null,
            'utm' => $this->utm($request),
            'ip_address' => $request->ip(),
            'user_agent' => mb_substr((string) $request->userAgent(), 0, 1000),
        ]);

        return back()->with('success', (string) __('marketing.forms.success.leadTitle'));
    }

    public function storeQuote(StoreQuoteRequestRequest $request): RedirectResponse
    {
        $data = $request->validated();
        $locale = $this->locale($request);

        DB::transaction(function () use ($data, $locale, $request): void {
            // Toda solicitud de presupuesto crea TAMBIÉN un lead. Son dos cosas
            // distintas: el presupuesto es la carga concreta, el lead es la
            // persona a la que hay que llamar. Sin el lead, una solicitud que no
            // acaba en carga desaparece del embudo comercial.
            [$firstName, $lastName] = $this->splitName($data['contact_name']);

            $lead = Lead::create([
                'first_name' => $firstName,
                'last_name' => $lastName,
                'email' => $data['email'],
                'phone' => $data['phone'] ?? null,
                'company_name' => $data['company_name'] ?? null,
                'message' => $data['notes'] ?? null,
                'locale' => $locale->value,
                'source' => 'quote_form',
                'source_path' => mb_substr((string) $request->headers->get('referer'), 0, 500) ?: null,
                'utm' => $this->utm($request),
                'ip_address' => $request->ip(),
                'user_agent' => mb_substr((string) $request->userAgent(), 0, 1000),
            ]);

            QuoteRequest::create([
                'lead_id' => $lead->id,
                'contact_name' => $data['contact_name'],
                'email' => $data['email'],
                'phone' => $data['phone'] ?? null,
                'company_name' => $data['company_name'] ?? null,
                'commodity' => $data['commodity'] ?? null,
                'weight_pounds' => $data['weight_pounds'] ?? null,
                'length_inches' => $data['length_inches'] ?? null,
                'width_inches' => $data['width_inches'] ?? null,
                'height_inches' => $data['height_inches'] ?? null,
                'origin_city' => $data['origin_city'] ?? null,
                'origin_state' => $data['origin_state'] ?? null,
                'destination_city' => $data['destination_city'] ?? null,
                'destination_state' => $data['destination_state'] ?? null,
                'ready_date' => $data['ready_date'] ?? null,
                'equipment_preference' => $data['equipment_preference'] ?? null,
                'is_oversize_suspected' => $data['is_oversize_suspected'] ?? false,
                'notes' => $data['notes'] ?? null,
                'locale' => $locale->value,
                'ip_address' => $request->ip(),
                'user_agent' => mb_substr((string) $request->userAgent(), 0, 1000),
            ]);
        });

        return back()->with('success', (string) __('marketing.forms.success.quoteTitle'));
    }

    private function locale(Request $request): Locale
    {
        return $request->attributes->get('locale', Locales::default());
    }

    /**
     * Solo los cinco parámetros utm_*, y nada más de la cadena de consulta.
     *
     * Guardar la query entera metería en la base de datos cualquier cosa que
     * alguien cuelgue de un enlace, incluida información personal que nadie pidió
     * y que después habría que purgar.
     *
     * @return array<string, string>|null
     */
    private function utm(Request $request): ?array
    {
        $utm = [];

        foreach (['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as $key) {
            $value = $request->query($key);
            if (is_string($value) && $value !== '') {
                $utm[$key] = mb_substr($value, 0, 200);
            }
        }

        return $utm === [] ? null : $utm;
    }

    /**
     * El formulario de presupuesto pide un nombre completo; `leads` guarda nombre
     * y apellido por separado. Se parte por el último espacio: no acierta con
     * todos los nombres del mundo, pero deja los dos campos rellenos y visibles
     * para que una persona los corrija, que es mejor que dejar el apellido vacío.
     *
     * @return array{0: string, 1: string}
     */
    private function splitName(string $full): array
    {
        $trimmed = trim(preg_replace('/\s+/u', ' ', $full) ?? $full);
        $position = mb_strrpos($trimmed, ' ');

        if ($position === false) {
            return [$trimmed, '—'];
        }

        return [mb_substr($trimmed, 0, $position), mb_substr($trimmed, $position + 1)];
    }
}
