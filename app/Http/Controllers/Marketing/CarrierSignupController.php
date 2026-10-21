<?php

declare(strict_types=1);

namespace App\Http\Controllers\Marketing;

use App\Enums\Locale;
use App\Enums\OnboardingStatus;
use App\Http\Requests\Marketing\StoreCarrierSignupRequest;
use App\Models\Carrier;
use App\Models\CarrierOnboarding;
use App\Models\Lead;
use App\Support\Leads\Arrival;
use App\Support\Locales;
use App\Support\Marketing\PublicFactoring;
use App\Support\Plans\Limits;
use App\Support\TenantContext;
use App\Support\Webhooks\Deliveries;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;

/**
 * El alta pública de transportista.
 *
 * Hace una cosa distinta según DÓNDE se envíe, y la diferencia no es un detalle:
 *
 *  • **En el dominio propio de una empresa** hay un tenant, así que se crea un
 *    `carriers` de verdad con su `carrier_onboardings` en borrador. El
 *    transportista aparece en la cola de altas de esa empresa.
 *
 *  • **En el sitio de la plataforma** (goliathdispatch.com) NO hay empresa a la
 *    que pertenecer, y `carriers.tenant_id` es NOT NULL. Aquí sería fácil
 *    inventarse algo —crear un tenant «huérfano», o dejar la columna en null y
 *    quitar la restricción—; las dos cosas serían mentirle al esquema. Lo que se
 *    hace es lo honesto: se guarda como `lead` con origen `carrier_signup`, que
 *    es exactamente para lo que `leads` tiene columnas `dot_number` y
 *    `mc_number`. Comercial lo enruta a la empresa que corresponda.
 */
final class CarrierSignupController
{
    public function __construct(private readonly TenantContext $context) {}

