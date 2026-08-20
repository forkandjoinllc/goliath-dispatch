<?php

declare(strict_types=1);

namespace App\Models\Concerns;

use Illuminate\Support\Str;

/**
 * Claves primarias UUID en `char(36)`.
 *
 * Se eligió char(36) y no binary(16) a propósito: pesa 20 bytes más por fila,
 * pero el id se lee en un log, en un `SELECT` a mano y en una URL sin
 * convertirlo. En un sistema donde el soporte pasa el día persiguiendo cargas
 * concretas, eso vale más que el espacio. Ver docs/mysql-port.md.
 */
trait HasUuidKey
{
    public static function bootHasUuidKey(): void
    {
        static::creating(function (self $model): void {
            if ($model->getKey() === null) {
                $model->setAttribute($model->getKeyName(), (string) Str::uuid());
            }
        });
    }

    public function getIncrementing(): bool
    {
        return false;
    }

    public function getKeyType(): string
    {
        return 'string';
    }
}
