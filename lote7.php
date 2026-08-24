<?php
@mkdir('app/Support/Database', 0755, true);
file_put_contents('app/Support/Database/MillisecondGrammar.php', <<<'PHP'
<?php

declare(strict_types=1);

namespace App\Support\Database;

use Illuminate\Database\Query\Grammars\MySqlGrammar;

/**
 * La gramática de consultas, pero escribiendo los milisegundos.
 *
 * Las columnas de fecha del esquema son `datetime(3)`, y los modelos declaran
 * `$dateFormat = 'Y-m-d H:i:s.v'` para conservarlos. Pero los INSERT en crudo
 * —`DB::table(...)->insert(['created_at' => now()])`— no pasan por el modelo:
 * ahí convierte esta gramática, y la de Laravel devuelve 'Y-m-d H:i:s'. Los
 * milisegundos se perdían y la columna guardaba `.000`.
 *
 * No es un detalle de precisión. Las tablas que lo sufren son las de
 * solo-añadir —`load_status_history`, `carrier_onboarding_events`,
 * `audit_events`, `financial_snapshots`—, que existen para responder «¿cuándo?»
 * y «¿en qué orden?». Dos filas del mismo segundo quedaban con la misma marca y
 * `order by created_at` devolvía lo que quisiera el motor. Una carga que pasa
 * de despachada a en ruta dentro del mismo segundo —cosa corriente— dejaba una
 * cadena de horas que ya no era una cadena.
 *
 * Se descubrió porque una prueba del historial de altas fallaba de forma
 * intermitente: las dos filas salían en orden inverso una de cada dos veces.
 *
 * Sobre una columna sin fracción (`failed_jobs.failed_at`, que es `timestamp`)
 * MySQL redondea al segundo, que es lo que hacía antes.
 */
final class MillisecondGrammar extends MySqlGrammar
{
    public function getDateFormat(): string
    {
        return 'Y-m-d H:i:s.v';
    }
}

PHP);
echo "1 gramática: escrita\n";

$p = 'app/Providers/AppServiceProvider.php';
$s = file_get_contents($p);
if (str_contains($s, 'preserveMilliseconds')) { echo "2 proveedor: ya estaba\n"; }
else {
  $u = "use App\\Support\\TenantContext;";
  $b = "        Model::preventSilentlyDiscardingAttributes(! \$this->app->isProduction());\n";
  if (! str_contains($s,$u) || ! str_contains($s,$b) || ! preg_match('/\n\}\s*$/',$s)) { echo "2 proveedor: NO ENCAJA\n"; }
  else {
    $s = str_replace($u, "use App\\Support\\Database\\MillisecondGrammar;\n".$u, $s);
    $s = str_replace($b, $b."\n        \$this->preserveMilliseconds();\n", $s);
    $m = <<<'M'

    /**
     * Que los INSERT en crudo escriban los milisegundos.
     *
     * Los modelos ya lo hacían por su `$dateFormat`; los `DB::table(...)` no,
     * porque ahí convierte la gramática de consultas y la de Laravel corta en
     * el segundo. Ver App\Support\Database\MillisecondGrammar.
     *
     * Aquí y no en cada sitio de escritura a propósito: hay treinta y nueve, y
     * el siguiente que alguien escriba también tiene que salir bien sin
     * acordarse de nada.
     */
    private function preserveMilliseconds(): void
    {
        $connection = $this->app['db']->connection();

        // Solo MySQL: la gramática hereda de la suya. Si algún día hay una
        // conexión de otro motor, esto la deja en paz en vez de romperla.
        if ($connection->getDriverName() !== 'mysql') {
            return;
        }

        $connection->setQueryGrammar(new MillisecondGrammar($connection));
    }
}

M;
    file_put_contents($p, preg_replace('/\n\}\s*$/', "\n".$m, $s, 1));
    echo "2 proveedor: ok\n";
  }
}

