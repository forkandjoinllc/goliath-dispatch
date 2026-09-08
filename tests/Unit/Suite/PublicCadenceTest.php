<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * La web no promete una cadencia que no depende de ella.
 *
 * ## El defecto
 *
 * Dos páginas PÚBLICAS —`services.onboardingCompliance` y
 * `forCarriers.verification`, las dos renderizadas— le decían a un
 * transportista desconocido, en los dos idiomas:
 *
 * > …re-verified automatically **every 7 days** for as long as you're active,
 * > not just once at signup.
 *
 * Dos cosas iban mal, y son distintas:
 *
 * **1. Los siete días no son de la web.** Son el valor POR OMISIÓN de
 * `tenant_settings.fmcsa_reverification_days`, que cada empresa fija entre 1 y
 * 365. La página prometía una cifra concreta en nombre de una empresa que no la
 * ha prometido — y se la prometía a alguien que todavía no es cliente de nadie.
 * Una empresa con el plazo en 90 tiene una web diciendo 7.
 *
 * **2. Hoy no se revalida a nadie.** El directorio de FMCSA está atado al
 * adaptador de demostración. Eso es de servidor y no se arregla desde aquí; lo
 * que sí se arregla es que el número deje de estar en la web y que el estado
 * real se vea donde se administra.
 *
 * ## Qué sujeta este fichero
 *
 * Que no vuelva a aparecer una cifra de días en la copia pública sobre la
 * revalidación. Si algún día la web quiere decir un número, tendrá que salir
 * del ajuste de la empresa —interpolado— y no escrito a mano.
 *
 * `tests/Unit` no arranca la aplicación: se lee el diccionario.
 */
function raizCadencia(): string
{
    return Source::root();
}

/** Los textos públicos que hablan de revalidar la autoridad. */
function textosDeRevalidacion(): array
{
    $textos = [];

    foreach (['en', 'es'] as $idioma) {
        $dic = json_decode((string) file_get_contents(raizCadencia()."/lang/{$idioma}/marketing.json"), true);

        foreach ([['services', 'onboardingCompliance', 'body'], ['forCarriers', 'verification', 'body']] as $ruta) {
            $valor = $dic;

            foreach ($ruta as $paso) {
                $valor = $valor[$paso] ?? null;
            }

            $textos[$idioma.'.'.implode('.', $ruta)] = (string) $valor;
        }
    }

    return $textos;
}

/* ── Ninguna cifra escrita a mano ────────────────────────────────────────── */

it('la web no dice cada cuántos días se revalida', function (): void {
    $malos = [];

    foreach (textosDeRevalidacion() as $clave => $texto) {
        expect($texto)->not->toBe('', "no se encontró {$clave}: cambió la ruta y esto dejó de mirar nada");

        // «every 7 days», «cada 7 días», «every 30 days»… cualquier cifra
        // seguida de días en un texto que habla de revalidar.
        if (preg_match('/\b(every|cada)\s+\d+\s*(days?|d[íi]as?)/iu', $texto) === 1) {
            $malos[] = $clave;
        }
    }

    expect($malos)->toBe([], 'Estos textos públicos prometen una cadencia concreta que fija cada empresa: '
        .implode(', ', $malos));
});

it('los dos textos siguen hablando de revalidar', function (): void {
    // Quitar la cifra borrando la frase entera también «arreglaría» lo de
    // arriba, y sería peor: la revalidación periódica SÍ existe como diseño y
    // es parte de lo que se ofrece. Lo que no se puede es ponerle número.
    foreach (textosDeRevalidacion() as $clave => $texto) {
        expect($texto)->toMatch('/(re-verified|revalida)/iu', "{$clave} dejó de mencionar la revalidación");
    }
});

it('y dicen de quién depende la cadencia', function (): void {
    // Sin esto, «se revalida periódicamente» es vago de una forma que no ayuda:
    // quien lo lee no sabe a quién preguntarle cada cuánto.
    $sinDueno = [];

    foreach (textosDeRevalidacion() as $clave => $texto) {
        if (preg_match('/(dispatch company|casa de despacho)/iu', $texto) !== 1) {
            $sinDueno[] = $clave;
        }
    }

    expect($sinDueno)->toBe([], 'Estos no dicen quién fija la cadencia: '.implode(', ', $sinDueno));
});

/* ── Y donde se decide, se dice si la decisión tiene efecto ──────────────── */

it('la pantalla de ajustes recibe el estado real de la revalidación', function (): void {
    $codigo = Source::sinComentarios(raizCadencia().'/app/Http/Controllers/App/TenantSettingController.php');

    expect($codigo)->toContain("'revalidation' => RevalidationState::for((string) \$actor->tenantId),");
});

it('el estado separa el proveedor de la última ejecución', function (): void {
    // Que haya proveedor conectado NO significa que el planificador esté
    // corriendo. Juntarlas en un solo semáforo verde sería inventarse una
    // garantía.
    $codigo = Source::compacta(raizCadencia().'/app/Support/Fmcsa/RevalidationState.php');

    expect($codigo)->toContain("'providerLive'=>app(FmcsaDirectory::class)->isLive()")
        ->and($codigo)->toContain("'lastVerifiedAt'=>");
});

it('la pantalla avisa cuando el número no gobierna nada', function (): void {
    $pantalla = file_get_contents(raizCadencia().'/resources/js/pages/App/Settings/Index.tsx');

    expect($pantalla)->toContain('revalidation.providerLive ? (')
        ->and($pantalla)->toContain("t('settings.ops.fmcsaNotConnected'");
});

it('los tres avisos de ajustes están en los dos idiomas', function (): void {
    foreach (['en', 'es'] as $idioma) {
        $dic = json_decode((string) file_get_contents(raizCadencia()."/lang/{$idioma}/settings.json"), true);

        foreach (['fmcsaNotConnected', 'fmcsaLastRun', 'fmcsaNeverRun'] as $clave) {
            expect($dic['ops'][$clave] ?? null)->toBeString("falta ops.{$clave} en {$idioma}");
        }
    }
});

it('el aviso de «no conectado» dice cuántos transportistas esperan', function (): void {
    // Sin el número, el aviso se lee como una nota técnica. Con él es una cola
    // de trabajo, que es lo que de verdad es.
    foreach (['en', 'es'] as $idioma) {
        $dic = json_decode((string) file_get_contents(raizCadencia()."/lang/{$idioma}/settings.json"), true);

        expect($dic['ops']['fmcsaNotConnected'])->toContain('{count}');
    }
});
