<?php

declare(strict_types=1);

namespace App\Support\Loads;

use App\Support\Documents\Scanning;
use App\Support\Storage\DocumentStore;
use Carbon\CarbonImmutable;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * La confirmación de tarifa: el papel por el que se discute el dinero.
 *
 * Hoy se le asigna una carga a un transportista y no queda constancia de que
 * aceptara la tarifa. `rate_confirmation_acceptances` llevaba desde el primer
 * día en el esquema esperando a que alguien la escribiera, y su forma dice
 * exactamente cómo hay que hacerlo: `actor_user_id` es NOT NULL y
 * `document_version_id` también. O sea, una persona con cuenta, y una versión
 * concreta de un fichero concreto — no «el transportista dijo que sí por
 * teléfono» ni «aceptó la tarifa que hubiera entonces».
 *
 * POR ESO ESTO NO ES UN ENLACE ANÓNIMO. La ceremonia de firma sí lo es: allí el
 * firmante puede no tener cuenta y el token es la autorización. Aquí el esquema
 * exige un usuario, y con razón: quien acepta una tarifa está comprometiendo
 * dinero de su empresa, y hace falta saber QUIÉN de esa empresa fue.
 *
 * LA HUELLA ES DE LOS BYTES QUE VIO. `document_sha256` se copia del fichero
 * guardado en el momento de decidir, no se recalcula después ni se toma del
 * texto que originó el PDF. Si mañana alguien emite una confirmación nueva con
 * otra tarifa, la aceptación sigue apuntando a la huella del papel que el
 * transportista tuvo delante.
 */
final class RateConfirmation
{
    /** @var list<string> */
    public const DECISIONES = ['accepted', 'rejected', 'changes_requested'];

