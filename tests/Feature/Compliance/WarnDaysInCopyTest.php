<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Support\Scenario;

/**
 * El texto del campo de caducidad dice el plazo de ESTA empresa.
 *
 * Decía «Se le avisará 45 días antes» mientras el aviso salía de los ajustes,
 * con 30 por defecto. Quien leía eso al subir una póliza planeaba la renovación
 * contando con quince días que el producto no le daba.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    $this->escenario = Scenario::create();
    $this->tenantId = (string) $this->escenario->tenant->id;
});

afterEach(function (): void {
    TenantPolicy::forget();
    app(TenantContext::class)->forget();
});

function plazoDeLaEmpresa(string $tenantId, int $dias): void
{
    DB::table('tenant_settings')->where('tenant_id', $tenantId)
        ->update(['document_expiration_warning_days' => $dias]);

    TenantPolicy::forget($tenantId);
}

it('el formulario recibe el plazo de la empresa', function (): void {
    plazoDeLaEmpresa($this->tenantId, 20);

    signIn($this->escenario, Role::Admin);

    $p = json_decode((string) json_encode(
        $this->get('/documents/upload')->viewData('page')['props'] ?? []), true);

    expect($p['warnDays'] ?? null)->toBe(20);
});

it('y cambia cuando la empresa lo cambia', function (): void {
    // Un número que no se mueve al mover el ajuste es el defecto otra vez, esta
    // vez con una fuente distinta.
    signIn($this->escenario, Role::Admin);

    $leer = function (): ?int {
        $p = json_decode((string) json_encode(
            $this->get('/documents/upload')->viewData('page')['props'] ?? []), true);

        return $p['warnDays'] ?? null;
    };

    plazoDeLaEmpresa($this->tenantId, 20);
    $antes = $leer();

    plazoDeLaEmpresa($this->tenantId, 60);

    expect($antes)->toBe(20)->and($leer())->toBe(60);
});

it('el texto no lleva ningún número escrito', function (): void {
    // La otra mitad: el formulario puede recibir el plazo correcto y el texto
    // seguir diciendo otro. Se comprueba el texto tal y como sale traducido.
    // `expirationHint` se partió en TRES con el lote del vencimiento: una para
    // cada cosa que puede pasar al vencer, porque la única prometía bloqueo a
    // los diecisiete tipos del desplegable y solo se cumplía en tres. Las tres
    // tienen que seguir llevando el plazo de la empresa.
    foreach (['es' => 'Se le avisará 20 días antes', 'en' => 'You will be warned 20 days before'] as $idioma => $esperado) {
        app()->setLocale($idioma);

        foreach (['expirationHintPick', 'expirationHintBlocks', 'expirationHintWarns'] as $clave) {
            test()->assertStringContainsString(
                $esperado,
                (string) __("documents.form.{$clave}", ['days' => 20]),
                "«{$clave}» en {$idioma} no lleva el plazo de la empresa.",
            );
        }
    }
});
