<?php

declare(strict_types=1);

namespace App\Support\Signatures;

use Carbon\CarbonImmutable;
use Dompdf\Dompdf;
use Dompdf\Options;

/**
 * Convierte una plantilla y una firma en los dos PDF que quedan guardados.
 *
 * DOS DOCUMENTOS Y NO UNO. El primero es el acuerdo con la firma dentro, que es
 * lo que la gente entiende por «el papel firmado». El segundo es el certificado
 * de auditoría: quién firmó, cuándo, desde qué IP y con qué navegador, y las
 * huellas de todo. Van separados porque tienen destinos distintos — el acuerdo
 * se enseña y se manda, el certificado se guarda y solo sale si alguien discute
 * la firma— y porque meter los datos técnicos dentro del acuerdo ensucia el
 * documento que la gente firma.
 *
 * El HTML se construye aquí y no en una vista Blade a propósito: el cuerpo de
 * la plantilla lo escribe una persona de la empresa y todo lo que entra se
 * escapa con `e()`. Una vista con `{!! !!}` en el sitio equivocado convertiría
 * el campo «cuerpo del acuerdo» en una vía para inyectar HTML en un PDF que se
 * le manda a un tercero.
 */
final class Renderer
{
    /**
     * El documento firmado.
     *
     * @param  array<string, mixed>  $tokenValues
     * @return string Bytes del PDF.
     */
    public static function signedDocument(
        string $titulo,
        string $cuerpo,
        array $tokenValues,
        string $textoConsentimiento,
        string $firmanteNombre,
        ?string $firmanteCargo,
        string $firmanteCorreo,
        string $firmaDataUrl,
        CarbonImmutable $firmadoEl,
        string $locale,
    ): string {
        $texto = TemplateBody::render($cuerpo, $tokenValues);

        $etiquetas = self::labels($locale);

        $html = '<!doctype html><html><head><meta charset="utf-8"><style>'
            .self::css()
            .'</style></head><body>'
            .'<h1>'.e($titulo).'</h1>'
            .self::paragraphs($texto)
            .'<div class="bloque-firma">'
            .'<p class="etiqueta">'.e($etiquetas['consent']).'</p>'
            .'<p class="consentimiento">'.e($textoConsentimiento).'</p>'
            .'<table class="firma"><tr>'
            .'<td class="marca">'
            .($firmaDataUrl === '' ? '' : '<img src="'.e($firmaDataUrl).'" alt="">')
            .'<div class="raya"></div>'
            .'<p class="pie">'.e($etiquetas['signature']).'</p>'
            .'</td>'
            .'<td class="datos">'
            .'<p><strong>'.e($firmanteNombre).'</strong></p>'
            .($firmanteCargo === null || $firmanteCargo === '' ? '' : '<p>'.e($firmanteCargo).'</p>')
            .'<p>'.e($firmanteCorreo).'</p>'
            .'<p>'.e($etiquetas['signedOn'].' '.$firmadoEl->format('Y-m-d H:i:s')).' UTC</p>'
            .'</td>'
            .'</tr></table>'
            .'</div>'
            .'</body></html>';

        return self::toPdf($html);
    }

