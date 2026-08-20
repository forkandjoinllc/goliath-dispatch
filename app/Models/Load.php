<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\CommissionBasis;
use App\Enums\LoadStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class Load extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'loads';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'load_number',
        'customer_reference',
        'po_number',
        'customer_id',
        'customer_contact_id',
        'carrier_id',
        'carrier_locked_at',
        'dispatcher_user_id',
        'status',
        'commodity',
        'weight_pounds',
        'length_inches',
        'width_inches',
        'height_inches',
        'piece_count',
        'required_equipment_type_id',
        'is_oversize',
        'is_overweight',
        'axle_configuration',
        'gross_vehicle_weight_pounds',
        'customer_charge_cents',
        'carrier_gross_rate_cents',
        'carrier_dispatch_fee_bps',
        'dispatcher_commission_bps',
        'dispatcher_commission_basis',
        'miles',
        'deadhead_miles',
        'special_instructions',
        'internal_notes',
        'planned_pickup_at',
        'planned_delivery_at',
        'actual_pickup_at',
        'actual_delivery_at',
        'pod_received_at',
        'permit_ready_approved_by_user_id',
        'permit_ready_approved_at',
        'oversize_validated_by_user_id',
        'oversize_validated_at',
        'cancelled_at',
        'cancellation_reason',
        'duplicated_from_load_id',
        'deleted_by',
        'deletion_reason',
        'archived_at',
        'purge_eligible_at',
        'legal_hold',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'carrier_locked_at' => 'immutable_datetime',
            'status' => LoadStatus::class,
            'weight_pounds' => 'integer',
            'length_inches' => 'integer',
            'width_inches' => 'integer',
            'height_inches' => 'integer',
            'piece_count' => 'integer',
            'is_oversize' => 'boolean',
            'is_overweight' => 'boolean',
            'gross_vehicle_weight_pounds' => 'integer',
            'customer_charge_cents' => 'integer',
            'carrier_gross_rate_cents' => 'integer',
            'carrier_dispatch_fee_bps' => 'integer',
            'dispatcher_commission_bps' => 'integer',
            'dispatcher_commission_basis' => CommissionBasis::class,
            'miles' => 'integer',
            'deadhead_miles' => 'integer',
            'planned_pickup_at' => 'immutable_datetime',
            'planned_delivery_at' => 'immutable_datetime',
            'actual_pickup_at' => 'immutable_datetime',
            'actual_delivery_at' => 'immutable_datetime',
            'pod_received_at' => 'immutable_datetime',
            'permit_ready_approved_at' => 'immutable_datetime',
            'oversize_validated_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<Carrier, $this> */
    public function carrier(): BelongsTo
    {
        return $this->belongsTo(Carrier::class, 'carrier_id');
    }

    /** @return BelongsTo<CustomerContact, $this> */
    public function customerContact(): BelongsTo
    {
        return $this->belongsTo(CustomerContact::class, 'customer_contact_id');
    }

    /** @return BelongsTo<Customer, $this> */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class, 'customer_id');
    }

    /** @return BelongsTo<User, $this> */
    public function dispatcherUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'dispatcher_user_id');
    }

    /** @return BelongsTo<User, $this> */
    public function oversizeValidatedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'oversize_validated_by_user_id');
    }

    /** @return BelongsTo<User, $this> */
    public function permitReadyApprovedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'permit_ready_approved_by_user_id');
    }

    /** @return BelongsTo<EquipmentType, $this> */
    public function requiredEquipmentType(): BelongsTo
    {
        return $this->belongsTo(EquipmentType::class, 'required_equipment_type_id');
    }

    /** @return HasMany<CarrierSettlementLine, $this> */
    public function carrierSettlementLines(): HasMany
    {
        return $this->hasMany(CarrierSettlementLine::class, 'load_id');
    }

    /** @return HasMany<CheckCall, $this> */
    public function checkCalls(): HasMany
    {
        return $this->hasMany(CheckCall::class, 'load_id');
    }

    /** @return HasMany<Conversation, $this> */
    public function conversations(): HasMany
    {
        return $this->hasMany(Conversation::class, 'load_id');
    }

    /** @return HasMany<DispatcherCommission, $this> */
    public function dispatcherCommissions(): HasMany
    {
        return $this->hasMany(DispatcherCommission::class, 'load_id');
    }

    /** @return HasMany<Escort, $this> */
    public function escorts(): HasMany
    {
        return $this->hasMany(Escort::class, 'load_id');
    }

    /** @return HasMany<Expense, $this> */
    public function expenses(): HasMany
    {
        return $this->hasMany(Expense::class, 'load_id');
    }

    /** @return HasMany<FinancialSnapshot, $this> */
    public function financialSnapshots(): HasMany
    {
        return $this->hasMany(FinancialSnapshot::class, 'load_id');
    }

    /** @return HasMany<InvoiceLineItem, $this> */
    public function invoiceLineItems(): HasMany
    {
        return $this->hasMany(InvoiceLineItem::class, 'load_id');
    }

    /** @return HasMany<Invoice, $this> */
    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class, 'load_id');
    }

    /** @return HasMany<LoadAssignment, $this> */
    public function loadAssignments(): HasMany
    {
        return $this->hasMany(LoadAssignment::class, 'load_id');
    }

    /** @return HasMany<LoadDocument, $this> */
    public function loadDocuments(): HasMany
    {
        return $this->hasMany(LoadDocument::class, 'load_id');
    }

    /** @return HasMany<LoadStatusHistory, $this> */
    public function loadStatusHistories(): HasMany
    {
        return $this->hasMany(LoadStatusHistory::class, 'load_id');
    }

    /** @return HasMany<LoadStop, $this> */
    public function loadStops(): HasMany
    {
        return $this->hasMany(LoadStop::class, 'load_id');
    }

    /** @return HasMany<OversizeEvaluation, $this> */
    public function oversizeEvaluations(): HasMany
    {
        return $this->hasMany(OversizeEvaluation::class, 'load_id');
    }

    /** @return HasMany<Permit, $this> */
    public function permits(): HasMany
    {
        return $this->hasMany(Permit::class, 'load_id');
    }

    /** @return HasMany<PublicTrackingLink, $this> */
    public function publicTrackingLinks(): HasMany
    {
        return $this->hasMany(PublicTrackingLink::class, 'load_id');
    }

    /** @return HasMany<RateConfirmationAcceptance, $this> */
    public function rateConfirmationAcceptances(): HasMany
    {
        return $this->hasMany(RateConfirmationAcceptance::class, 'load_id');
    }

    /** @return HasMany<Route, $this> */
    public function routes(): HasMany
    {
        return $this->hasMany(Route::class, 'load_id');
    }

    /** @return HasMany<TrackingEvent, $this> */
    public function trackingEvents(): HasMany
    {
        return $this->hasMany(TrackingEvent::class, 'load_id');
    }

    /** @return HasMany<TrackingSession, $this> */
    public function trackingSessions(): HasMany
    {
        return $this->hasMany(TrackingSession::class, 'load_id');
    }
}
