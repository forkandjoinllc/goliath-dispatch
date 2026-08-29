<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\AuditAction;
use App\Support\Audit;
use App\Support\InertiaPage;
use App\Support\Reports\PeriodReport;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Los informes del periodo.
 *
 * Lo que enseñan sale de lo FACTURADO y de las instantáneas congeladas, nunca de
 * un recálculo — ver PeriodReport, que explica por qué. Aquí solo se resuelve el
 * periodo, se comprueba el permiso y se pinta.
 *
 * La exportación tiene permiso propio (`report:export`) porque sacar los números
 * de la empresa a un fichero que se manda por correo no es lo mismo que mirarlos
 * en pantalla, y deja rastro en la auditoría por el mismo motivo.
 */
final class ReportController
{
    use InertiaPage;

    /** @var list<string> */
    private const EXPORTABLES = ['carriers', 'customers', 'commissions'];

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'report:read', null, $policy);

        // `expenses` por los tratamientos de gasto; los estados de carga
        // salen de `nav.status.load`, que ya viene en el armazón. No se
        // duplican aquí para que una carga no se llame distinto según la
        // pantalla desde la que se mire.
        $this->usesDictionary($request, ['reports', 'expenses', 'nav', 'common']);

        [$desde, $hasta] = $this->period($request);
        $informe = new PeriodReport($actor, $scope, $desde, $hasta);

        $porTransportista = $informe->byCarrier();

        return Inertia::render('App/Reports/Index', [
            'period' => ['from' => $desde->toDateString(), 'to' => $hasta->toDateString()],
            'summary' => $this->summary($porTransportista, $informe),
            'byCarrier' => $porTransportista,
            'byCustomer' => $informe->byCustomer(),
            'aging' => $informe->aging(),
            'expensesByTreatment' => $informe->expensesByTreatment(),
            'commissionsByDispatcher' => $informe->commissionsByDispatcher(),
            'loadsByStatus' => $informe->loadsByStatus(),
            'exportables' => self::EXPORTABLES,
            'can' => [
                'export' => $checker->can($actor, 'report:export', null, $policy)->allowed,
            ],
        ]);
    }

    /**
     * Un CSV de una de las tablas, con el mismo periodo y el mismo
     * estrechamiento que la pantalla.
     */
    public function export(Request $request, CurrentActor $current, PermissionChecker $checker): StreamedResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'report:read', null, $policy);
        $checker->authorize($actor, 'report:export', null, $policy);

        $data = $request->validate([
            'table' => ['required', 'string', Rule::in(self::EXPORTABLES)],
        ]);

        [$desde, $hasta] = $this->period($request);
        $informe = new PeriodReport($actor, $scope, $desde, $hasta);

        [$cabeceras, $filas] = match ($data['table']) {
            'carriers' => [
                ['carrier', 'loads', 'gross', 'dispatch_fee', 'net_to_carrier', 'gross_margin'],
                array_map(static fn (array $r): array => [
                    $r['name'], $r['loads'],
                    self::money($r['grossCents']), self::money($r['feeCents']),
                    self::money($r['netCents']), self::money($r['marginCents']),
                ], $informe->byCarrier()),
            ],
            'customers' => [
                ['customer', 'loads', 'customer_charge', 'dispatch_fee', 'gross_margin'],
                array_map(static fn (array $r): array => [
                    $r['name'] ?? '', $r['loads'],
                    self::money($r['chargeCents']), self::money($r['feeCents']),
                    self::money($r['marginCents']),
                ], $informe->byCustomer()),
            ],
            default => [
                ['dispatcher', 'accrued', 'paid', 'owed'],
                array_map(static fn (array $r): array => [
                    $r['name'],
                    self::money($r['totalCents']), self::money($r['paidCents']), self::money($r['owedCents']),
                ], $informe->commissionsByDispatcher()),
            ],
        };

        Audit::record(
            $actor,
            AuditAction::ExportCreated,
            entityType: 'report',
            entityId: (string) $data['table'],
            entityLabel: "{$data['table']} {$desde->toDateString()}..{$hasta->toDateString()}",
            after: ['rows' => count($filas)],
        );

        $nombre = "{$data['table']}-{$desde->toDateString()}-{$hasta->toDateString()}.csv";

        return response()->streamDownload(function () use ($cabeceras, $filas): void {
            $salida = fopen('php://output', 'wb');

            // BOM de UTF-8: sin él, Excel en Windows abre «Transportista Ñ» como
            // mojibake y el usuario cree que el dato está mal guardado.
            fwrite($salida, "\xEF\xBB\xBF");
            fputcsv($salida, $cabeceras);

            foreach ($filas as $fila) {
                fputcsv($salida, $fila);
            }

            fclose($salida);
        }, $nombre, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    // ------------------------------------------------------------------ ayudas

    /**
     * El periodo pedido, o el mes en curso.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     */
    private function period(Request $request): array
    {
        $hoy = CarbonImmutable::now();

        $desde = $this->fecha($request->query('from')) ?? $hoy->startOfMonth();
        $hasta = $this->fecha($request->query('to')) ?? $hoy;

        // Al revés se devuelve del derecho en vez de un informe vacío que parece
        // que no hay datos.
        if ($desde->isAfter($hasta)) {
            [$desde, $hasta] = [$hasta, $desde];
        }

        return [$desde->startOfDay(), $hasta->endOfDay()];
    }

    private function fecha(mixed $valor): ?CarbonImmutable
    {
        $texto = trim((string) ($valor ?? ''));

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $texto) !== 1) {
            return null;
        }

        return CarbonImmutable::parse($texto);
    }

    /**
     * @param  list<array<string, mixed>>  $porTransportista
     * @return array<string, int>
     */
    private function summary(array $porTransportista, PeriodReport $informe): array
    {
        $aging = $informe->aging();

        return [
            'feeCents' => (int) array_sum(array_column($porTransportista, 'feeCents')),
            'marginCents' => (int) array_sum(array_column($porTransportista, 'marginCents')),
            'loads' => (int) array_sum(array_column($porTransportista, 'loads')),
            'outstandingCents' => (int) array_sum(array_column($aging, 'amountCents')),
        ];
    }

    /** Céntimos a decimal, para que una hoja de cálculo lo sume sin pelearse. */
    private static function money(int $cents): string
    {
        return number_format($cents / 100, 2, '.', '');
    }
}
