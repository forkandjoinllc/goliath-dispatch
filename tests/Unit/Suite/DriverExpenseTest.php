<?php

declare(strict_types=1);

use App\Authorization\RoleMatrix;
use App\Enums\Role;
use App\Enums\Scope;
use App\Support\Notifications\Events;
use Tests\Support\Source;

use function PHPUnit\Framework\assertArrayHasKey;

/**
 * El conductor ve los gastos que presentó él, y se entera de la decisión.
 *
 * ## El defecto
 *
 * Un conductor tenía `expense:submit` y NO `expense:read`. Entregaba el recibo
 * del combustible y no volvía a saber nada: `ExpenseController::index()` lo
 * detectaba y lo devolvía al formulario —«es lo único que este dominio le
 * ofrece»—, así que no podía ver si se lo aprobaron, si se lo rechazaron, ni
 * por qué.
 *
 * Y rechazar EXIGE un motivo de cinco caracteres como mínimo, escrito para él,
 * sobre una decisión que no se deshace (ver `ExpenseTransitions`). La
 * aplicación le pedía a alguien que explicara algo definitivo a un lector al
 * que le cerraba la puerta.
 *
 * ## Las dos mitades
 *
 * Dejarle mirar sin avisarle es media solución; avisarle sin dejarle mirar es
 * la otra media. Por eso van juntas:
 *
 *  - `expense:read` con alcance PROPIO en la matriz del conductor;
 *  - el aviso `expense.rejected`, de público propio, a quien lo presentó.
 *
 * Lo que MIDE que solo ve los suyos es
 * `tests/Feature/Expenses/DriverVisibilityTest.php`.
 */
function raizGastoConductor(): string
{
    return Source::root();
}

it('el conductor puede leer sus gastos, y solo con alcance propio', function (): void {
    $matriz = RoleMatrix::for(Role::Driver);

    assertArrayHasKey('expense:read', $matriz, 'el conductor volvió a quedarse sin poder ver lo que presenta');

    // PROPIO y no más: con alcance de empresa vería los gastos de todos, que es
    // el error contrario y más caro.
    expect($matriz['expense:read'])->toBe(Scope::Own);

    // Y lo que puede HACER no cambia: decidir sigue siendo de la oficina.
    expect($matriz)->not->toHaveKey('expense:approve');
});

it('la lista se estrecha por quien lo presentó', function (): void {
    $fuente = Source::compacta(raizGastoConductor().'/app/Http/Controllers/App/ExpenseController.php');

    // `ScopeFilter` resuelve el alcance propio por esta columna. Sin ella
    // declarada, un alcance propio no puede demostrarse y devuelve cero filas
    // —que es seguro, pero dejaría al conductor con la lista vacía y sin saber
    // por qué.
    expect($fuente)->toContain("'owner'=>'submitted_by_user_id'");
});

it('el desvío al formulario sigue existiendo para quien no puede leer', function (): void {
    $fuente = Source::sinComentarios(raizGastoConductor().'/app/Http/Controllers/App/ExpenseController.php');

    // No se quita: hay roles futuros que podrán presentar sin leer, y el enlace
    // del menú aparece con cualquier permiso del dominio. Lo que cambia es que
    // el conductor ya no cae por ahí.
    expect($fuente)->toContain("redirect()->route('expenses.create')");
});

it('el rechazo avisa a quien lo presentó y la aprobación no', function (): void {
    $fuente = Source::compacta(raizGastoConductor().'/app/Http/Controllers/App/ExpenseController.php');

    expect($fuente)->toContain('Notifier::toOwner(');
    expect($fuente)->toContain("eventKey:'expense.rejected'");

    // Solo al rechazar. Una campana que suena también con las buenas noticias
    // deja de mirarse, y lo que hay que explicar es el «no».
    expect($fuente)->toContain("if(\$nuevo==='rejected'&&\$model->submitted_by_user_id!==null)");
});

it('el aviso lleva el motivo, que es para lo que se exige', function (): void {
    $fuente = Source::compacta(raizGastoConductor().'/app/Http/Controllers/App/ExpenseController.php');

    // Sin el motivo dentro, el aviso repite el «rechazado» a secas que el
    // mínimo de cinco caracteres existe para evitar.
    expect($fuente)->toContain("'reason'=>(string)\$motivo");

    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(raizGastoConductor()."/lang/{$idioma}/notifications.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        expect($d['events']['expense']['rejected']['body'])->toContain('{reason}');
        expect($d['events']['expense']['rejected']['title'])->toContain('{description}');
    }
});

it('la copia dice que la decisión no vuelve', function (): void {
    // El gasto rechazado es definitivo —`ExpenseTransitions` lo sujeta— y el
    // aviso es el único sitio donde quien lo presentó se entera de las dos
    // cosas a la vez: que le dijeron que no, y que no hay recurso.
    $frases = ['es' => 'definitiva', 'en' => 'final'];

    foreach ($frases as $idioma => $frase) {
        $d = json_decode(
            (string) file_get_contents(raizGastoConductor()."/lang/{$idioma}/notifications.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        expect($d['events']['expense']['rejected']['body'])->toContain($frase);
    }
});

it('la vía del dueño comprueba que su rol pueda leer eso', function (): void {
    $fuente = Source::compacta(raizGastoConductor().'/app/Support/Notifications/Notifier.php');

    // Un aviso sobre algo que quien lo recibe no puede abrir es una campana que
    // suena para nada — y es exactamente lo que habría pasado si este lote
    // hubiera mandado el aviso sin darle antes `expense:read`.
    expect($fuente)->toContain('array_key_exists($permission,RoleMatrix::for($caso))');
    expect($fuente)->toContain("->where('status','active')");

    expect(Events::publico('expense.rejected'))->toBe(Events::PROPIO);
    expect(Events::permiso('expense.rejected'))->toBe('expense:read');
});
