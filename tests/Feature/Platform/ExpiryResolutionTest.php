<?php

declare(strict_types=1);

use App\Support\Platform\Expirations;
use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Un aviso materializado se cierra cuando deja de ser verdad.
 *
 * `document_expirations` la escribe el barrido y la lee Salud de plataforma.
 * Entre la consulta que cerraba los HUÉRFANOS y la que cerraba los de fecha
 * ANTERIOR quedaban dos agujeros, y los dos inflaban el mismo contador: la
 * transición de «por vencer» a «vencido» —misma fecha, distinto tipo— y el
 * documento renovado, que deja de entrar en el barrido y no vuelve a pasar por
 * la materialización nunca.
 *
 * Estas pruebas corren el barrido de verdad, mueven la fecha del documento y lo
 * vuelven a correr, que es lo que pasa en el calendario a lo largo de un mes.
 */
function papelConCaducidad(Scenario $s, string $fecha): string
{
    $id = (string) Str::uuid();

    DB::table('documents')->insert([
        'id' => $id,
        'tenant_id' => $s->tenant->id,
        'document_type' => 'certificate_of_insurance',
        'owner_type' => 'carrier',
        'owner_id' => $s->assignedCarrier->id,
        'title' => 'Seguro de responsabilidad',
        'review_status' => 'approved',
        'expiration_date' => $fecha.' 00:00:00',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

function mueveCaducidad(string $documentId, string $fecha): void
{
    DB::table('documents')->where('id', $documentId)->update([
        'expiration_date' => $fecha.' 00:00:00',
        'updated_at' => now(),
    ]);
}

function barrerVencimientos(): void
{
    Artisan::call('notifications:sweep');
}

/** @return array{warning: int, expired: int} */
function cubos(Scenario $s): array
{
    $r = Expirations::summary((string) $s->tenant->id);

    return ['warning' => $r['warning'], 'expired' => $r['expired']];
}

it('un documento cuenta en UN cubo, no en dos', function () {
    // Caduca dentro del plazo de aviso: el barrido lo materializa como
    // «por vencer».
    papelConCaducidad($this->scenario, now()->addDays(10)->toDateString());
    barrerVencimientos();

    expect(cubos($this->scenario))->toBe(['warning' => 1, 'expired' => 0]);

    // Y AHORA PASA EL TIEMPO. No se toca el documento: su fecha de caducidad es
    // la misma y lo único que cambia es el calendario.
    //
    // Mi primera versión de esta prueba movía la fecha del documento al pasado
    // para «simular» los días, y con eso la fila vieja se cerraba por la
    // comparación de FECHAS. Pasaba en verde con el arreglo quitado. Un
    // sabotaje lo enseñó: lo que hay que mover es el reloj.
    $this->travel(11)->days();

    barrerVencimientos();

    // Antes esto decía «Por vencer: 1 · Ya vencidos: 1» sobre UN documento: la
    // consulta que cerraba lo viejo buscaba una fecha estrictamente anterior, y
    // en la transición la fecha es la misma y solo cambia el tipo.
    expect(cubos($this->scenario))->toBe(['warning' => 0, 'expired' => 1]);

    $this->travelBack();
});

it('renovar a otra fecha cercana no deja dos avisos vivos', function () {
    $doc = papelConCaducidad($this->scenario, now()->addDays(10)->toDateString());
    barrerVencimientos();

    // Se renueva a una fecha que SIGUE dentro del plazo de aviso. La fila vieja
    // habla de un vencimiento que ya no existe, y la nueva se materializa: sin
    // comparar la fecha, el documento cuenta dos veces en el mismo cubo.
    mueveCaducidad($doc, now()->addDays(5)->toDateString());
    barrerVencimientos();

    expect(cubos($this->scenario))->toBe(['warning' => 1, 'expired' => 0]);
});

it('estrechar el plazo de aviso cierra lo que ya no está dentro', function () {
    // Con el plazo de la empresa en 30 días, un papel a 25 días avisa.
    $doc = papelConCaducidad($this->scenario, now()->addDays(25)->toDateString());
    barrerVencimientos();

    expect(cubos($this->scenario)['warning'])->toBe(1);

    // El administrador baja el plazo a diez días en los ajustes. Ese papel deja
    // de estar por vencer: su fila sigue diciendo lo contrario, con la misma
    // fecha y el mismo tipo, y no la cerraría ninguna otra comparación.
    app(TenantContext::class)->withoutTenant(function (): void {
        DB::table('tenant_settings')
            ->where('tenant_id', $this->scenario->tenant->id)
            ->update(['document_expiration_warning_days' => 10, 'updated_at' => now()]);
    });

    // `TenantPolicy` cachea por petición y el barrido corre en el mismo
    // proceso que la prueba.
    TenantPolicy::forget();

    barrerVencimientos();

    expect(cubos($this->scenario))->toBe(['warning' => 0, 'expired' => 0]);

    // Y el documento sigue ahí, intacto: lo que se cerró es el AVISO.
    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($doc): void {
        expect(DB::table('documents')->where('id', $doc)->whereNull('deleted_at')->exists())->toBeTrue();
    });
});

it('renovar el papel cierra su aviso, aunque ya no entre en el barrido', function () {
    $doc = papelConCaducidad($this->scenario, now()->addDays(5)->toDateString());
    barrerVencimientos();

    expect(cubos($this->scenario)['warning'])->toBe(1);

    // Se renueva a un año vista. A partir de aquí el documento NO entra en la
    // consulta del barrido —que solo mira lo que caduca dentro del plazo— así
    // que `materializar()` no vuelve a ejecutarse para él jamás.
    mueveCaducidad($doc, now()->addYear()->toDateString());
    barrerVencimientos();

    // Antes se quedaba colgado para siempre: «Ya vencidos: 12» sobre papeles
    // renovados hace meses, mientras el listado del inquilino decía cero.
    expect(cubos($this->scenario))->toBe(['warning' => 0, 'expired' => 0]);
});

it('el aviso vivo NO se cierra solo', function () {
    papelConCaducidad($this->scenario, now()->addDays(7)->toDateString());

    barrerVencimientos();
    barrerVencimientos();

    // La otra mitad. Una regla que cierra todo lo que no reconoce vaciaría la
    // pantalla y parecería que no hay nada que vigilar.
    expect(cubos($this->scenario)['warning'])->toBe(1);
});

it('el papel borrado también se cierra', function () {
    $doc = papelConCaducidad($this->scenario, now()->addDays(7)->toDateString());
    barrerVencimientos();

    DB::table('documents')->where('id', $doc)->update(['deleted_at' => now()]);
    barrerVencimientos();

    // Lo que hacía la función anterior sigue haciéndose: un documento borrado
    // no tiene estado que describir, que es el caso particular de la regla
    // general.
    expect(cubos($this->scenario))->toBe(['warning' => 0, 'expired' => 0]);
});

it('quitarle la caducidad también', function () {
    $doc = papelConCaducidad($this->scenario, now()->addDays(7)->toDateString());
    barrerVencimientos();

    DB::table('documents')->where('id', $doc)->update(['expiration_date' => null, 'updated_at' => now()]);
    barrerVencimientos();

    expect(cubos($this->scenario))->toBe(['warning' => 0, 'expired' => 0]);
});

it('dos documentos distintos siguen contando dos', function () {
    papelConCaducidad($this->scenario, now()->addDays(3)->toDateString());
    papelConCaducidad($this->scenario, now()->subDays(3)->toDateString());

    barrerVencimientos();

    // Que la regla cierre de más es tan malo como que cierre de menos: la
    // pantalla existe para saber si el número es cero.
    expect(cubos($this->scenario))->toBe(['warning' => 1, 'expired' => 1]);
});
