<?php

declare(strict_types=1);

namespace App\Support\Platform;

use Cron\CronExpression;
use DateTimeImmutable;
use DateTimeInterface;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Artisan;
use Throwable;

/**
 * Qué tareas hay programadas, preguntándoselo al planificador.
 *
 * ## El defecto
 *
 * La pantalla de salud llevaba la lista escrita a mano:
 *
 *     private const TAREAS = ['notifications:sweep', 'retention:sweep'];
 *
 * Y `routes/console.php` llevaba la otra. Dos listas que tienen que coincidir y
 * que nada obligaba a coincidir: un `Schedule::command()` nuevo corría en el
 * servidor y no aparecía en ninguna pantalla, así que si se le rompía el cron
 * nadie se enteraba jamás. La pantalla que existe para vigilar lo que corre
 * solo no vigilaba lo que no le hubieran contado.
 *
 * Ahora la lista sale del propio planificador. Si mañana se programa un tercer
 * comando, la pantalla lo enseña sin que nadie toque nada.
 *
 * ## Por qué hace falta cruzar con los comandos registrados
 *
 * `Event::$command` no es el nombre del comando: es la línea entera que va a
 * ejecutarse —el binario de PHP, `artisan`, y luego el nombre—. Sacar el nombre
 * con una expresión regular sobre esa cadena funciona hasta que cambia el
 * formato. Cruzarlo con los comandos que la aplicación tiene registrados es
 * preguntárselo a las dos fuentes que lo saben de verdad.
 */
final class ScheduledTasks
{
    /**
     * Las tareas programadas, con su expresión de cron.
     *
     * @return list<array{command: string, expression: string}>
     */
    public static function all(): array
    {
        $registrados = array_keys(Artisan::all());
        $salida = [];

        foreach (app(Schedule::class)->events() as $evento) {
            $linea = (string) $evento->command;
            $nombre = null;

            foreach ($registrados as $candidato) {
                if ($candidato === '' || ! str_contains($linea, $candidato)) {
                    continue;
                }

                // El nombre más LARGO que aparece en la línea. Con el más
                // corto, `retention:sweep` podría casar con un hipotético
                // `retention` y la pantalla vigilaría la tarea equivocada.
                if ($nombre === null || mb_strlen($candidato) > mb_strlen($nombre)) {
                    $nombre = $candidato;
                }
            }

            if ($nombre === null) {
                continue;
            }

            $salida[] = ['command' => $nombre, 'expression' => (string) $evento->expression];
        }

        usort($salida, static fn (array $a, array $b): int => strcmp($a['command'], $b['command']));

        return $salida;
    }

    /**
     * Cuándo tendría que haber corrido esta tarea después de la vez que corrió.
     *
     * Nulo si la expresión no se entiende. Un fallo al leer el cron NO puede
     * convertirse en «va con retraso»: sería inventarse una alarma a partir de
     * no saber, que es peor que no dar ninguna.
     */
    public static function nextAfter(string $expression, DateTimeInterface $desde): ?DateTimeImmutable
    {
        try {
            return DateTimeImmutable::createFromInterface(
                (new CronExpression($expression))->getNextRunDate($desde)
            );
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * La cadencia en una palabra, para la pantalla.
     *
     * Se deduce de la expresión y no se guarda: una etiqueta escrita al lado de
     * un cron es una copia más que se separa del original.
     */
    public static function cadence(string $expression): string
    {
        $campos = preg_split('/\s+/', trim($expression)) ?: [];

        if (count($campos) !== 5) {
            return 'custom';
        }

        [$minuto, $hora, $dia, $mes, $semana] = $campos;

        // POR CAMPOS Y NO CON EXPRESIONES REGULARES APILADAS. La primera
        // versión ordenaba cuatro `preg_match` y clasificaba `0 * * * *` como
        // DIARIA, porque el `*` de la hora satisface un `\S+` igual que un
        // número. Un patrón que casa de más casa antes, y el orden de los
        // `match` acabó siendo la regla de verdad — que es justo lo que no se
        // ve al leerlo.
        $fijo = static fn (string $campo): bool => (bool) preg_match('/^\d+$/', $campo);
        $todo = static fn (string $campo): bool => $campo === '*';

        return match (true) {
            $fijo($minuto) && $todo($hora) && $todo($dia) && $todo($mes) && $todo($semana) => 'hourly',
            $fijo($hora) && $todo($dia) && $todo($mes) && $todo($semana) => 'daily',
            $fijo($hora) && $todo($dia) && $todo($mes) && ! $todo($semana) => 'weekly',
            $fijo($hora) && ! $todo($dia) && $todo($mes) && $todo($semana) => 'monthly',
            default => 'custom',
        };
    }
}
