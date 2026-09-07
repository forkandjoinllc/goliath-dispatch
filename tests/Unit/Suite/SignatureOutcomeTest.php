<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * Cómo acabó la firma tiene que llegarle a la casa.
 *
 * ## El defecto
 *
 * La página que ve quien acaba de RECHAZAR firmar decía, palabra por palabra:
 *
 * > You have declined to sign this document. The sender has been notified.
 *
 * No le habían avisado. `Public\SignatureController::decline()` escribía la
 * fila, grababa el suceso de ceremonia y no llamaba a nadie. No era una promesa
 * vaga sobre el futuro: era una afirmación de hecho **sobre lo que otra persona
 * ya sabe**, dicha a alguien de fuera de la casa, y era falsa.
 *
 * El camino de vuelta estaba mudo en los dos sentidos: `Mailer::sendSignedCopy`
 * manda la copia AL FIRMANTE, no a quien pidió la firma, y en el catálogo de
 * sucesos no existía ni un solo `signature.*`.
 *
 * ## El segundo defecto, en la misma familia
 *
 * `signature_requests.status` no dice la verdad sobre el vencimiento porque
 * nada corre a medianoche a escribirlo. `SigningLinks` lo sabía y miraba la
 * fecha; la lista de la casa no, y pintaba `r.status` tal cual:
 *
 *  - una solicitud vencida ayer seguía saliendo como «Pendiente»;
 *  - el filtro «Vencida», pulsable en la barra, no encontraba nada NUNCA.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código.
 */
function raizFirmas(): string
{
    return Source::root();
}

function publicoDeFirmas(): string
{
    return Source::sinComentarios(raizFirmas().'/app/Http/Controllers/Public/SignatureController.php');
}

/**
 * El cuerpo de un método suelto, hasta la firma del siguiente.
 *
 * Una ventana de tamaño fijo acaba leyendo el método de al lado — ya pasó en el
 * lote de prospectos, midiendo un `subDay()` que estaba en la función siguiente.
 */
function cuerpoDeFirmas(string $codigo, string $firma): string
{
    $inicio = strpos($codigo, $firma);
    expect($inicio)->toBeInt("no se encontró «{$firma}»: cambió la firma y esto dejó de mirar nada");

    $siguiente = strpos($codigo, "\n    public function ", $inicio + 1);
    $privada = strpos($codigo, "\n    private function ", $inicio + 1);
    $fin = min(array_filter([$siguiente, $privada, strlen($codigo)], fn ($v) => $v !== false));

    return substr($codigo, $inicio, $fin - $inicio);
}

/* ── La frase y el aviso van juntos ──────────────────────────────────────── */

it('si la pantalla dice que al remitente le avisaron, alguien tiene que avisarle', function (): void {
    // Esta es LA comprobación del lote. No vigila que exista una llamada:
    // vigila que la afirmación de la pantalla y lo que hace el código no se
    // separen. Si mañana alguien quita el aviso, esta prueba obliga a quitar
    // también la frase — que es la otra forma correcta de arreglarlo.
    $afirma = false;

    foreach (['en', 'es'] as $idioma) {
        $dic = json_decode((string) file_get_contents(raizFirmas()."/lang/{$idioma}/signature.json"), true);
        $frase = $dic['ceremony']['declinedDescription'] ?? '';

        // Las dos formas en que las dos versiones lo afirman hoy —«has been
        // notified» y «Se ha notificado al remitente»— y las variantes obvias
        // de reescribirlo sin quitar la afirmación.
        if (preg_match('/(has been notified|been told|notificado al remitente|se le (ha )?(avis|notific))/iu', (string) $frase) === 1) {
            $afirma = true;
        }
    }

    if (! $afirma) {
        expect(true)->toBeTrue(); // La frase ya no lo afirma: nada que sujetar.

        return;
    }

    test()->assertStringContainsString(
        'Outcome::declined(',
        cuerpoDeFirmas(publicoDeFirmas(), 'public function decline('),
        'La pantalla le dice a quien rechaza que al remitente ya le avisaron, y decline() no avisa a nadie.'
    );
});

