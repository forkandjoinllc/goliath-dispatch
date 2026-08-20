<?php

declare(strict_types=1);

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Los planes SaaS que se ofrecen en el alta pública.
 *
 * Va en el seeder base y no en el de demostración porque sin planes el
 * formulario de alta no tiene nada que enseñar: en producción hacen falta igual.
 *
 * Los precios están en CÉNTIMOS enteros. `stripe_price_id` queda en NULL a
 * propósito: los identificadores de precio de Stripe son distintos en la cuenta
 * de pruebas y en la real, y meter aquí uno de pruebas sería sembrar producción
 * con datos que apuntan a otro sitio. Los rellena quien conecte Stripe.
 */
class SaasPlanSeeder extends Seeder
{
    public function run(): void
    {
        $now = now()->format('Y-m-d H:i:s.v');

        $plans = [
            [
                'code' => 'starter',
                'name_en' => 'Starter',
                'name_es' => 'Inicial',
                'description_en' => 'For a dispatch office getting its first carriers onto one system.',
                'description_es' => 'Para una oficina de despacho que pone sus primeros transportistas en un solo sistema.',
                'monthly_price_cents' => 19900,
                'trial_days' => 14,
                'max_users' => 5,
                'max_carriers' => 15,
                'max_loads_per_month' => 150,
                'features' => [
                    'carrier_onboarding', 'fmcsa_verification', 'document_management',
                    'load_dispatch', 'invoicing', 'bilingual',
                ],
                'sort_order' => 10,
            ],
            [
                'code' => 'growth',
                'name_en' => 'Growth',
                'name_es' => 'Crecimiento',
                'description_en' => 'Adds tracking, settlements and heavy-haul permit guidance.',
                'description_es' => 'Añade seguimiento, liquidaciones y guía de permisos para carga pesada.',
                'monthly_price_cents' => 49900,
                'trial_days' => 14,
                'max_users' => 20,
                'max_carriers' => 75,
                'max_loads_per_month' => 750,
                'features' => [
                    'carrier_onboarding', 'fmcsa_verification', 'document_management',
                    'load_dispatch', 'invoicing', 'bilingual',
                    'tracking', 'settlements', 'oversize_evaluation', 'permits_escorts',
                    'electronic_signatures',
                ],
                'sort_order' => 20,
            ],
            [
                'code' => 'fleet',
                'name_en' => 'Fleet',
                'name_es' => 'Flota',
                'description_en' => 'Unlimited carriers and loads, with retention and audit reporting.',
                'description_es' => 'Transportistas y cargas sin límite, con informes de retención y auditoría.',
                'monthly_price_cents' => 129900,
                'trial_days' => 14,
                // NULL significa sin límite, no cero.
                'max_users' => null,
                'max_carriers' => null,
                'max_loads_per_month' => null,
                'features' => [
                    'carrier_onboarding', 'fmcsa_verification', 'document_management',
                    'load_dispatch', 'invoicing', 'bilingual',
                    'tracking', 'settlements', 'oversize_evaluation', 'permits_escorts',
                    'electronic_signatures', 'audit_reporting', 'retention_policies',
                    'legal_holds', 'priority_support',
                ],
                'sort_order' => 30,
            ],
        ];

        $rows = array_map(fn (array $plan): array => [
            'id' => (string) Str::uuid(),
            ...$plan,
            'features' => json_encode($plan['features'], JSON_THROW_ON_ERROR),
            'is_public' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ], $plans);

        // Reejecutable: actualiza precios y textos sin regenerar los ids, que es
        // lo que referencian las suscripciones ya existentes.
        DB::table('saas_plans')->upsert(
            $rows,
            ['code'],
            ['name_en', 'name_es', 'description_en', 'description_es', 'monthly_price_cents',
                'trial_days', 'max_users', 'max_carriers', 'max_loads_per_month',
                'features', 'is_public', 'sort_order', 'updated_at'],
        );

        $this->command->info(sprintf('Planes SaaS: %d.', count($rows)));
    }
}
