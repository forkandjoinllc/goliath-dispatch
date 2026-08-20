<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\Customers\NameKey;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Recalcula `customers.company_name_normalized` para todas las empresas.
 *
 * Existe porque esa columna es una CACHÉ de lo que devuelve NameKey, y una caché
 * se queda vieja. El día que alguien añada un sufijo societario a la lista —
 * pongamos «S.A.S.», que en Colombia es lo normal— todas las filas escritas
 * antes conservan su clave antigua y la detección de duplicados deja de ver
 * parecidos que sí existen. Sin ruido, sin error: simplemente deja de encontrar
 * lo que existe para encontrar.
 *
 * Ese fallo salió al probar: dos clientes se dieron de alta como distintos
 * porque sus claves guardadas venían de una normalización anterior.
 *
 * Regla, entonces: **quien toque NameKey ejecuta esto después.**
 *
 *     php artisan customers:renormalize
 *     php artisan customers:renormalize --dry-run   (solo informa)
 */
final class RenormalizeCustomerNames extends Command
{
    protected $signature = 'customers:renormalize {--dry-run : Enseña qué cambiaría sin escribir nada}';

    protected $description = 'Recalcula la clave de detección de duplicados de los clientes';

    public function handle(TenantContext $context): int
    {
        $dry = (bool) $this->option('dry-run');

        // Sin ámbito de empresa: esto es mantenimiento de la plataforma y tiene
        // que alcanzar a todas. Es de los poquísimos sitios donde saltarse el
        // scope es lo correcto, y por eso se pide a la cara.
        $changed = $context->withoutTenant(function () use ($dry): int {
            $count = 0;

            DB::table('customers')
                ->select('id', 'company_name', 'company_name_normalized')
                ->orderBy('id')
                // Por lotes: una empresa con cien mil clientes no cabe en memoria,
                // y este comando tiene que poder correr en el despliegue.
                ->chunkById(500, function ($rows) use (&$count, $dry): void {
                    foreach ($rows as $row) {
                        $key = NameKey::for((string) $row->company_name);

                        if ($key === $row->company_name_normalized) {
                            continue;
                        }

                        $count++;
                        $this->line(sprintf(
                            '  %-40s %s -> %s',
                            mb_strimwidth((string) $row->company_name, 0, 38, '…'),
                            $row->company_name_normalized,
                            $key,
                        ));

                        if (! $dry) {
                            DB::table('customers')
                                ->where('id', $row->id)
                                ->update(['company_name_normalized' => $key]);
                        }
                    }
                });

            return $count;
        });

        if ($changed === 0) {
            $this->info('Todas las claves ya coinciden con NameKey.');

            return self::SUCCESS;
        }

        $this->newLine();
        $this->{$dry ? 'warn' : 'info'}($dry
            ? "{$changed} clave(s) están desactualizadas. Ejecute sin --dry-run para corregirlas."
            : "{$changed} clave(s) recalculadas.");

        return self::SUCCESS;
    }
}
