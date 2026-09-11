<?php

declare(strict_types=1);

namespace App\Support\Marketing;

/**
 * Lo que la página pública promete, y qué código lo sostiene.
 *
 * ## Por qué existe este registro
 *
 * Las pantallas de dentro las usa quien ya compró y puede comprobarlas: si la
 * lista dice «por vencer» y no lo está, se nota. La página pública la lee quien
 * **todavía no tiene el producto** y no tiene cómo verificar nada. Una
 * afirmación de más ahí no es una molestia: es una venta hecha sobre algo que
 * no existe.
 *
 * Nunca se habían comprobado. Se auditaron las 31 afirmaciones con forma de
 * promesa funcional de las páginas vivas, una a una contra el código: **cinco
 * eran ciertas, dos falsas y catorce a medias**. Las dos falsas:
 *
 *  - «Se coteja con sus números de DOT y MC ante la FMCSA **antes de
 *    activarlo**» — aprobar un transportista no comprueba FMCSA en absoluto.
 *  - «Una carga no puede despacharse con un permiso **o escolta** pendiente» —
 *    `escorts.status` no lo lee ningún guardián. Una escolta en `pending` no
 *    impide nada.
 *
 * ## Qué hace este fichero
 *
 * Empareja cada afirmación con el símbolo que la sostiene. El guardián falla de
 * las tres maneras en que esto se descuadra:
 *
 *  1. La clave desaparece del diccionario y la entrada se queda huérfana.
 *  2. El código que la sostiene deja de existir.
 *  3. Aparece en la página una afirmación funcional nueva sin declarar.
 *
 * Lo tercero es lo que importa: obliga a que escribir una promesa en la página
 * de ventas pase por enseñar dónde está cumplida.
 *
 * ## Lo que este registro NO dice
 *
 * Que la promesa sea buena, ni que el código haga lo suficiente. Dice que
 * alguien emparejó las dos cosas a conciencia. La comprobación de si el texto
 * describe bien lo que hace ese código la hace una persona leyendo, y de eso
 * salió esta auditoría.
 */
final class PublicClaims
{
    /**
     * Afirmación => el código que la sostiene.
     *
     * @var array<string, string>
     */
    public const RESPALDOS = [
        // Dinero
        'about.values.auditableFinancials.body' => 'App\Support\Finance\SnapshotStore',
        'home.howItWorks.step5.body' => 'App\Support\Finance\Calculator',
        'home.proofPoints.item3.body' => 'App\Support\Finance\Money',
        'services.invoicingSettlements.body' => 'App\Support\Finance\SettlementBuilder',

        // Cumplimiento y puertas
        'home.howItWorks.step3.body' => 'App\Support\Loads\Guards',
        'home.proofPoints.item2.title' => 'App\Support\Loads\Guards',
        'home.proofPoints.item2.body' => 'App\Support\Equipment\Eligibility',
        'home.howItWorks.step2.body' => 'App\Support\Equipment\Media',
        'services.dispatch.body' => 'App\Support\Loads\ScheduleConflict',
        'services.dispatch.bullet2' => 'App\Support\Equipment\Eligibility',
        'services.permitsEscorts.bullet1' => 'App\Support\Oversize\Evaluator',
        'services.permitsEscorts.bullet3' => 'App\Support\Oversize\Papers',
        'home.oversizeBand.body' => 'App\Support\Oversize\Rules',

        // Admisión de transportistas
        'forCarriers.onboarding.certificateOfAuthority.body' => 'App\Support\Documents\DocumentTypes',
        'forCarriers.verification.body' => 'App\Support\Fmcsa\Revalidation',
        'services.onboardingCompliance.body' => 'App\Support\Documents\DocumentTypes',
        'services.onboardingCompliance.bullet3' => 'App\Support\Onboarding\Transitions',

        // Documentos
        'services.documentManagement.body' => 'App\Support\Compliance\ExpiryWindow',
        'services.documentManagement.bullet3' => 'App\Support\Storage\LocalDocumentStore',

        // Retención
        'privacy.sections.retention.body' => 'App\Support\Retention\Policy',

        // Comercial, sin código detrás a propósito: describe lo que hace una
        // persona con la solicitud, no lo que hace el sistema.
        'forClients.quoting.body' => self::LO_HACE_UNA_PERSONA,

        // Texto legal, editorial o de buscadores. No describe una función del
        // producto, así que no puede tener una clase detrás — pero se declara
        // igual: dejar fuera del registro lo que no encaja es exactamente el
        // hueco por donde entró la primera afirmación falsa.
        'privacy.hero.counselNote' => self::TEXTO_LEGAL,
        'privacy.sections.intro.body' => self::TEXTO_LEGAL,
        'privacy.sections.changesToPolicy.body' => self::TEXTO_LEGAL,
        'privacy.sections.yourRights.body' => self::TEXTO_LEGAL,
        'terms.hero.counselNote' => self::TEXTO_LEGAL,
        'terms.sections.carrierResponsibilities.body' => self::TEXTO_LEGAL,
        'terms.sections.prohibitedUses.body' => self::TEXTO_LEGAL,

        // Consejo de oficio sobre carga sobredimensionada: habla del mundo, no
        // del producto. El descargo de responsabilidad, además, LIMITA la
        // promesa en vez de ampliarla.
        'heavyHaul.disclaimer.body' => self::CONSEJO_DE_OFICIO,
        'heavyHaul.faq.q2.answer' => self::CONSEJO_DE_OFICIO,
        'heavyHaul.faq.q3.answer' => self::CONSEJO_DE_OFICIO,
        'heavyHaul.routeSurveys.body' => self::CONSEJO_DE_OFICIO,

        'seo.forCarriers.description' => self::TEXTO_LEGAL,
    ];

    /**
     * Para afirmaciones que describen trabajo humano y no una función.
     *
     * Declararlas así es la única forma honesta de que pasen el guardián: dejar
     * fuera del registro lo que no tiene código sería exactamente el hueco por
     * donde entró la primera afirmación falsa.
     */
    public const LO_HACE_UNA_PERSONA = 'persona';

    /** Política de privacidad, términos y texto para buscadores. */
    public const TEXTO_LEGAL = 'legal';

    /**
     * Consejo sobre el oficio, no sobre el producto.
     *
     * «El costo de una escolta innecesaria siempre es menor que el de una
     * multa» habla de la carretera. No hay código que lo cumpla ni que lo
     * incumpla.
     */
    public const CONSEJO_DE_OFICIO = 'oficio';
}