$p = 'tests/Feature/Carriers/OnboardingTransitionTest.php';
$s = file_get_contents($p);
$re = '/\n(?:[ \t]*\/\/[^\n]*\n)+[ \t]*\$pasos = collect\(\$events\).*?->toContain\(\'submitted→under_review\'\);/su';
$n = "\n    // Con los milisegundos ya escritos, la cadena vuelve a tener orden y esta\n"
   . "    // prueba vuelve a exigirlo. Ver App\\Support\\Database\\MillisecondGrammar.\n"
   . "    expect(\$events)->toHaveCount(2)\n"
   . "        ->and(\$events[0]->from_status)->toBe('draft')\n"
   . "        ->and(\$events[0]->to_status)->toBe('submitted')\n"
   . "        ->and(\$events[1]->to_status)->toBe('under_review');";
if (str_contains($s,'vuelve a tener orden')) echo "3 altas: ya estaba\n";
elseif (preg_match($re,$s)) { file_put_contents($p, preg_replace($re,$n,$s,1)); echo "3 altas: orden restaurado\n"; }
else echo "3 altas: NO ENCAJA\n";

$p = 'tests/Feature/Loads/LoadTransitionTest.php';
$s = file_get_contents($p);
$re = '/\n(?:[ \t]*\/\/[^\n]*\n)+[ \t]*\$pasos = collect\(\$rows\).*?->toBe\(\[\'user\'\]\);/su';
$n = "\n    // Con los milisegundos ya escritos, la cadena vuelve a tener orden y esta\n"
   . "    // prueba vuelve a exigirlo. Ver App\\Support\\Database\\MillisecondGrammar.\n"
   . "    expect(\$rows)->toHaveCount(2)\n"
   . "        ->and(\$rows[0]->from_status)->toBe('draft')\n"
   . "        ->and(\$rows[0]->to_status)->toBe('available')\n"
   . "        // `source` distingue a una persona del seguimiento por GPS. Importa\n"
   . "        // cuando alguien pregunta por qué la carga se marcó entregada a las 3\n"
   . "        // de la mañana.\n"
   . "        ->and(\$rows[0]->source)->toBe('user');";
if (str_contains($s,'vuelve a tener orden')) echo "4 cargas: ya estaba\n";
elseif (preg_match($re,$s)) { file_put_contents($p, preg_replace($re,$n,$s,1)); echo "4 cargas: orden restaurado\n"; }
else echo "4 cargas: NO ENCAJA\n";

@mkdir('tests/Feature/Database', 0755, true);
file_put_contents('tests/Feature/Database/MillisecondsTest.php', <<<'PHP'
<?php

declare(strict_types=1);

use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(function () {
    Carbon::setTestNow();
    app(TenantContext::class)->forget();
});

it('la gramática de consultas escribe la fracción de segundo', function () {
    // Los modelos ya la conservaban por su $dateFormat. Esto fija lo otro: que
    // los INSERT en crudo, que no pasan por el modelo, tampoco la pierdan.
    expect(DB::connection()->getQueryGrammar()->getDateFormat())->toBe('Y-m-d H:i:s.v');
});

it('un insert en crudo conserva los milisegundos', function () {
    $instante = Carbon::create(2026, 3, 4, 10, 30, 15)->addMilliseconds(456);
    Carbon::setTestNow($instante);

    $id = (string) Str::uuid();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($id) {
        DB::table('audit_events')->insert([
            'id' => $id,
            'tenant_id' => $this->scenario->tenant->id,
            'action' => 'load.created',
            'entity_type' => 'load',
            'entity_id' => (string) $this->scenario->load->id,
            'occurred_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    Carbon::setTestNow();

    $guardado = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('audit_events')->where('id', $id)->value('occurred_at')
    );

    // Sin la gramática propia esto guardaba '2026-03-04 10:30:15.000', y dos
    // eventos del mismo segundo quedaban sin orden recuperable.
    expect((string) $guardado)->toBe('2026-03-04 10:30:15.456');
});
PHP);
echo "5 prueba: escrita\n";
