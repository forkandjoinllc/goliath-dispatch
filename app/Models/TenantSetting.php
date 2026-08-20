<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\CommissionBasis;
use App\Models\Concerns\BelongsToTenant;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class TenantSetting extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'tenant_settings';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'contact_phone',
        'contact_email',
        'support_email',
        'address_line1',
        'address_line2',
        'address_city',
        'address_state',
        'address_postal_code',
        'address_country',
        'business_hours',
        'social_links',
        'document_expiration_warning_days',
        'fmcsa_reverification_days',
        'allow_dispatcher_resource_assignment',
        'require_oversize_admin_validation',
        'load_number_prefix',
        'load_number_next_sequence',
        'invoice_number_prefix',
        'invoice_number_next_sequence',
        'default_payment_terms_days',
        'default_carrier_dispatch_fee_bps',
        'default_dispatcher_commission_bps',
        'dispatcher_commission_basis',
        'operational_active_months',
        'operational_purge_years_after_archive',
        'financial_retention_years',
        'public_tracking_enabled',
        'public_tracking_token_ttl_hours',
        'signature_consent_copy',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'business_hours' => 'array',
            'social_links' => 'array',
            'document_expiration_warning_days' => 'integer',
            'fmcsa_reverification_days' => 'integer',
            'allow_dispatcher_resource_assignment' => 'boolean',
            'require_oversize_admin_validation' => 'boolean',
            'load_number_next_sequence' => 'integer',
            'invoice_number_next_sequence' => 'integer',
            'default_payment_terms_days' => 'integer',
            'default_carrier_dispatch_fee_bps' => 'integer',
            'default_dispatcher_commission_bps' => 'integer',
            'dispatcher_commission_basis' => CommissionBasis::class,
            'operational_active_months' => 'integer',
            'operational_purge_years_after_archive' => 'integer',
            'financial_retention_years' => 'integer',
            'public_tracking_enabled' => 'boolean',
            'public_tracking_token_ttl_hours' => 'integer',
            'signature_consent_copy' => 'array',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