    /**
     * El certificado de auditoría.
     *
     * @param  list<array{type: string, at: string, ip: string|null, actor: string|null}>  $eventos
     * @param  array<string, string>  $huellas
     * @return string Bytes del PDF.
     */
    public static function auditCertificate(
        string $titulo,
        string $solicitudId,
        string $firmanteNombre,
        string $firmanteCorreo,
        array $eventos,
        array $huellas,
        string $locale,
    ): string {
        $etiquetas = self::labels($locale);

        $filas = '';

        foreach ($eventos as $e) {
            $filas .= '<tr><td>'.e($e['at']).'</td><td>'.e($etiquetas['events'][$e['type']] ?? $e['type']).'</td>'
                .'<td>'.e((string) ($e['actor'] ?? '—')).'</td><td>'.e((string) ($e['ip'] ?? '—')).'</td></tr>';
        }

        $huellasHtml = '';

        foreach ($huellas as $nombre => $valor) {
            $huellasHtml .= '<tr><td class="nombre-huella">'.e($nombre).'</td><td class="huella">'.e($valor).'</td></tr>';
        }

        $html = '<!doctype html><html><head><meta charset="utf-8"><style>'
            .self::css()
            .'</style></head><body>'
            .'<h1>'.e($etiquetas['certificateTitle']).'</h1>'
            .'<p class="sub">'.e($titulo).'</p>'
            .'<table class="datos-cert">'
            .'<tr><td>'.e($etiquetas['requestId']).'</td><td>'.e($solicitudId).'</td></tr>'
            .'<tr><td>'.e($etiquetas['signer']).'</td><td>'.e($firmanteNombre).' &lt;'.e($firmanteCorreo).'&gt;</td></tr>'
            .'</table>'
            .'<h2>'.e($etiquetas['timeline']).'</h2>'
            .'<table class="tabla"><thead><tr>'
            .'<th>'.e($etiquetas['when']).'</th><th>'.e($etiquetas['event']).'</th>'
            .'<th>'.e($etiquetas['actor']).'</th><th>'.e($etiquetas['ip']).'</th>'
            .'</tr></thead><tbody>'.$filas.'</tbody></table>'
            .'<h2>'.e($etiquetas['hashes']).'</h2>'
            .'<table class="tabla">'.$huellasHtml.'</table>'
            .'<p class="aviso">'.e($etiquetas['legalNotice']).'</p>'
            .'</body></html>';

        return self::toPdf($html);
    }

    /** La imagen de una firma escrita a máquina, para que también haya marca. */
    public static function typedMark(string $nombre): string
    {
        // SVG y no un mapa de bits: no hace falta una librería de imágenes, se
        // ve nítido a cualquier tamaño y dompdf lo incrusta sin problema.
        $svg = '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="90" viewBox="0 0 420 90">'
            .'<text x="10" y="58" font-family="cursive, serif" font-size="42" fill="#111827">'
            .htmlspecialchars($nombre, ENT_QUOTES | ENT_XML1, 'UTF-8')
            .'</text></svg>';

        return 'data:image/svg+xml;base64,'.base64_encode($svg);
    }

    private static function toPdf(string $html): string
    {
        $opciones = new Options();
        // Nada de recursos remotos: el cuerpo lo escribe una persona de la
        // empresa, y un `<img src="http://…">` dentro de una plantilla haría
        // que el servidor saliera a buscar lo que diga esa cadena.
        $opciones->set('isRemoteEnabled', false);
        $opciones->set('isHtml5ParserEnabled', true);
        $opciones->set('defaultFont', 'DejaVu Sans');

        $pdf = new Dompdf($opciones);
        $pdf->setPaper('letter');
        $pdf->loadHtml($html, 'UTF-8');
        $pdf->render();

        return (string) $pdf->output();
    }

    private static function paragraphs(string $texto): string
    {
        $partes = preg_split('/\n\s*\n/', trim($texto)) ?: [];

        return implode('', array_map(
            static fn (string $p): string => '<p>'.nl2br(e(trim($p))).'</p>',
            $partes,
        ));
    }

    private static function css(): string
    {
        return 'body{font-family:"DejaVu Sans",sans-serif;font-size:10.5pt;color:#111827;line-height:1.5}'
            .'h1{font-size:15pt;margin:0 0 4pt}h2{font-size:11.5pt;margin:16pt 0 4pt}'
            .'p{margin:0 0 8pt}.sub{color:#4b5563;margin-bottom:12pt}'
            .'.bloque-firma{margin-top:24pt;border-top:1px solid #d1d5db;padding-top:12pt}'
            .'.etiqueta{font-weight:bold;margin-bottom:2pt}'
            .'.consentimiento{color:#4b5563;font-size:9pt}'
            .'table.firma{width:100%;margin-top:12pt}table.firma td{vertical-align:bottom}'
            .'td.marca{width:55%}td.marca img{max-height:60pt}'
            .'.raya{border-bottom:1px solid #111827;margin-top:2pt}'
            .'.pie{font-size:8.5pt;color:#6b7280;margin-top:2pt}'
            .'td.datos p{margin:0 0 2pt;font-size:9.5pt}'
            .'table.tabla{width:100%;border-collapse:collapse;font-size:9pt}'
            .'table.tabla th{text-align:left;border-bottom:1px solid #9ca3af;padding:3pt 4pt}'
            .'table.tabla td{border-bottom:1px solid #e5e7eb;padding:3pt 4pt}'
            .'table.datos-cert td{padding:2pt 4pt;font-size:9.5pt}'
            .'.nombre-huella{width:34%}.huella{font-family:"DejaVu Sans Mono",monospace;font-size:7.5pt;word-break:break-all}'
            .'.aviso{margin-top:16pt;font-size:8.5pt;color:#4b5563}';
    }