it('firmar también se le cuenta a la casa', function (): void {
    // `Mailer::sendSignedCopy` va al FIRMANTE. Sin esto, quien pidió la firma
    // se entera solo si se le ocurre abrir la lista.
    test()->assertStringContainsString(
        'Outcome::signed(',
        cuerpoDeFirmas(publicoDeFirmas(), 'public function sign('),
        'sign() sella la firma y no se lo cuenta a quien la pidió.'
    );
});

it('los avisos salen del sitio que decide a quién avisar', function (): void {
    // Si el controlador público montara su propio Notifier, el permiso, la
    // clave de deduplicación y el enlace estarían copiados dos veces.
    expect(publicoDeFirmas())->not->toContain('Notifier::');
});

it('el aviso va después de sellar la firma, no dentro', function (): void {
    // Una firma hay que volver a pedírsela a una persona: no se pierde por un
    // aviso que reventó.
    $cuerpo = cuerpoDeFirmas(publicoDeFirmas(), 'public function sign(');

    // La región de la transacción: desde `DB::transaction(` hasta el `catch`
    // que la cierra. Con `strrpos($cuerpo, '));')` esto medía el paréntesis
    // final del PROPIO aviso, así que comparaba una posición consigo misma.
    $abre = strpos($cuerpo, 'DB::transaction(');
    $cierra = strpos($cuerpo, 'catch (RuntimeException');
    $aviso = strpos($cuerpo, 'Outcome::signed(');

    expect($abre)->toBeInt()->and($cierra)->toBeInt()->and($aviso)->toBeInt();

    $dentro = substr($cuerpo, $abre, $cierra - $abre);

    expect($dentro)->not->toContain('Outcome::');
    test()->assertGreaterThan($cierra, $aviso, 'El aviso está dentro de la transacción que sella la firma.');
});

/* ── El estado guardado no es el estado real ─────────────────────────────── */

it('la lista de la casa filtra por el estado real y no por la columna', function (): void {
    $codigo = Source::sinComentarios(raizFirmas().'/app/Http/Controllers/App/SignatureController.php');

    expect($codigo)->toContain('State::filtrar($q, \'r\', $estado)')
        // Con este `where`, pedir «Vencida» no encontraba nada nunca.
        ->and($codigo)->not->toContain("\$q->where('r.status', \$estado)");
});

it('la lista pinta el estado real y no la columna', function (): void {
    $codigo = Source::sinComentarios(raizFirmas().'/app/Http/Controllers/App/SignatureController.php');

    $cuerpo = cuerpoDeFirmas($codigo, 'private function rowPayload(');

    expect($cuerpo)->toContain("'status' => State::of(\$r),")
        ->and($cuerpo)->not->toContain("'status' => (string) \$r->status,");
});

it('la regla del vencimiento está escrita UNA vez', function (): void {
    // Mientras vivió solo dentro de SigningLinks, la lista de la casa pintaba
    // «Pendiente» sobre puertas que ese mismo método ya había cerrado.
    $enlaces = Source::compacta(raizFirmas().'/app/Support/Signatures/SigningLinks.php');

    expect($enlaces)->toContain('State::of($fila)')
        ->and($enlaces)->not->toContain("in_array((string)\$fila->status,['pending','viewed'],true)");
});

it('el filtro de pendientes no devuelve puertas ya cerradas', function (): void {
    // Si «pendiente» siguiera devolviendo las vencidas, se habría arreglado la
    // mitad del defecto: «Vencida» encontraría cosas y «Pendiente» seguiría
    // mintiendo.
    $codigo = Source::compacta(raizFirmas().'/app/Support/Signatures/State.php');

    expect($codigo)->toContain('if(in_array($estado,self::ABIERTOS,true))');
});

