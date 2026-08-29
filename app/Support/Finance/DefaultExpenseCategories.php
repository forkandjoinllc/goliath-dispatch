<?php

declare(strict_types=1);

namespace App\Support\Finance;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Las categorías de gasto con las que arranca una empresa nueva.
 *
 * Existe porque sin categorías NADIE puede dar de alta un gasto —
 * `expenses.category_id` es NOT NULL— y hasta ahora solo las creaba el sembrador
 * de demostración. Una empresa dada de alta por el formulario público se
 * quedaba sin ninguna y con la pantalla de gastos inservible.
 *
 * EL TRATAMIENTO ES LO QUE IMPORTA, no la etiqueta. Cada categoría dice qué le
 * hace ese gasto al dinero de la carga, y las cuatro respuestas posibles no son
 * intercambiables:
 *
 *   • `excluded_from_commission` — el dinero pasó por nuestras manos pero no es
 *     nuestro. Un permiso de sobredimensión que se paga al estado y se refactura
 *     al cliente no debe engordar la comisión de nadie.
 *   • `reimbursable_to_carrier` — lo adelantó el transportista y se le devuelve.
 *   • `tenant_absorbed` — lo paga la casa de despacho y no se repercute.
 *   • `carrier_deduction` — se le descuenta al transportista de su liquidación.
 *
 * Se marcan `is_system` para que se distingan de las que cree cada empresa. El
 * tratamiento se COPIA a cada gasto al darlo de alta
 * (`expenses.treatment_snapshot`): cambiar una categoría mañana no puede
 * reescribir una liquidación cerrada.
 */
final class DefaultExpenseCategories
{
    /** @var list<array{0: string, 1: string, 2: string, 3: string, 4: int, 5: bool}> */
    public const CATALOG = [
        // código, etiqueta EN, etiqueta ES, tratamiento, orden, exige recibo
        ['fuel', 'Fuel', 'Combustible', 'reimbursable_to_carrier', 10, true],
        ['tolls', 'Tolls', 'Peajes', 'reimbursable_to_carrier', 20, true],
        ['lumper', 'Lumper', 'Descarga (lumper)', 'reimbursable_to_carrier', 30, true],
        ['detention', 'Detention', 'Detención', 'excluded_from_commission', 40, false],
        ['permit', 'Permit', 'Permiso', 'excluded_from_commission', 50, true],
        ['escort', 'Escort', 'Escolta', 'excluded_from_commission', 60, true],
        ['advance', 'Cash advance', 'Adelanto en efectivo', 'carrier_deduction', 65, true],
        ['repair', 'Repair', 'Reparación', 'carrier_deduction', 70, true],
        ['other', 'Other', 'Otro', 'tenant_absorbed', 80, false],
    ];

    /**
     * Crea las que falten. No toca las que ya estén: una empresa que haya
     * cambiado el tratamiento de «combustible» a propósito no debe encontrárselo
     * revertido por un despliegue.
     *
     * @return int  cuántas se crearon
     */
    public static function ensureFor(string $tenantId): int
    {
        $existentes = DB::table('expense_categories')
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at')
            ->pluck('code')
            ->all();

        $ahora = now();
        $nuevas = [];

        foreach (self::CATALOG as [$code, $en, $es, $treatment, $sort, $receipt]) {
            if (in_array($code, $existentes, true)) {
                continue;
            }

            $nuevas[] = [
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'code' => $code,
                'label_en' => $en,
                'label_es' => $es,
                'treatment' => $treatment,
                'is_system' => true,
                'requires_receipt' => $receipt,
                'active' => true,
                'sort_order' => $sort,
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ];
        }

        if ($nuevas !== []) {
            DB::table('expense_categories')->insert($nuevas);
        }

        return count($nuevas);
    }
}
