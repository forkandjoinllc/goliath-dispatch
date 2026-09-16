<?php

declare(strict_types=1);

use App\Support\Marketing\PublicClaims;
use Tests\Support\Source;

use function PHPUnit\Framework\assertArrayHasKey;
use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertStringNotContainsString;

/**
 * La segunda mitad de una promesa que ya estaba declarada.
 *
 * `forClients.tracking.body` dice: «Una vez despachada su carga, recibirá un
 * enlace seguro por correo electrónico… **Ábralo cuando quiera** para ver el
 * estado desde la recolección hasta la entrega». Está en
 * `PublicClaims::RESPALDOS` con `CustomerLink` de respaldo desde el lote que
 * amplió el vocabulario del detector.
 *
 * Lo que se comprobó entonces fue la PRIMERA mitad: que el correo sale al
 * despachar. El enlace vivía 72 horas y se mandaba una sola vez, así que en
 * cualquier viaje de más de tres días la segunda mitad era falsa — y es la
 * mitad que le dice al cliente que deje de preocuparse.
 *
 * Es la misma forma que el lote del aviso de vencimiento: una frase arreglada a
 * medias, con un comentario que da la otra mitad por buena.
 */
function raizEnlaceVivo(): string
{
    return Source::root();
}

it('la promesa sigue declarada con su respaldo', function (): void {
    assertArrayHasKey('forClients.tracking.body', PublicClaims::RESPALDOS);

    expect(PublicClaims::RESPALDOS['forClients.tracking.body'])
        ->toBe('App\Support\Tracking\CustomerLink');

    // Y la frase sigue prometiendo lo que este lote hace cierto. Si alguien la
    // reescribe para prometer menos, este guardián no lo impide —eso sería
    // congelar la copia— pero si la borra, el registro se queda hablando de
    // algo que no existe.
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(raizEnlaceVivo()."/lang/{$idioma}/marketing.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        expect($d['forClients']['tracking']['body'] ?? null)->toBeString("falta la promesa en {$idioma}");
    }
});

it('el plazo sale del viaje y no de una constante', function (): void {
    $fuente = Source::compacta(raizEnlaceVivo().'/app/Support/Tracking/CustomerLink.php');

    // Antes: `ttlHours: null`, que cae al plazo por omisión de la empresa.
    assertStringNotContainsString('ttlHours:null', $fuente);
    assertStringContainsString('ttlHours:self::horasParaEsteViaje($tenantId,$loadId)', $fuente);

    // Hasta la entrega prevista MÁS el plazo, y nunca por debajo del plazo: una
    // entrega ya pasada daría un número negativo y el enlace nacería muerto.
    assertStringContainsString("->value('planned_delivery_at')", $fuente);
    assertStringContainsString('max($plazo,$hastaLaEntrega+$plazo)', $fuente);
});

it('un enlace vencido ya no bloquea el siguiente', function (): void {
    $fuente = Source::compacta(raizEnlaceVivo().'/app/Support/Tracking/CustomerLink.php');

    // La pregunta cambió de «¿salió alguno?» a «¿hay alguno vivo?».
    assertStringNotContainsString('functionyaSeMando', $fuente);
    assertStringContainsString('functionhayEnlaceVivo', $fuente);
    assertStringContainsString("->whereNull('revoked_at')", $fuente);
    assertStringContainsString("->where('expires_at','>',CarbonImmutable::now())", $fuente);
});

it('el barrido renueva solo lo que sigue en la carretera', function (): void {
    $fuente = Source::compacta(raizEnlaceVivo().'/app/Console/Commands/SweepNotifications.php');

    assertStringContainsString('functionenlacesVencidosEnLaCarretera', $fuente);
    assertStringContainsString('whereIn(\'status\',self::EN_LA_CARRETERA)', $fuente);

    // Las DOS mitades de la condición: tuvo enlace y ya no tiene ninguno vivo.
    // Sin la primera, esto pisaría el trabajo de `enlacesQueNoSalieron`, que
    // avisa a la oficina cuando nunca salió ninguno — otro problema, otra
    // solución.
    assertStringContainsString('->whereExists(fn($q)=>$q->selectRaw(\'1\')->from(\'public_tracking_links\')', $fuente);
    assertStringContainsString('CustomerLink::sendForLoad($tenantId,(string)$carga->id,null)===\'sent\'', $fuente);
});

it('la página de vencido ya no manda al transportista', function (): void {
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(raizEnlaceVivo()."/lang/{$idioma}/tracking.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        $cuerpo = '';

        array_walk_recursive($d, static function ($valor, $clave) use (&$cuerpo): void {
            if ($clave === 'expiredBody') {
                $cuerpo = (string) $valor;
            }
        });

        expect($cuerpo)->not->toBe('', "falta expiredBody en {$idioma}");

        // Quien le mandó el enlace es la casa de despacho, no el transportista:
        // el cliente ni sabe quién lleva el camión.
        expect(strtolower($cuerpo))->not->toContain($idioma === 'es' ? 'a su transportista' : 'your carrier');
    }
});