    /** @return array<string, mixed> */
    private static function labels(string $locale): array
    {
        // Las etiquetas del PDF van aquí y no en los diccionarios de pantalla
        // porque el PDF se genera en el idioma en que se MANDÓ la solicitud,
        // que no tiene por qué ser el de quien mira la aplicación en ese
        // momento. Pasar por __() cogería el idioma de la petición y produciría
        // un acuerdo en inglés para alguien al que se le escribió en español.
        $es = [
            'consent' => 'Consentimiento de firma electrónica',
            'signature' => 'Firma',
            'signedOn' => 'Firmado el',
            'certificateTitle' => 'Certificado de auditoría de firma',
            'requestId' => 'Solicitud',
            'signer' => 'Firmante',
            'timeline' => 'Cronología de la ceremonia',
            'when' => 'Cuándo',
            'event' => 'Evento',
            'actor' => 'Quién',
            'ip' => 'IP',
            'hashes' => 'Huellas criptográficas',
            'legalNotice' => 'Este certificado registra quién firmó, cuándo, desde qué dispositivo y dirección IP, y una huella criptográfica del documento exacto que se mostró. Por sí solo, no garantiza la validez legal del acuerdo en ninguna jurisdicción; conviene que las partes obtengan asesoría legal propia sobre lo firmado.',
            'events' => [
                'requested' => 'Solicitud creada',
                'emailed' => 'Enlace enviado',
                'opened' => 'Enlace abierto',
                'viewed' => 'Documento visto',
                'consent_shown' => 'Consentimiento mostrado',
                'consent_accepted' => 'Consentimiento aceptado',
                'signature_captured' => 'Firma capturada',
                'document_generated' => 'Documento generado',
                'sealed' => 'Registro sellado',
                'declined' => 'Firma rechazada',
                'voided' => 'Solicitud anulada',
                'superseded' => 'Plantilla reemplazada',
                'certificate_downloaded' => 'Certificado descargado',
            ],
        ];

        $en = [
            'consent' => 'Electronic signature consent',
            'signature' => 'Signature',
            'signedOn' => 'Signed on',
            'certificateTitle' => 'Signature audit certificate',
            'requestId' => 'Request',
            'signer' => 'Signer',
            'timeline' => 'Ceremony timeline',
            'when' => 'When',
            'event' => 'Event',
            'actor' => 'Who',
            'ip' => 'IP',
            'hashes' => 'Cryptographic hashes',
            'legalNotice' => 'This certificate records who signed, when, from what device and IP address, and a cryptographic fingerprint of the exact document shown. On its own it does not guarantee the legal validity of the agreement in any jurisdiction; the parties should obtain their own legal advice about what was signed.',
            'events' => [
                'requested' => 'Request created',
                'emailed' => 'Link sent',
                'opened' => 'Link opened',
                'viewed' => 'Document viewed',
                'consent_shown' => 'Consent shown',
                'consent_accepted' => 'Consent accepted',
                'signature_captured' => 'Signature captured',
                'document_generated' => 'Document generated',
                'sealed' => 'Record sealed',
                'declined' => 'Signature declined',
                'voided' => 'Request voided',
                'superseded' => 'Template superseded',
                'certificate_downloaded' => 'Certificate downloaded',
            ],
        ];

        return $locale === 'es' ? $es : $en;
    }
}
