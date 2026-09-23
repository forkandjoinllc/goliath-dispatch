<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Camiones, remolques y conductores para una prueba.
 *
 * Una CLASE y no funciones globales de Pest. Las globales solo existen cuando
 * el fichero que las declara entra en la misma ejecución: escritas en un
 * fichero y llamadas desde otro, la suite entera pasa y el fichero suelto
 * falla con «función no definida» — que es lo que pasó al escribir esto. Y
 * cuando sí existen, dos ficheros que elijan el mismo nombre chocan. Ver
 * `docs/testing.md`.
 */
final class FleetFixtures
{
    public static function camion(Scenario $s, string $unidad, string $estado = 'active'): string
    {
        return self::unidad('trucks', $s, $unidad, $estado);
    }

    public static function remolque(Scenario $s, string $unidad): string
    {
        return self::unidad('trailers', $s, $unidad, 'active');
    }

    private static function unidad(string $tabla, Scenario $s, string $unidad, string $estado): string
    {
        $id = (string) Str::uuid();

        DB::table($tabla)->insert([
            'id' => $id,
            'tenant_id' => $s->tenant->id,
            'carrier_id' => $s->assignedCarrier->id,
            'unit_number' => $unidad,
            'vin' => Str::upper(Str::random(17)),
            'vin_normalized' => Str::upper(Str::random(17)),
            'status' => $estado,
            // Con el seguro comprobado: `Eligibility` bloquea una unidad sin
            // él, y una unidad que no puede trabajar no sirve para probar nada
            // más que la propia puerta.
            'coi_verification_status' => 'verified',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Las cuatro fotos. La puerta de asignación las exige, y el sitio
        // público lo promete.
        foreach (['front', 'rear', 'left', 'right'] as $orden => $angulo) {
            DB::table('equipment_media')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $s->tenant->id,
                'equipment_type' => $tabla === 'trucks' ? 'truck' : 'trailer',
                'equipment_id' => $id,
                'angle' => $angulo,
                'media_kind' => 'photo',
                'storage_key' => 'pruebas/'.$id.'-'.$angulo.'.jpg',
                'content_type' => 'image/jpeg',
                'byte_size' => 1024,
                'sha256' => hash('sha256', $id.$angulo),
                'sort_order' => $orden,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        return $id;
    }

    public static function conductor(Scenario $s, string $nombre, string $apellido): string
    {
        $id = (string) Str::uuid();

        DB::table('drivers')->insert([
            'id' => $id,
            'tenant_id' => $s->tenant->id,
            'first_name' => $nombre,
            'last_name' => $apellido,
            'phone' => '+1 555 0100',
            'license_state' => 'TX',
            'license_number_hash' => hash('sha256', Str::random(12)),
            'license_number_last4' => '9999',
            'cdl_class' => 'A',
            'license_expires_at' => now()->addYear(),
            'medical_card_expires_at' => now()->addYear(),
            'status' => 'available',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('driver_carrier_relationships')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $s->tenant->id,
            'driver_id' => $id,
            'carrier_id' => $s->assignedCarrier->id,
            'start_date' => now()->subYear()->toDateString(),
            'is_primary' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }

    /** Pone un recurso en una carga, saltándose el controlador a propósito. */
    public static function enLaCarga(Scenario $s, string $loadId, string $tipo, string $recursoId): void
    {
        DB::table('load_assignments')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $s->tenant->id,
            'load_id' => $loadId,
            'resource_type' => $tipo,
            $tipo.'_id' => $recursoId,
            'is_primary' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** El recurso vivo de ese tipo en una carga. */
    public static function puestoEn(string $loadId, string $tipo): ?string
    {
        $id = DB::table('load_assignments')
            ->where('load_id', $loadId)
            ->where('resource_type', $tipo)
            ->whereNull('unassigned_at')
            ->whereNull('deleted_at')
            ->value($tipo.'_id');

        return $id === null ? null : (string) $id;
    }
}
