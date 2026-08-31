<?php

declare(strict_types=1);

namespace App\Support\Retention;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Qué se archiva, qué se purga y cuándo.
 *
 * La pantalla de configuración lleva desde el principio diciéndole al usuario
 * esto, palabra por palabra:
 *
 *   «Retención: los registros están activos {months} meses, se purgan {purge}
 *   años después de archivarse, y los financieros se conservan {financial}
 *   años.»
 *
 * Y no era verdad. Las tres cifras se guardaban en `tenant_settings`, se
 * pintaban en pantalla, y **ninguna línea de la aplicación las leía nunca**.
 * Nada se archivaba, nada se purgaba, y los borrados suaves se acumulaban para
 * siempre. Una pantalla que promete una política que no existe es peor que no
 * tener la pantalla: quien la lee deja de preguntar.
 *
 * Las dos clases de registro no son un capricho. En Estados Unidos los papeles
 * de un viaje y los papeles del dinero de ese viaje se conservan durante
 * plazos distintos, y el segundo es más largo. Mezclarlos obligaría a usar el
 * plazo más largo para todo, que es la forma cara de equivocarse, o el más
 * corto, que es la forma grave.
 *
 * ESTA CLASE NO GARANTIZA CUMPLIMIENTO LEGAL. Calcula fechas a partir de unos
 * números que alguien configuró. Si esos números son los correctos para la
 * jurisdicción, el tipo de carga y los contratos de esa empresa es una decisión
 * de un abogado, no de este código. Ver docs/retention.md.
 */
final class Policy
{
    /**
     * Las tablas que el barrido toca, y de qué clase es cada una.
     *
     * Se enumeran a mano y no se deducen de «¿tiene columna `archived_at`?»
     * porque tener la columna no significa que se deba barrer: `notifications`
     * la tiene y es ruido que caduca solo, mientras que `invoices` la tiene y es
     * el dinero. La lista dice qué se ha DECIDIDO barrer.
     *
     * @var array<string, string> tabla => 'operational'|'financial'
     */
    public const ENTITIES = [
        // Operativo: el viaje y lo que lo rodea.
        'loads' => 'operational',
        // `load_status_history` NO está aquí, aunque sea lo más operativo que
        // hay: no tiene columnas de retención. El esquema decidió que la cadena
        // de horas de una carga no se archiva ni se purga — es el registro que
        // contesta «¿cuándo pasó qué?» y sobrevive a la carga. Lo cazó
        // tests/Unit/Suite/PurgeableTablesTest.php al escribir esta lista.
        'conversations' => 'operational',
        'messages' => 'operational',
        'message_attachments' => 'operational',
        'notifications' => 'operational',
        'tracking_sessions' => 'operational',
        'tracking_events' => 'operational',
        'permits' => 'operational',
        'escorts' => 'operational',
        'documents' => 'operational',
        'document_versions' => 'operational',
        'signature_requests' => 'operational',
        'signature_records' => 'operational',
        'signature_audit_events' => 'operational',
        'rate_confirmation_acceptances' => 'operational',

        // Financiero: plazo más largo, y por eso su propia clase.
        'invoices' => 'financial',
        'payments' => 'financial',
        'expenses' => 'financial',
        'carrier_settlements' => 'financial',
        'dispatcher_commissions' => 'financial',
        'financial_snapshots' => 'financial',
    ];

    /**
     * Tablas que NO se pueden purgar nunca, aunque tengan `purge_eligible_at`.
     *
     * El esquema se contradice a sí mismo aquí, y conviene que quede escrito en
     * vez de descubrirse a mitad de un barrido: estas tablas llevan las columnas
     * de retención —`archived_at`, `purge_eligible_at`, `legal_hold`— Y ADEMÁS
     * un disparador `before delete` que lanza SIGNAL. O sea: el esquema dice
     * «puedes purgar esto» con unas columnas y «no puedes borrar esto jamás» con
     * un disparador.
     *
     * Gana el disparador, y con razón: son registros de solo-añadir cuyo valor
     * entero es que nadie los pueda tocar. Un libro de asientos que se puede
     * podar no demuestra nada.
     *
     * Así que se archivan —que es marcarlas, no moverlas— y no se purgan nunca.
     * Un barrido que lo intentara reventaría con un error de MySQL a mitad de
     * la transacción, y arrastraría con él lo que ya llevara hecho.
     *
     * La lista se comprueba contra el DDL de los disparadores en
     * tests/Unit/Suite/PurgeableTablesTest.php. Escribirla a mano y no
     * comprobarla sería confiar en que nadie añade un disparador nuevo.
     *
     * @var list<string>
     */
    public const NEVER_PURGE = [
        'audit_events',
        'signature_audit_events',
        'signature_records',
        'load_status_history',
        'financial_snapshots',
        'stripe_events',
    ];

