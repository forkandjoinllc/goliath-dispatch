<?php

declare(strict_types=1);

use App\Support\Loads\DriverEligibility;
use App\Support\Loads\DriverFacts;
use Carbon\CarbonImmutable;

/*
| Sin base de datos: la comparación es una función pura. Que se pueda probar
| así es la prueba de que no consulta nada por su cuenta — y de que meterla en
| una lista de veinte conductores no va a costar veinte consultas.
*/

function req(string $type, ?string $value = null, ?string $source = null): array
{
    return ['type' => $type, 'value' => $value, 'source' => $source];
}

function hoy(): CarbonImmutable
{
    return CarbonImmutable::parse('2026-08-28 12:00:00');
}

function veredicto(array $requisitos, DriverFacts $facts): string
{
    return DriverEligibility::summarize(
        DriverEligibility::evaluate($requisitos, $facts, hoy()),
    )['verdict'];
}

/* ── TWIC ───────────────────────────────────────────────────────────────── */

it('sin TWIC no cumple un requisito de TWIC', function () {
    $r = DriverEligibility::evaluate([req('twic')], new DriverFacts, hoy());

    expect($r[0]['outcome'])->toBe('fails')
        ->and($r[0]['reason'])->toBe('loads.eligibility.twicMissing');
});

it('con TWIC en vigor cumple', function () {
    $facts = new DriverFacts(twicCard: true, twicExpiresAt: CarbonImmutable::parse('2029-01-01'));

    expect(veredicto([req('twic')], $facts))->toBe('meets');
});

it('una TWIC caducada NO cumple', function () {
    $facts = new DriverFacts(twicCard: true, twicExpiresAt: CarbonImmutable::parse('2026-01-01'));

    expect(veredicto([req('twic')], $facts))->toBe('fails');
});

it('una TWIC sin caducidad no consta, que no es lo mismo que no cumple', function () {
    // Una TWIC caducada no abre ninguna puerta, así que «tiene tarjeta» a secas
    // no basta para decir que cumple. Pero tampoco es un «no»: es un dato que
    // falta, y se arregla mirándolo.
    $facts = new DriverFacts(twicCard: true);

    expect(veredicto([req('twic')], $facts))->toBe('unknown');
});

/* ── Endorsements ───────────────────────────────────────────────────────── */

it('el endorsement exigido tiene que estar en la licencia', function () {
    $conH = new DriverFacts(endorsements: ['H', 'N'], licenceOnFile: true);
    $sinH = new DriverFacts(endorsements: ['N'], licenceOnFile: true);

    expect(veredicto([req('endorsement', 'H')], $conH))->toBe('meets')
        ->and(veredicto([req('endorsement', 'H')], $sinH))->toBe('fails');
});

it('sin licencia en ficha, los endorsements no constan', function () {
    // Una lista vacía en un conductor del que no consta la licencia no dice «no
    // tiene endosos»: dice que nadie ha metido la licencia todavía.
    expect(veredicto([req('endorsement', 'H')], new DriverFacts))->toBe('unknown');
});

/* ── Autorización de trabajo ────────────────────────────────────────────── */

it('sin estatus registrado, no consta', function () {
    expect(veredicto([req('work_authorization', 'us_citizen', 'Contrato NAVFAC 2026')], new DriverFacts))
        ->toBe('unknown');
});

it('compara el estatus exigido con el que consta', function () {
    $ciudadano = new DriverFacts(workAuthorization: 'us_citizen');
    $residente = new DriverFacts(workAuthorization: 'permanent_resident');
    $r = req('work_authorization', 'us_citizen', 'Contrato NAVFAC 2026');

    expect(veredicto([$r], $ciudadano))->toBe('meets')
        ->and(veredicto([$r], $residente))->toBe('fails');
});

