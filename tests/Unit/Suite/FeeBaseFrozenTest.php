<?php

declare(strict_types=1);

use App\Support\Finance\FeeBase;
use Tests\Support\Source;

/**
 * Un porcentaje pactado sobre otra cantidad es otro precio.
 *
 * ## El defecto
 *
 * Una carga se calcula con cuatro entradas de dinero. Tres viven en la CARGA,
 * congeladas desde que se acordó; la cuarta se leía viva de los ajustes de la
 * empresa. Y el comentario que lo explica está justo encima de la línea que
 * fallaba:
 *
 * > Los puntos básicos salen de la CARGA, no del transportista ni de los
 * > ajustes. Están congelados ahí desde que se acordó la carga precisamente
 * > para que subirle la tarifa a un transportista hoy no reescriba lo que se
 * > pactó el mes pasado.
 *
 * La línea siguiente decía `feeBase: $this->feeBase($load->tenant_id)`.
 *
 * ## Lo que se midió
 *
 * Sobre una carga que ya existía, con un gasto excluido de $1.000, cambiando el
 * ajuste en Ajustes → Dinero:
 *
 * | | antes | después |
 * |---|---|---|
 * | Tarifa de despacho | $300,00 | $400,00 |
 * | Lo que cobra el transportista | $3.700,00 | $3.600,00 |
 * | Comisión del despachador | $75,00 | $100,00 |
 *
 * Y esa misma pantalla dice tres veces, en los dos idiomas: «Cambiarla no
 * reescribe nada de lo que ya existe», «las que ya existen conservan lo suyo»,
 * «una carga conserva su tarifa y su comisión desde que se acordó».
 *
 * ## La justificación que tenía, y por qué no se sostiene
 *
 * El método decía que la base «no es un precio pactado sino la interpretación
 * del contrato marco de la empresa». Es un argumento razonable hasta que se
 * miran las cifras: cambiarla mueve lo que cobra el transportista por una carga
 * que ya se acordó. Un porcentaje aplicado sobre otra cantidad es otro precio,
 * se llame como se llame.
 */
function raizBase(): string
{
    return Source::root();
}

/* ── Las cuatro entradas ─────────────────────────────────────────────────── */

it('las cuatro entradas de dinero salen de la carga', function (): void {
    // El registro es la prueba: si mañana aparece una quinta entrada leída de
    // los ajustes vivos, esta lista deja de cuadrar con el fuente.
    $entradas = [
        'dispatchFeeBps' => 'dispatchFeeBps:(int)$load->carrier_dispatch_fee_bps',
        'commissionBps' => 'commissionBps:(int)$load->dispatcher_commission_bps',
        'commissionBasis' => '$load->dispatcher_commission_basis',
        'feeBase' => 'feeBase:$this->feeBase($load)',
    ];

    $fuente = Source::compacta(raizBase().'/app/Support/Finance/LoadCalculator.php');

    foreach ($entradas as $nombre => $aguja) {
        test()->assertStringContainsString($aguja, $fuente, "La entrada {$nombre} ya no sale de la carga.");
    }

    // Y ninguna se resuelve por el identificador de la empresa, que es la forma
    // exacta que tenía el defecto: `$this->feeBase($load->tenant_id)`.
    test()->assertStringNotContainsString('feeBase($load->tenant_id)', $fuente);
});

it('la base propia gana a la de los ajustes', function (): void {
    $fuente = Source::compacta(raizBase().'/app/Support/Finance/LoadCalculator.php');

    // El respaldo existe —una fila sin sellar no puede reventar el cálculo de
    // dinero—, pero va DESPUÉS: si se leyera primero la política, la columna
    // sellada no serviría de nada.
    $posPropia = strpos($fuente, '$load->dispatch_fee_base');
    $posAjustes = strpos($fuente, 'TenantPolicy::for($load->tenant_id)->dispatchFeeBase');

    expect($posPropia)->toBeInt('La base ya no se lee de la carga.')
        ->and($posAjustes)->toBeInt('Se ha quitado el respaldo para las filas sin sellar.');

    expect($posPropia)->toBeLessThan($posAjustes, 'La base de la carga tiene que mirarse primero.');
});

