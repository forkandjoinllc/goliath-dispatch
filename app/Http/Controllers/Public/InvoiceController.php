<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Services\Payments\InvoicePaymentProvider;
use App\Support\Branding\Brand;
use App\Support\Finance\InvoiceLink;
use App\Support\Finance\InvoicePayments;
use App\Support\InertiaPage;
use App\Support\TenantContext;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/**
 * La factura que ve —y paga— el cliente, sin cuenta.
 *
 * ## Qué se enseña, y qué NO
 *
 * Se enseña lo que hace falta para reconocer la factura y pagarla: el número, el
 * cliente, las líneas, el total y el saldo. Y nada más.
 *
 * NO se enseña la comisión del despachador, ni las notas internas, ni nada del
 * margen de la casa de despacho. La consulta pide las columnas UNA A UNA por
 * eso: un `select *` aquí se convierte en una filtración el día que alguien
 * añada una columna a `invoices`.
 *
 * Ojo con quién es «el cliente» aquí: esta factura es lo que la casa de despacho
 * le cobra al TRANSPORTISTA por su tarifa de despacho. Quien abre esta página es
 * el transportista, no el dueño de la carga.
 *
 * ## El testigo es la autorización
 *
 * Quien abre esto no tiene sesión. El testigo sale del enlace, y de ahí sale el
 * `tenant_id` que estrecha todo lo demás — nunca al revés.
 */
final class InvoiceController
{
    use InertiaPage;

    public function __invoke(Request $request, string $token): Response
    {
        $resultado = InvoiceLink::resolve($token);
        $factura = $resultado['invoice'];

        $this->usesDictionary($request, ['invoices', 'common']);

        if ($factura === null) {
            return Inertia::render('Public/Invoice', [
                'state' => $resultado['state'],
                'invoice' => null,
                'brand' => null,
                'provider' => null,
            ])->toResponse($request)->setStatusCode(404);
        }

        $tenantId = (string) $factura->tenant_id;

        return Inertia::render('Public/Invoice', [
            'state' => 'active',
            'invoice' => $this->presentar($factura, $tenantId),
            'brand' => Brand::for($tenantId),
            'provider' => [
                'live' => app(InvoicePaymentProvider::class)->isLive(),
            ],
            'token' => $token,
        ])->toResponse($request);
    }

    /**
     * Empezar a pagar.
     *
     * Se apunta el intento ANTES de mandar a la pasarela, no después: si se
     * apuntara después, un cliente que paga y cierra la pestaña dejaría un cobro
     * hecho sin ninguna fila que lo explique.
     */
    public function pay(Request $request, string $token, InvoicePaymentProvider $provider): RedirectResponse
    {
        $resultado = InvoiceLink::resolve($token);
        $factura = $resultado['invoice'];

        abort_if($factura === null, 404);

        $saldo = (int) $factura->balance_cents;

        if ($saldo <= 0) {
            return back()->with('error', __('invoices.public.alreadyPaid'));
        }

        // La clave de idempotencia identifica UN intento, no una factura.
        //
        // Si ya hay uno pendiente por este mismo importe se reutiliza: dos
        // pulsaciones del mismo botón son un solo cobro. Si el anterior ya se
        // resolvió —lo rechazaron, por ejemplo— se abre uno NUEVO, porque volver
        // a intentarlo es exactamente lo que toca.
        //
        // Con una clave fija por factura e importe pasaba lo contrario: el doble
        // clic se colapsaba bien y un pago rechazado dejaba la factura
        // impagable para siempre. Lo encontró el navegador al recorrer el camino
        // del fallo antes que el del éxito.
        $pendiente = InvoicePayments::pendiente((string) $factura->tenant_id, (string) $factura->id, $saldo);
        $clave = $pendiente?->idempotency_key ?? 'inv_'.$factura->id.'_'.$saldo.'_'.Str::lower(Str::random(12));

        $sesion = $provider->checkoutUrl(
            tenantId: (string) $factura->tenant_id,
            invoiceId: (string) $factura->id,
            amountCents: $saldo,
            idempotencyKey: $clave,
            // CON el prefijo de idioma. Sin él, el transportista que estaba
            // leyendo en español volvía de la pasarela a la misma página en
            // inglés: el idioma lo manda el enlace, y perderlo en el camino de
            // vuelta es perderlo justo cuando la persona está mirando si le han
            // cobrado. Lo encontró el navegador.
            returnUrl: url('/'.app()->getLocale().'/i/'.$token),
        );

        if ($pendiente === null) {
            InvoicePayments::start(
                tenantId: (string) $factura->tenant_id,
                invoiceId: (string) $factura->id,
                amountCents: $saldo,
                method: 'card',
                idempotencyKey: $clave,
                providerReference: $sesion->reference,
            );
        }

        return redirect()->away($sesion->url);
    }

    /**
     * @return array<string, mixed>
     */
    private function presentar(object $factura, string $tenantId): array
    {
        $transportista = app(TenantContext::class)->withoutTenant(fn () => DB::table('carriers')
            ->where('id', $factura->carrier_id)
            ->value('legal_name'));

        // UNA A UNA, y ninguna del margen. Ver la nota de la clase.
        $lineas = app(TenantContext::class)->withoutTenant(fn () => DB::table('invoice_line_items')
            ->where('invoice_id', $factura->id)
            ->whereNull('deleted_at')
            ->orderBy('sequence')
            ->get(['description_en', 'description_es', 'quantity', 'unit_amount_cents', 'amount_cents'])
            ->map(static fn (object $l): array => [
                // La descripción viene en los dos idiomas desde que se emitió la
                // factura. Se elige la del idioma en el que se está mirando la
                // página, y se cae al inglés cuando la española está vacía.
                'description' => app()->getLocale() === 'es' && $l->description_es !== null && $l->description_es !== ''
                    ? (string) $l->description_es
                    : (string) $l->description_en,
                'quantity' => (float) $l->quantity,
                'unitAmountCents' => (int) $l->unit_amount_cents,
                'amountCents' => (int) $l->amount_cents,
            ])
            ->all());

        return [
            'number' => (string) $factura->invoice_number,
            'carrier' => $transportista === null ? null : (string) $transportista,
            'status' => (string) $factura->status,
            'issueDate' => $factura->issue_date === null ? null : substr((string) $factura->issue_date, 0, 10),
            'dueDate' => $factura->due_date === null ? null : substr((string) $factura->due_date, 0, 10),
            'totalCents' => (int) $factura->total_cents,
            'paidCents' => (int) $factura->amount_paid_cents,
            'balanceCents' => (int) $factura->balance_cents,
            'lines' => $lineas,
        ];
    }
}