it('un requisito de estatus sin decir de dónde sale queda marcado', function () {
    // El controlador no deja guardarlo, pero una fila vieja o cargada a mano sí
    // puede llegar así, y entonces hay que verlo.
    $r = DriverEligibility::evaluate(
        [req('work_authorization', 'us_citizen', null)],
        new DriverFacts(workAuthorization: 'us_citizen'),
        hoy(),
    );

    expect($r[0]['outcome'])->toBe('meets')
        ->and($r[0]['sourceMissing'])->toBeTrue();
});

/* ── Récord ─────────────────────────────────────────────────────────────── */

it('el récord limpio tiene que cubrir los años exigidos', function () {
    $cinco = new DriverFacts(recordCleanYears: 5);

    expect(veredicto([req('clean_record', '3')], $cinco))->toBe('meets')
        ->and(veredicto([req('clean_record', '10')], $cinco))->toBe('fails');
});

it('un récord sin revisar no consta', function () {
    expect(veredicto([req('clean_record', '3')], new DriverFacts))->toBe('unknown');
});

it('una revisión vieja se marca pero no cambia el veredicto', function () {
    // Inventarse un incidente que nadie ha visto sería peor que avisar de que
    // la comprobación tiene tiempo.
    $viejo = new DriverFacts(
        recordCleanYears: 5,
        recordCheckedAt: CarbonImmutable::parse('2024-01-01'),
    );

    $r = DriverEligibility::evaluate([req('clean_record', '3')], $viejo, hoy());

    expect($r[0]['outcome'])->toBe('meets')
        ->and($r[0]['stale'])->toBeTrue();
});

/* ── El resumen ─────────────────────────────────────────────────────────── */

it('un solo «no cumple» manda sobre todo lo demás', function () {
    // `licenceOnFile` importa: sin licencia registrada, una lista de endosos
    // vacía significa «nadie ha metido la licencia», no «no tiene el endoso», y
    // el veredicto correcto es «no consta». Para probar que un fallo manda sobre
    // el resto hace falta un fallo DE VERDAD, y eso exige licencia en el sistema.
    $facts = new DriverFacts(
        twicCard: true,
        twicExpiresAt: CarbonImmutable::parse('2029-01-01'),
        licenceOnFile: true,
    );

    // Cumple la TWIC, no consta el récord, y falla el endorsement.
    expect(veredicto([req('twic'), req('clean_record', '3'), req('endorsement', 'H')], $facts))
        ->toBe('fails');
});

it('sin fallos pero con algo por mirar, el veredicto es «no consta»', function () {
    $facts = new DriverFacts(twicCard: true, twicExpiresAt: CarbonImmutable::parse('2029-01-01'));

    expect(veredicto([req('twic'), req('clean_record', '3')], $facts))->toBe('unknown');
});

it('una carga sin requisitos no tiene nada que objetar', function () {
    expect(veredicto([], new DriverFacts))->toBe('meets');
});

it('un tipo de requisito desconocido se ignora en vez de reventar', function () {
    // Una fila con un tipo que este código no conoce no puede tumbar la
    // pantalla de asignación entera.
    expect(DriverEligibility::evaluate([req('pasaporte')], new DriverFacts, hoy()))->toBe([]);
});

/* ── Los hechos salen de una fila cruda ─────────────────────────────────── */

it('lee los hechos de una fila de la base de datos', function () {
    $fila = (object) [
        'twic_card' => 1,
        'twic_expires_at' => '2029-06-30 00:00:00.000',
        'endorsements' => '["h","n"]',
        'cdl_class' => 'A',
        'work_authorization' => 'permanent_resident',
        'record_clean_years' => 5,
        'record_checked_at' => '2026-08-01 00:00:00.000',
    ];

    $f = DriverFacts::fromRow($fila);

    // Los endorsements llegan en JSON y en minúsculas; se comparan en mayúsculas.
    expect($f->endorsements)->toBe(['H', 'N'])
        ->and($f->twicCard)->toBeTrue()
        ->and($f->licenceOnFile)->toBeTrue()
        ->and($f->recordCleanYears)->toBe(5);

    expect(veredicto([req('endorsement', 'H'), req('twic')], $f))->toBe('meets');
});