/* ── Lo que venció sin firmarse se persigue ──────────────────────────────── */

it('el barrido persigue las firmas que vencieron sin firmar', function (): void {
    $codigo = Source::sinComentarios(raizFirmas().'/app/Console/Commands/SweepNotifications.php');

    expect($codigo)->toContain("\$totales['signatures'] += \$this->firmasQueVencieronSinFirmar(\$tenantId, \$dry);");
});

it('el total de firmas del barrido se imprime', function (): void {
    // Un total que se suma y no sale por pantalla es una pasada que puede dejar
    // de correr sin que la salida cambie. Ya pasó en el lote de prospectos.
    $codigo = Source::sinComentarios(raizFirmas().'/app/Console/Commands/SweepNotifications.php');

    $linea = strpos($codigo, '%d empresas ·');
    expect($linea)->toBeInt();

    $sprintf = substr($codigo, $linea, 1000);

    expect($sprintf)->toContain('firmas %d')
        ->and($sprintf)->toContain("\$totales['signatures'],");
});

it('el aviso de firma vencida no repite cada mañana', function (): void {
    // Nada cierra una solicitud vencida, así que la condición se cumple para
    // siempre: con la fecha en la clave, sonaría todos los días hasta el fin de
    // los tiempos.
    $codigo = Source::compacta(raizFirmas().'/app/Console/Commands/SweepNotifications.php');

    expect($codigo)->toContain('dedupeKey:"signature.expired:{$solicitud->id}"');
});

it('el aviso de firma vencida tiene un corte hacia atrás', function (): void {
    // Sin él, el día que este barrido empiece a correr avisa de golpe de todo
    // lo vencido desde el principio — y una avalancha se archiva entera sin
    // leerla, que es lo mismo que no avisar.
    $codigo = Source::sinComentarios(raizFirmas().'/app/Console/Commands/SweepNotifications.php');

    $cuerpo = cuerpoDeFirmas($codigo, 'private function firmasQueVencieronSinFirmar(');

    expect($cuerpo)->toContain('self::VENCIDAS_DIAS');
});

/* ── Los tres sucesos, con rótulo y con casilla ──────────────────────────── */

it('los tres sucesos están en el catálogo de preferencias', function (): void {
    // Un suceso que se manda y no está en EVENTS no tiene casilla: se manda y
    // no se puede apagar.
    $codigo = Source::sinComentarios(raizFirmas().'/app/Http/Controllers/App/NotificationController.php');

    foreach (['signature.signed', 'signature.declined', 'signature.expired'] as $suceso) {
        expect($codigo)->toContain("'{$suceso}'");
    }
});

it('los tres sucesos tienen título, cuerpo y nombre en inglés y en español', function (): void {
    foreach (['en', 'es'] as $idioma) {
        $dic = json_decode((string) file_get_contents(raizFirmas()."/lang/{$idioma}/notifications.json"), true);

        foreach (['signed', 'declined', 'expired'] as $suceso) {
            expect($dic['events']['signature'][$suceso]['title'] ?? null)->toBeString("falta events.signature.{$suceso}.title en {$idioma}");
            expect($dic['events']['signature'][$suceso]['body'] ?? null)->toBeString("falta events.signature.{$suceso}.body en {$idioma}");
            expect($dic['eventNames']['signature'][$suceso] ?? null)->toBeString("falta eventNames.signature.{$suceso} en {$idioma}");
        }
    }
});

it('el motivo del rechazo entra recortado en el aviso', function (): void {
    // El campo admite dos mil caracteres y esto va a parar al asunto de un
    // correo. Completo está en la fila y en la pantalla adonde lleva el enlace.
    $codigo = Source::compacta(raizFirmas().'/app/Support/Signatures/Outcome.php');

    expect($codigo)->toContain("mb_strimwidth(trim(\$motivo),0,160,'…')");
});
