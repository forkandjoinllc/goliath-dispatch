<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\HasUuidKey;
use Illuminate\Database\Eloquent\Model;

/**
 * Lo común a los 92 modelos del esquema.
 *
 * Dos convenciones que no se negocian y por eso viven aquí:
 *
 *  • **Las marcas de tiempo son `datetime(3)` en UTC**, nunca `timestamp`. El
 *    tipo `timestamp` de MySQL muere en 2038 y este sistema guarda registros
 *    financieros siete años; una factura emitida en 2032 tiene vencimientos que
 *    ya rozan el límite. Ver docs/mysql-port.md.
 *
 *  • **El dinero son céntimos enteros con signo**, jamás un float. El signo hace
 *    falta: un margen y una liquidación pueden ser legítimamente negativos.
 */
abstract class BaseModel extends Model
{
    use HasUuidKey;

    protected $keyType = 'string';

    public $incrementing = false;

    /**
     * Formato con milisegundos, para que Eloquent escriba en `datetime(3)` sin
     * truncar. Con el formato por defecto ('Y-m-d H:i:s') se pierden los
     * milisegundos en cada escritura, y con ellos el orden de los eventos que
     * ocurren dentro del mismo segundo — que en una pista de auditoría es
     * justamente lo que se quiere poder demostrar.
     */
    protected $dateFormat = 'Y-m-d H:i:s.v';
}