    /**
     * Emite la confirmación de tarifa de una carga: genera el PDF, lo guarda y
     * crea la fila de `documents` del tipo correcto sobre la carga.
     *
     * Cada emisión es un documento NUEVO, no una versión del anterior. Una
     * confirmación reemitida con otra tarifa es otro papel, y encadenarlas como
     * versiones del mismo documento haría que una aceptación apuntara a un
     * `document_id` cuyo contenido vigente ya no es el que se aceptó.
     *
     * @return array{documentId: string, versionId: string, sha256: string}
     */
    public static function issue(object $carga, DocumentStore $store, string $locale): array
    {
        $pdf = self::toPdf(self::html(self::datos($carga), $locale));

        $clave = $store->putBytes((string) $carga->tenant_id, $pdf, 'pdf');
        $sha = hash('sha256', $pdf);

        $documentoId = (string) Str::uuid();
        $versionId = (string) Str::uuid();
        $ahora = CarbonImmutable::now();

        DB::table('documents')->insert([
            'id' => $documentoId,
            'tenant_id' => (string) $carga->tenant_id,
            'document_type' => 'rate_confirmation',
            'owner_type' => 'load',
            'owner_id' => (string) $carga->id,
            'title' => mb_substr(($locale === 'es' ? 'Confirmación de tarifa ' : 'Rate confirmation ').$carga->load_number, 0, 200),
            // Lo emitió la propia casa a partir de sus propios datos: no hay
            // nada que revisar en una cola de aprobación.
            'review_status' => 'approved',
            'current_version_id' => $versionId,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        DB::table('document_versions')->insert([
            'id' => $versionId,
            'tenant_id' => (string) $carga->tenant_id,
            'document_id' => $documentoId,
            'version_number' => 1,
            'storage_key' => $clave,
            'original_filename' => Str::slug((string) $carga->load_number).'-rate-confirmation.pdf',
            'content_type' => 'application/pdf',
            'byte_size' => strlen($pdf),
            'sha256' => $sha,
            // Un fichero que se generó este mismo servidor: no viene de fuera y
            // no hay nada que mandar a analizar. `not_scanned` dice eso, y es
            // distinto de `unavailable`, que dice que sí se quiso mirar.
            ...Scanning::propio(),
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return ['documentId' => $documentoId, 'versionId' => $versionId, 'sha256' => $sha];
    }

    /**
     * La confirmación vigente de una carga: la última emitida.
     *
     * @return object|null Con document_id, document_version_id, sha256, storage_key, issued_at.
     */
    public static function current(string $tenantId, string $loadId): ?object
    {
        return DB::table('documents as d')
            ->join('document_versions as v', 'v.id', '=', 'd.current_version_id')
            ->where('d.tenant_id', $tenantId)
            ->where('d.owner_type', 'load')
            ->where('d.owner_id', $loadId)
            ->where('d.document_type', 'rate_confirmation')
            ->whereNull('d.deleted_at')
            ->orderByDesc('d.created_at')
            ->first([
                'd.id as document_id',
                'v.id as document_version_id',
                'v.sha256',
                'v.storage_key',
                'd.created_at as issued_at',
            ]);
    }

    /**
     * Anota la decisión del transportista.
     *
     * No se comprueba aquí si ya había una decisión: que se pueda o no volver a
     * decidir es política, y la decide quien llama. Lo que sí se garantiza es
     * que cada decisión queda con la huella del papel que se tenía delante en
     * ese momento, así que un historial de tres decisiones sobre tres
     * confirmaciones distintas se lee sin ambigüedad.
     */
    public static function decide(
        object $carga,
        object $confirmacion,
        string $decision,
        ?string $reason,
        string $actorUserId,
        ?string $ip,
        ?string $userAgent,
    ): string {
        $id = (string) Str::uuid();
        $ahora = CarbonImmutable::now();

        DB::table('rate_confirmation_acceptances')->insert([
            'id' => $id,
            'tenant_id' => (string) $carga->tenant_id,
            'load_id' => (string) $carga->id,
            'carrier_id' => (string) $carga->carrier_id,
            'document_id' => (string) $confirmacion->document_id,
            'document_version_id' => (string) $confirmacion->document_version_id,
            'decision' => $decision,
            'decision_reason' => $reason,
            'actor_user_id' => $actorUserId,
            // Del fichero que se le enseñó, no de lo que diga la carga ahora.
            'document_sha256' => (string) $confirmacion->sha256,
            // La tarifa del momento, congelada. La columna de la carga puede
            // cambiar mañana; lo que se aceptó fue esta cifra.
            'rated_amount_cents' => $carga->carrier_gross_rate_cents,
            'ip_address' => $ip,
            'user_agent' => $userAgent,
            'decided_at' => $ahora,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return $id;
    }

    /**
     * Los datos que van al papel, sacados de la carga.
     *
     * @return array<string, mixed>
     */
    public static function datos(object $carga): array
    {
        $transportista = DB::table('carriers')
            ->where('id', $carga->carrier_id)
            ->first(['legal_name', 'dot_number', 'mc_number']);

        $empresa = DB::table('tenants')
            ->where('id', $carga->tenant_id)
            ->first(['legal_name', 'display_name']);

        $paradas = DB::table('load_stops as s')
            ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
            ->where('s.load_id', $carga->id)
            ->whereNull('s.deleted_at')
            ->orderBy('s.sequence')
            ->get([
                's.stop_type', 's.facility_name', 's.city', 's.state', 's.window_start', 's.window_end',
                'cl.name as location_name', 'cl.city as location_city', 'cl.state as location_state',
            ])
            ->map(static fn (object $s): array => [
                'type' => (string) $s->stop_type,
                'name' => $s->location_name ?? $s->facility_name,
                'city' => $s->location_city ?? $s->city,
                'state' => $s->location_state ?? $s->state,
                'windowStart' => $s->window_start === null ? null : substr((string) $s->window_start, 0, 16),
                'windowEnd' => $s->window_end === null ? null : substr((string) $s->window_end, 0, 16),
            ])
            ->all();

        return [
            'loadNumber' => (string) $carga->load_number,
            'tenantName' => (string) ($empresa->legal_name ?? $empresa->display_name ?? ''),
            'carrierName' => (string) ($transportista->legal_name ?? ''),
            'carrierDot' => $transportista->dot_number ?? null,
            'carrierMc' => $transportista->mc_number ?? null,
            'commodity' => $carga->commodity ?? null,
            'weightPounds' => $carga->weight_pounds ?? null,
            'miles' => $carga->miles ?? null,
            // SOLO lo que se le paga al transportista. Lo que la casa le cobra
            // al cliente NO va en este papel: es margen y no es asunto suyo.
            'rateCents' => $carga->carrier_gross_rate_cents,
            'stops' => $paradas,
            'instructions' => $carga->special_instructions ?? null,
        ];
    }

    /**
     * El PDF de una carga, para quien quiera mirarlo sin guardarlo.
     *
     * @return string Bytes del PDF.
     */
    public static function preview(object $carga, string $locale): string
    {
        return self::toPdf(self::html(self::datos($carga), $locale));
    }

    /**
     * El HTML del que sale el PDF.
     *
     * Es público a propósito: lo que hay que poder comprobar de este documento
     * es QUÉ DICE —y sobre todo qué NO dice, que es lo que la casa le cobra al
     * cliente— y eso se comprueba aquí. Ir a buscarlo dentro del PDF significa
     * inflar flujos zlib y deshacer el escapado de dompdf para acabar
     * comprobando lo mismo, con una prueba que se rompe cuando la librería
     * cambie de compresión.
     *
     * @param  array<string, mixed>  $d
     */
    public static function html(array $d, string $locale): string
    {
        $es = $locale === 'es';

        $t = $es
            ? [
                'title' => 'Confirmación de tarifa', 'load' => 'Carga', 'carrier' => 'Transportista',
                'broker' => 'Corredor', 'commodity' => 'Mercancía', 'weight' => 'Peso',
                'miles' => 'Millas', 'rate' => 'Tarifa al transportista', 'stops' => 'Paradas',
                'pickup' => 'Recogida', 'delivery' => 'Entrega', 'window' => 'Ventana',
                'instructions' => 'Instrucciones', 'pounds' => 'lb',
                'notice' => 'Este documento recoge la tarifa acordada para esta carga. La aceptación queda registrada en el sistema con la fecha, el usuario que aceptó y una huella criptográfica de este PDF exacto. Este registro no constituye por sí solo un contrato ni asesoría legal.',
            ]
            : [
                'title' => 'Rate confirmation', 'load' => 'Load', 'carrier' => 'Carrier',
                'broker' => 'Broker', 'commodity' => 'Commodity', 'weight' => 'Weight',
                'miles' => 'Miles', 'rate' => 'Carrier rate', 'stops' => 'Stops',
                'pickup' => 'Pickup', 'delivery' => 'Delivery', 'window' => 'Window',
                'instructions' => 'Instructions', 'pounds' => 'lb',
                'notice' => 'This document states the agreed rate for this load. Acceptance is recorded in the system with the date, the accepting user, and a cryptographic fingerprint of this exact PDF. This record does not by itself constitute a contract or legal advice.',
            ];

        $filas = '';

        foreach ($d['stops'] as $s) {
            $lugar = implode(', ', array_filter([$s['name'], $s['city'], $s['state']]));
            $ventana = $s['windowStart'] === null
                ? '—'
                : $s['windowStart'].($s['windowEnd'] === null ? '' : ' – '.$s['windowEnd']);

            $filas .= '<tr><td>'.e($s['type'] === 'pickup' ? $t['pickup'] : $t['delivery']).'</td>'
                .'<td>'.e($lugar).'</td><td>'.e($ventana).'</td></tr>';
        }

        $tarifa = $d['rateCents'] === null
            ? '—'
            : '$'.number_format(((int) $d['rateCents']) / 100, 2);

        $identificadores = implode(' · ', array_filter([
            $d['carrierDot'] === null ? null : 'USDOT '.$d['carrierDot'],
            $d['carrierMc'] === null ? null : 'MC '.$d['carrierMc'],
        ]));

        $html = '<!doctype html><html><head><meta charset="utf-8"><style>'
            .'body{font-family:"DejaVu Sans",sans-serif;font-size:10.5pt;color:#111827;line-height:1.5}'
            .'h1{font-size:16pt;margin:0 0 2pt}.sub{color:#4b5563;margin:0 0 14pt}'
            .'table.datos{width:100%;margin-bottom:12pt}table.datos td{padding:2pt 0;vertical-align:top}'
            .'td.et{width:32%;color:#4b5563}'
            .'table.tabla{width:100%;border-collapse:collapse;margin-top:4pt}'
            .'table.tabla th{text-align:left;border-bottom:1px solid #9ca3af;padding:3pt 4pt;font-size:9pt}'
            .'table.tabla td{border-bottom:1px solid #e5e7eb;padding:3pt 4pt;font-size:9.5pt}'
            .'h2{font-size:11.5pt;margin:14pt 0 2pt}'
            .'.tarifa{font-size:15pt;font-weight:bold}'
            .'.aviso{margin-top:18pt;font-size:8.5pt;color:#4b5563;border-top:1px solid #d1d5db;padding-top:8pt}'
            .'</style></head><body>'
            .'<h1>'.e($t['title']).'</h1>'
            .'<p class="sub">'.e($t['load'].' '.$d['loadNumber']).'</p>'
            .'<table class="datos">'
            .'<tr><td class="et">'.e($t['broker']).'</td><td>'.e($d['tenantName']).'</td></tr>'
            .'<tr><td class="et">'.e($t['carrier']).'</td><td>'.e($d['carrierName'])
            .($identificadores === '' ? '' : '<br>'.e($identificadores)).'</td></tr>'
            .($d['commodity'] === null ? '' : '<tr><td class="et">'.e($t['commodity']).'</td><td>'.e((string) $d['commodity']).'</td></tr>')
            .($d['weightPounds'] === null ? '' : '<tr><td class="et">'.e($t['weight']).'</td><td>'.e(number_format((int) $d['weightPounds']).' '.$t['pounds']).'</td></tr>')
            .($d['miles'] === null ? '' : '<tr><td class="et">'.e($t['miles']).'</td><td>'.e((string) $d['miles']).'</td></tr>')
            .'<tr><td class="et">'.e($t['rate']).'</td><td class="tarifa">'.e($tarifa).'</td></tr>'
            .'</table>'
            .'<h2>'.e($t['stops']).'</h2>'
            .'<table class="tabla"><thead><tr><th></th><th></th><th>'.e($t['window']).'</th></tr></thead>'
            .'<tbody>'.$filas.'</tbody></table>'
            .($d['instructions'] === null || $d['instructions'] === ''
                ? ''
                : '<h2>'.e($t['instructions']).'</h2><p>'.nl2br(e((string) $d['instructions'])).'</p>')
            .'<p class="aviso">'.e($t['notice']).'</p>'
            .'</body></html>';

        return $html;
    }

    private static function toPdf(string $html): string
    {
        $opciones = new Options;
        $opciones->set('isRemoteEnabled', false);
        $opciones->set('isHtml5ParserEnabled', true);
        $opciones->set('defaultFont', 'DejaVu Sans');

        $pdf = new Dompdf($opciones);
        $pdf->setPaper('letter');
        $pdf->loadHtml($html, 'UTF-8');
        $pdf->render();

        return (string) $pdf->output();
    }
}