/* ── El sello al dar de alta ─────────────────────────────────────────────── */

it('el alta sella la base fuera del bloque de permiso de dinero', function (): void {
    // Dentro del `if ($canMoney)`, una carga creada por quien no ve importes se
    // quedaría con el valor por omisión de la columna en vez de con el de su
    // empresa — un defecto más callado que el original.
    $fuente = Source::compacta(raizBase().'/app/Http/Controllers/App/LoadController.php');

    $posSello = strpos($fuente, "\$columns['dispatch_fee_base']");
    $posBloque = strpos($fuente, 'if($canMoney){');

    expect($posSello)->toBeInt('El alta no sella la base.')
        ->and($posBloque)->toBeInt();

    expect($posSello)->toBeLessThan($posBloque, 'El sello tiene que ir antes del bloque de dinero.');
});

/* ── La instantánea ──────────────────────────────────────────────────────── */

it('la instantánea guarda con qué base se calculó', function (): void {
    // Sin esto, una liquidación cerrada guardaba los puntos básicos y la base
    // de la COMISIÓN pero no la de la TARIFA: no podía explicar su propia cifra.
    $fuente = Source::compacta(raizBase().'/app/Support/Finance/LoadFinancials.php');

    test()->assertStringContainsString("'dispatch_fee_base'=>\$this->feeBase->value", $fuente);
});

/* ── La promesa de la pantalla ───────────────────────────────────────────── */

it('la pantalla sigue prometiendo lo que ahora es verdad', function (): void {
    // La otra salida de este lote era cambiar el texto. Se eligió congelar la
    // base; si algún día se deshace, el texto tiene que cambiar en el mismo
    // movimiento y no quedarse mintiendo solo.
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode((string) file_get_contents(raizBase()."/lang/{$idioma}/settings.json"), true);

        foreach ([['money', 'note'], ['index', 'subtitle'], ['flash', 'saved']] as [$grupo, $clave]) {
            $texto = $d[$grupo][$clave] ?? null;

            expect($texto)->toBeString("Falta settings.{$grupo}.{$clave} en {$idioma}.");

            test()->assertMatchesRegularExpression(
                '/(no reescribe|conservan lo suyo|conserva su tarifa|never rewrites|keep what they were|keeps its own)/i',
                (string) $texto,
                "El texto de settings.{$grupo}.{$clave} en {$idioma} ya no promete lo que el código hace.",
            );
        }
    }
});

/* ── La migración ────────────────────────────────────────────────────────── */

it('la migración rellena las filas que ya existían', function (): void {
    // Una columna nueva con valor por omisión y sin relleno pondría
    // `commissionable_base` a todas las cargas abiertas de una empresa que usa
    // la otra base: el importe de cada una cambiaría el día del despliegue, que
    // es justo lo que este lote viene a impedir.
    $fuente = Source::sinComentarios(
        raizBase().'/database/migrations/2026_09_14_100000_freeze_dispatch_fee_base_on_loads.php',
    );

    foreach (['loads', 'financial_snapshots'] as $tabla) {
        test()->assertMatchesRegularExpression(
            "/update {$tabla}[\\s\\S]{0,200}set \\w+\\.dispatch_fee_base = s\\.dispatch_fee_base/",
            $fuente,
            "La migración no rellena {$tabla} con la base que la empresa tiene puesta.",
        );
    }
});

it('solo hay dos bases y las dos están contempladas', function (): void {
    expect(FeeBase::cases())->toHaveCount(2);

    $fuente = Source::compacta(raizBase().'/app/Support/Finance/Calculator.php');

    foreach (FeeBase::cases() as $caso) {
        test()->assertStringContainsString('FeeBase::'.$caso->name.'=>', $fuente, "La base {$caso->value} no se calcula.");
    }
});
