<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class TenantBranding extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'tenant_branding';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'logo_storage_key',
        'logo_dark_storage_key',
        'favicon_storage_key',
        'primary_color',
        'accent_color',
        'neutral_color',
        'surface_color',
        'ink_color',
        'heading_font',
        'body_font',
        'email_header_html',
        'email_footer_html',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
