<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\Auditing\Correlation;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Le pone un identificador a cada petición, para agrupar lo que escriba.
 *
 * Va el PRIMERO de la pila: cualquier cosa que ocurra después puede escribir en
 * la bitácora —resolver la empresa, comprobar un permiso, fallar una
 * validación— y todo eso pertenece al mismo acto.
 *
 * ## La cabecera del cliente se ignora
 *
 * `Audit::record()` leía `X-Request-Id` de la petición, que la manda quien
 * llama. Nadie la ponía, así que la columna era nula siempre; y si alguien la
 * hubiera puesto, quien hace la petición estaría eligiendo cómo se agrupan sus
 * propios eventos en una tabla que no admite correcciones. Ver
 * `Auditing\Correlation`.
 *
 * ## Y vuelve en la respuesta
 *
 * Para que sirva de algo fuera de la pantalla de auditoría: quien informa de un
 * problema puede dar ese número, y lleva directo a sus eventos y a las líneas
 * del registro del servidor de esa misma petición.
 */
final class AssignRequestId
{
    public function handle(Request $request, Closure $next): Response
    {
        $id = Correlation::iniciar($request);

        $respuesta = $next($request);
        $respuesta->headers->set(Correlation::CABECERA_DEL_CLIENTE, $id);

        return $respuesta;
    }
}
