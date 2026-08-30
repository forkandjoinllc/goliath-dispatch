<?php

declare(strict_types=1);

namespace App\Support\Signatures;

/**
 * Las plantillas con las que arranca una empresa nueva.
 *
 * Son un PUNTO DE PARTIDA, no un documento legal. Están escritas para que la
 * pantalla tenga algo real que enseñar y para que se vea qué forma tiene una
 * plantilla, y dicen en su propio texto que hay que revisarlas con un abogado
 * antes de mandárselas a nadie. Una casa de despacho que use estas palabras tal
 * cual está usando texto que escribió un programa, no su acuerdo.
 *
 * Las tres claves coinciden con tres tipos de `documents.document_type`
 * —`carrier_agreement`, `notice_of_assignment`, `change_of_payee`— que ya
 * existían en el esquema. El documento firmado se guarda con ese tipo, sobre el
 * transportista, y aparece en su expediente como cualquier otro papel suyo.
 */
final class DefaultTemplates
{
    /**
     * @return list<array{
     *     key: string, titleEn: string, titleEs: string,
     *     bodyEn: string, bodyEs: string,
     *     consentEn: string, consentEs: string,
     * }>
     */
    public static function all(): array
    {
        return [
            [
                'key' => 'carrier_agreement',
                'titleEn' => 'Broker–Carrier Agreement',
                'titleEs' => 'Acuerdo entre corredor y transportista',
                'bodyEn' => <<<'TXT'
                This agreement is entered into on {{effectiveDate}} between {{tenantLegalName}} ("Broker") and {{carrierLegalName}}, USDOT {{carrierUsdot}} ("Carrier").

                1. Scope. Carrier agrees to transport shipments tendered by Broker under the rates and terms confirmed for each individual load. Each rate confirmation forms part of this agreement.

                2. Authority and insurance. Carrier warrants that it holds and will maintain operating authority and the insurance coverage required by law, and that it will notify Broker within 24 hours of any lapse.

                3. Independent contractor. Carrier is an independent contractor. Nothing here creates an employment, partnership, or agency relationship.

                4. Payment. Broker pays Carrier the agreed rate after receipt of a signed proof of delivery and a correct invoice, on the terms stated on the rate confirmation.

                5. Term. This agreement continues until either party ends it in writing. Loads already in transit are completed under these terms.

                REVIEW BEFORE USE. This is a starting template supplied with the software. It is not legal advice and has not been reviewed for your state or your operation. Have your own attorney review and adapt it before sending it to a carrier.
                TXT,
                'bodyEs' => <<<'TXT'
                Este acuerdo se celebra el {{effectiveDate}} entre {{tenantLegalName}} («el Corredor») y {{carrierLegalName}}, USDOT {{carrierUsdot}} («el Transportista»).

                1. Alcance. El Transportista se compromete a transportar los envíos que le ofrezca el Corredor conforme a las tarifas y condiciones confirmadas para cada carga. Cada confirmación de tarifa forma parte de este acuerdo.

                2. Autoridad y seguro. El Transportista declara que tiene y mantendrá la autoridad de operación y la cobertura de seguro que exige la ley, y que avisará al Corredor dentro de las 24 horas siguientes a cualquier interrupción.

                3. Contratista independiente. El Transportista es un contratista independiente. Nada de lo aquí escrito crea una relación laboral, de sociedad ni de representación.

                4. Pago. El Corredor paga al Transportista la tarifa acordada tras recibir un comprobante de entrega firmado y una factura correcta, en las condiciones que indique la confirmación de tarifa.

                5. Vigencia. Este acuerdo sigue vigente hasta que cualquiera de las partes lo termine por escrito. Las cargas ya en tránsito se completan bajo estas condiciones.

                REVÍSELO ANTES DE USARLO. Esta es una plantilla de partida que viene con el programa. No es asesoría legal y no ha sido revisada para su estado ni para su operación. Haga que su propio abogado la revise y la adapte antes de mandársela a un transportista.
                TXT,
                'consentEn' => 'By signing below you agree to sign this document electronically, and that your electronic signature has the same effect as a handwritten one to the extent permitted by applicable law. You may request a paper copy instead at any time before signing.',
                'consentEs' => 'Al firmar abajo acepta firmar este documento de forma electrónica, y que su firma electrónica tenga el mismo efecto que una manuscrita en la medida en que lo permita la ley aplicable. Puede pedir una copia en papel en cualquier momento antes de firmar.',
            ],
            [
                'key' => 'notice_of_assignment',
                'titleEn' => 'Notice of Assignment',
                'titleEs' => 'Aviso de cesión',
                'bodyEn' => <<<'TXT'
                Date: {{effectiveDate}}

                To: {{carrierLegalName}}, USDOT {{carrierUsdot}}

                {{tenantLegalName}} has assigned its accounts receivable to {{factoringCompanyName}}. From this date forward, all payments owed under invoices issued by {{tenantLegalName}} must be sent to {{factoringCompanyName}} at the remittance address shown on each invoice.

                Payment made to anyone other than {{factoringCompanyName}} does not discharge the debt. This notice stays in effect until {{factoringCompanyName}} revokes it in writing.

                REVIEW BEFORE USE. This is a starting template supplied with the software. It is not legal advice. Have your own attorney and your factoring company review the wording before it is sent.
                TXT,
                'bodyEs' => <<<'TXT'
                Fecha: {{effectiveDate}}

                Para: {{carrierLegalName}}, USDOT {{carrierUsdot}}

                {{tenantLegalName}} ha cedido sus cuentas por cobrar a {{factoringCompanyName}}. A partir de esta fecha, todo pago que se deba por facturas emitidas por {{tenantLegalName}} debe enviarse a {{factoringCompanyName}}, a la dirección de remesa que figure en cada factura.

                Un pago hecho a cualquier otro que no sea {{factoringCompanyName}} no extingue la deuda. Este aviso sigue vigente hasta que {{factoringCompanyName}} lo revoque por escrito.

                REVÍSELO ANTES DE USARLO. Esta es una plantilla de partida que viene con el programa. No es asesoría legal. Haga que su abogado y su empresa de factoring revisen la redacción antes de mandarla.
                TXT,
                'consentEn' => 'By signing below you acknowledge that you have received and read this notice of assignment, and you agree to sign it electronically to the extent permitted by applicable law.',
                'consentEs' => 'Al firmar abajo reconoce que ha recibido y leído este aviso de cesión, y acepta firmarlo electrónicamente en la medida en que lo permita la ley aplicable.',
            ],
            [
                'key' => 'change_of_payee',
                'titleEn' => 'Change of Payee',
                'titleEs' => 'Cambio de beneficiario de pago',
                'bodyEn' => <<<'TXT'
                Date: {{effectiveDate}}

                {{carrierLegalName}}, USDOT {{carrierUsdot}}, directs {{tenantLegalName}} to send all payments owed to it, from this date forward, to:

                {{newPayeeName}}

                This direction replaces any previous payment instruction on file. It stays in effect until {{carrierLegalName}} changes it in a signed writing.

                REVIEW BEFORE USE. This is a starting template supplied with the software. It is not legal advice. Confirm the new payee by a separate channel before you act on a change of payment instructions — this document is one of the most commonly forged in freight.
                TXT,
                'bodyEs' => <<<'TXT'
                Fecha: {{effectiveDate}}

                {{carrierLegalName}}, USDOT {{carrierUsdot}}, indica a {{tenantLegalName}} que envíe todos los pagos que le correspondan, a partir de esta fecha, a:

                {{newPayeeName}}

                Esta indicación reemplaza cualquier instrucción de pago anterior que conste en el expediente. Sigue vigente hasta que {{carrierLegalName}} la cambie por escrito y firmado.

                REVÍSELO ANTES DE USARLO. Esta es una plantilla de partida que viene con el programa. No es asesoría legal. Confirme al nuevo beneficiario por otro canal antes de actuar sobre un cambio de instrucciones de pago — este documento es de los que más se falsifican en el transporte.
                TXT,
                'consentEn' => 'By signing below you confirm that you are authorized to change the payment instructions for this company, and you agree to sign electronically to the extent permitted by applicable law.',
                'consentEs' => 'Al firmar abajo confirma que está autorizado para cambiar las instrucciones de pago de esta empresa, y acepta firmar electrónicamente en la medida en que lo permita la ley aplicable.',
            ],
        ];
    }
}
