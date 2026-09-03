<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Services\Malware\FileScanner;
use App\Services\Malware\ScanVerdict;
use App\Support\Documents\Scanning;
use App\Support\Platform\Providers;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Un analizador de mentira que devuelve el veredicto que se le pida. */
function analizadorQueDice(ScanVerdict $veredicto, bool $live = true): void
{
    app()->instance(FileScanner::class, new class($veredicto, $live) implements FileScanner
    {
        public function __construct(private ScanVerdict $veredicto, private bool $live) {}

        public function scan(string $ruta, string $nombre): ScanVerdict
        {
            return $this->veredicto;
        }

        public function name(): string
        {
            return 'prueba';
        }

        public function isLive(): bool
        {
            return $this->live;
        }
    });
}

function subirDocumento(Scenario $scenario): TestResponse
{
    return test()->post('/documents', [
        'file' => UploadedFile::fake()->create('seguro.pdf', 40, 'application/pdf'),
        'owner_type' => 'carrier',
        'owner_id' => $scenario->assignedCarrier->id,
        'document_type' => 'certificate_of_insurance',
        'expiration_date' => now()->addYear()->toDateString(),
    ]);
}

/* ── Sin antivirus: se guarda, y se dice que no se analizó ───────────────── */

it('sin antivirus el fichero queda «no se pudo analizar», no «pendiente»', function () {
    signIn($this->scenario, Role::Admin);

    subirDocumento($this->scenario)->assertRedirect();

    $version = DB::table('document_versions')->latest('created_at')->first();

    // `pending` era la promesa: un análisis en camino que no venía nunca,
    // porque no había ni analizador ni trabajo que lo hiciera.
    expect((string) $version->malware_scan_status)->toBe('unavailable')
        ->and($version->malware_scan_at)->not->toBeNull();
});

it('el adaptador simulado NUNCA dice que un fichero está limpio', function () {
    $scanner = app(FileScanner::class);

    $ruta = tempnam(sys_get_temp_dir(), 'gd');
    file_put_contents($ruta, 'lo que sea');

    $veredicto = $scanner->scan($ruta, 'lo-que-sea.pdf');

    // Es la decisión entera de este lote. Un simulacro que dijera «limpio»
    // pondría en pantalla un visto bueno de seguridad que nadie ha dado, en la
    // pantalla donde se cuelgan seguros y contratos.
    expect($veredicto->estado)->toBe('unavailable')
        ->and($scanner->isLive())->toBeFalse()
        ->and($veredicto->rechaza())->toBeFalse();

    @unlink($ruta);
});

it('la pantalla dice que en esta instalación no se analiza', function () {
    signIn($this->scenario, Role::Admin);
    subirDocumento($this->scenario)->assertRedirect();

    $documentId = (string) DB::table('documents')->latest('created_at')->value('id');

    $this->get('/documents/'.$documentId)
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('versions.0.scanStatus', 'unavailable'));
});

/* ── Con antivirus: la negativa que el diccionario llevaba años prometiendo ─ */

it('un fichero infectado no se almacena', function () {
    signIn($this->scenario, Role::Admin);
    analizadorQueDice(ScanVerdict::infectado('prueba', 'Eicar-Test-Signature'));

    $antes = DB::table('document_versions')->count();

    subirDocumento($this->scenario)->assertSessionHasErrors('file');

    // Ni fila, ni versión, ni fichero. El análisis va ANTES de guardar
    // precisamente para que no haya que confiar en un borrado posterior.
    expect(DB::table('document_versions')->count())->toBe($antes);
});

it('un fichero infectado deja rastro en la bitácora', function () {
    signIn($this->scenario, Role::Admin);
    analizadorQueDice(ScanVerdict::infectado('prueba', 'Eicar-Test-Signature'));

    subirDocumento($this->scenario)->assertSessionHasErrors('file');

    $evento = DB::table('audit_events')
        ->where('action', 'security.malware_blocked')
        ->latest('created_at')
        ->first();

    // Sin esto, la única señal de que alguien intentó subir algo con un troyano
    // sería un mensaje de error que ve esa misma persona y nadie más.
    expect($evento)->not->toBeNull()
        ->and((string) $evento->entity_label)->toBe('seguro.pdf');
});

it('con antivirus de verdad el fichero queda limpio', function () {
    signIn($this->scenario, Role::Admin);
    analizadorQueDice(ScanVerdict::limpio('prueba'));

    subirDocumento($this->scenario)->assertRedirect();

    $version = DB::table('document_versions')->latest('created_at')->first();

    expect((string) $version->malware_scan_status)->toBe('clean');
    expect(Storage::disk('local')->exists($version->storage_key))->toBeTrue();
});

/* ── Lo que genera la propia aplicación no se manda a analizar ───────────── */

it('la confirmación de tarifa no se manda a analizar', function () {
    signIn($this->scenario, Role::Admin);

    // Nunca sale de este servidor, así que mandarla a un antivirus sería
    // teatro. `not_scanned` dice eso, y NO es lo mismo que `unavailable`.
    expect(Scanning::propio())
        ->toBe(['malware_scan_status' => 'not_scanned', 'malware_scan_at' => null]);
});

/* ── La instalación lo admite en su propia pantalla ──────────────────────── */

it('el inventario de proveedores incluye el analizador', function () {
    $fila = collect(Providers::inventory())
        ->firstWhere('key', 'malware');

    expect($fila)->not->toBeNull()
        ->and($fila['interface'])->toBe('FileScanner')
        ->and($fila['status'])->toBe('mock');
});