    public function __invoke(StoreCarrierSignupRequest $request): RedirectResponse
    {
        $data = $request->validated();

        /** @var Locale $locale */
        $locale = $request->attributes->get('locale', Locales::default());

        /*
         * El nombre de la factoring se resuelve ANTES de abrir la transacción.
         *
         * Devuelve el identificador si ese nombre es una empresa activa de esta
         * casa, y null si no lo es. Null no es un fallo: es «escribió un nombre
         * que no está en la lista», que es para lo que existe «Other». Las dos
         * respuestas van a columnas distintas y nunca a las dos a la vez —el
         * CHECK de la base lo impide, y aquí se cumple por construcción.
         */
        $factoriza = (bool) ($data['uses_factoring'] ?? false);
        $nombreFactoring = $factoriza ? ($data['factoring_company_name'] ?? null) : null;
        $fichaFactoring = $nombreFactoring === null
            ? null
            : PublicFactoring::resolve(
                $this->context->hasTenant() ? (string) $this->context->id() : null,
                (string) $nombreFactoring,
            );

        $declarada = [
            'id' => $fichaFactoring,
            'nombre' => $fichaFactoring === null ? $nombreFactoring : null,
        ];

        $prospecto = DB::transaction(function () use ($data, $locale, $request, $factoriza, $declarada): Lead {
            $lead = Lead::create([
                'first_name' => $data['contact_first_name'],
                'last_name' => $data['contact_last_name'],
                'email' => $data['email'],
                'phone' => $data['phone'],
                'company_name' => $data['legal_name'],
                'dot_number' => $data['dot_number'],
                'mc_number' => $data['mc_number'] ?? null,
                'locale' => $locale->value,
                // En el sitio de la plataforma el prospecto ES el resultado, así
                // que esta es la ÚNICA fila que llega a guardar la respuesta.
                // Antes de este lote la casilla se marcaba y no iba a ningún
                // sitio: `leads` no tenía dónde ponerla.
                'uses_factoring' => $factoriza,
                'factoring_company_id' => $declarada['id'],
                'factoring_company_name' => $declarada['nombre'],
                'source' => 'carrier_signup',
                'source_path' => mb_substr((string) $request->headers->get('referer'), 0, 500) ?: null,
                'ip_address' => $request->ip(),
                'user_agent' => mb_substr((string) $request->userAgent(), 0, 1000),
            ]);

            if (! $this->context->hasTenant()) {
                return $lead; // Sitio de la plataforma: el lead ES el resultado.
            }

            // El tope de transportistas del plan, si la empresa lo tiene puesto.
            //
            // Y aquí el tope NO se le enseña a nadie: se queda el lead y no se
            // crea el transportista. Quien rellena este formulario es un tercero
            // —una empresa de transporte que quiere trabajar con la casa de
            // despacho— y no tiene ninguna relación con el plan que la casa haya
            // contratado. Devolverle un error suyo sería cobrarle a él una
            // decisión comercial nuestra.
            //
            // Así que la casa recibe el contacto igual, en la bandeja de leads, y
            // decide: llamarle, hacer sitio, o mejorar el plan. Lo único que no
            // pasa solo es el alta automática, que es justo lo que el tope
            // limita.
            if (Limits::isFull((string) $this->context->id(), Limits::CARRIERS)) {
                return $lead;
            }

            $carrier = Carrier::create([
                'legal_name' => $data['legal_name'],
                'dba' => $data['dba'] ?? null,
                'dot_number' => $data['dot_number'],
                'mc_number' => $data['mc_number'] ?? null,
                'contact_first_name' => $data['contact_first_name'],
                'contact_last_name' => $data['contact_last_name'],
                'email' => $data['email'],
                'phone' => $data['phone'],
                'website' => $data['website'] ?? null,
                'preferred_locale' => $data['preferred_locale'],
                'physical_line1' => $data['physical_line1'],
                'physical_line2' => $data['physical_line2'] ?? null,
                'physical_city' => $data['physical_city'],
                'physical_state' => $data['physical_state'],
                'physical_postal_code' => $data['physical_postal_code'],
                'physical_country' => 'US',
                ...$this->mailing($data),
                'uses_factoring' => $factoriza,
                // DECLARADO, no asignado. La asignación vive en
                // `factoring_assignments` y la establece la casa desde la ficha;
                // un tercero rellenando un formulario público no puede crear un
                // vínculo que nadie ha verificado. Ver la migración
                // 2026_10_21_100000_declared_factoring.
                'factoring_declared_company_id' => $declarada['id'],
                'factoring_declared_name' => $declarada['nombre'],
                'onboarding_status' => OnboardingStatus::Draft,
            ]);

            CarrierOnboarding::create([
                'carrier_id' => $carrier->id,
                'status' => OnboardingStatus::Draft,
            ]);

            $lead->forceFill(['status' => 'converted'])->save();

            return $lead;
        });

        // FUERA de la transacción. La pantalla le acaba de decir a un
        // desconocido que alguien le responderá en un día hábil, y hasta este
        // lote no había nada que se lo contara a nadie. Va después del commit
        // porque entre perder el contacto y perder la campanita no hay duda de
        // cuál se puede perder.
        Arrival::announce($prospecto, $this->context->hasTenant() ? (string) $this->context->id() : null);

        /*
         * Y el webhook, si esta casa tiene uno configurado.
         *
         * También FUERA de la transacción, y por lo mismo: entre perder el
         * contacto de un transportista y perder una llamada a un sistema de
         * terceros no hay duda de cuál duele menos.
         *
         * Esto NO sale a la red: solo anota la entrega pendiente. La manda el
         * barrido `webhooks:deliver`. Si saliera aquí, el tiempo de respuesta
         * de este formulario pasaría a depender de lo que tarde el servidor de
         * otro — y un receptor caído dejaría colgada a la persona que acaba de
         * pulsar enviar.
         *
         * En el sitio de la plataforma no hay empresa, así que no hay ajustes y
         * no hay webhook. Es la misma decisión que toma `Arrival`.
         */
        if ($this->context->hasTenant()) {
            Deliveries::record((string) $this->context->id(), $prospecto, $data);
        }

        return back()->with('success', (string) __('marketing.carrierSignup.success.title'));
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function mailing(array $data): array
    {
        $same = (bool) ($data['mailing_same_as_physical'] ?? false);

        // Cuando es la misma, se COPIA en vez de dejarla vacía. Un cheque o una
        // liquidación se manda a la dirección postal, y leer «si está vacía usa
        // la física» en cada uno de esos sitios es donde acaba yendo un pago a la
        // dirección equivocada.
        return [
            'mailing_same_as_physical' => $same,
            'mailing_line1' => $same ? $data['physical_line1'] : ($data['mailing_line1'] ?? null),
            'mailing_line2' => $same ? ($data['physical_line2'] ?? null) : ($data['mailing_line2'] ?? null),
            'mailing_city' => $same ? $data['physical_city'] : ($data['mailing_city'] ?? null),
            'mailing_state' => $same ? $data['physical_state'] : ($data['mailing_state'] ?? null),
            'mailing_postal_code' => $same ? $data['physical_postal_code'] : ($data['mailing_postal_code'] ?? null),
            'mailing_country' => 'US',
        ];
    }
}