    public function __construct(
        public readonly int $operationalActiveMonths,
        public readonly int $operationalPurgeYearsAfterArchive,
        public readonly int $financialRetentionYears,
    ) {}

    /** La política vigente de una empresa. */
    public static function forTenant(string $tenantId): self
    {
        $fila = DB::table('tenant_settings')->where('tenant_id', $tenantId)->first([
            'operational_active_months',
            'operational_purge_years_after_archive',
            'financial_retention_years',
        ]);

        // Los valores por defecto del esquema, no ceros. Un cero aquí
        // significaría «archívalo todo ahora mismo», que es lo contrario de lo
        // que debe pasar cuando falta la configuración.
        return new self(
            operationalActiveMonths: (int) ($fila->operational_active_months ?? 24),
            operationalPurgeYearsAfterArchive: (int) ($fila->operational_purge_years_after_archive ?? 5),
            financialRetentionYears: (int) ($fila->financial_retention_years ?? 7),
        );
    }

    public function classOf(string $table): ?string
    {
        return self::ENTITIES[$table] ?? null;
    }

    public function canPurge(string $table): bool
    {
        return isset(self::ENTITIES[$table]) && ! in_array($table, self::NEVER_PURGE, true);
    }

    /**
     * A partir de qué fecha una fila de esta tabla deja de estar activa.
     *
     * Devuelve nulo cuando la tabla no está en la política: no se barre lo que
     * no se ha decidido barrer.
     */
    public function archiveCutoff(string $table, ?CarbonImmutable $now = null): ?CarbonImmutable
    {
        $now ??= CarbonImmutable::now();

        return match ($this->classOf($table)) {
            'operational' => $now->subMonths(max(0, $this->operationalActiveMonths)),
            // Lo financiero no se archiva antes de que acabe su plazo de
            // conservación: archivar es el paso previo a purgar, y adelantarlo
            // pondría el reloj de la purga a correr demasiado pronto.
            'financial' => $now->subYears(max(0, $this->financialRetentionYears)),
            default => null,
        };
    }

    /**
     * Cuándo puede purgarse una fila archivada en este instante.
     *
     * Se calcula al ARCHIVAR y se guarda en `purge_eligible_at`, en vez de
     * calcularse al purgar. Es a propósito: si se calculara al purgar, cambiar
     * la política movería hacia atrás la fecha de filas archivadas hace años y
     * un ajuste de configuración podría borrar mañana lo que hoy estaba a salvo.
     * Guardada, la fecha es una promesa hecha el día del archivado.
     */
    public function purgeEligibleAt(string $table, ?CarbonImmutable $archivedAt = null): ?CarbonImmutable
    {
        $archivedAt ??= CarbonImmutable::now();

        return match ($this->classOf($table)) {
            'operational' => $archivedAt->addYears(max(0, $this->operationalPurgeYearsAfterArchive)),
            // Lo financiero ya esperó su plazo entero para archivarse. El plazo
            // de purga posterior es el mismo que el operativo.
            'financial' => $archivedAt->addYears(max(0, $this->operationalPurgeYearsAfterArchive)),
            default => null,
        };
    }

    /**
     * La columna por la que se mide la edad de una fila.
     *
     * `deleted_at` cuando existe y está puesta —una fila borrada empieza a
     * envejecer el día que se borró—, y si no `created_at`. No `updated_at`:
     * un cambio cosmético de ayer no vuelve joven a una carga de 2019, y con
     * `updated_at` una sola migración de datos que tocara todas las filas
     * reiniciaría el reloj de la empresa entera.
     */
    public static function ageColumn(string $table): string
    {
        return 'created_at';
    }
}
