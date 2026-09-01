<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * El enlace público de una factura, y a quién se mandó.
 *
 * ## Por qué en `invoices` y no en una tabla aparte
 *
 * Una carga puede tener VARIOS enlaces de rastreo —uno por cada cliente al que
 * se le reparte— y por eso `public_tracking_links` es una tabla. Una factura
 * tiene UNO: va a quien la debe. Una tabla con una fila por factura sería una
 * tabla que solo sirve para hacer un JOIN más.
 *
 * ## Solo el hash
 *
 * Igual que los enlaces de rastreo y los vales de invitación: se guarda
 * `sha256` del testigo, nunca el testigo. Quien lea la base de datos —una copia
 * de seguridad, un volcado de soporte— no puede abrir la factura de nadie con lo
 * que ve. Y reenviar un enlace es imposible por construcción: hay que emitir uno
 * nuevo.
 *
 * ## La caducidad y por qué no es corta
 *
 * Un enlace de rastreo caduca en horas porque el viaje dura horas. Una factura
 * hay que poder pagarla mientras se deba: un enlace que caduca antes de que
 * alguien pague es una llamada a soporte y una factura que se cobra más tarde.
 * Caduca noventa días DESPUÉS del vencimiento, que es tiempo de sobra para el
 * plazo de pago más generoso, y sigue siendo una caducidad — un testigo al
 * portador que no caduca nunca es un testigo que acaba en el historial de
 * alguien para siempre.
 *
 * ## `sent_to`
 *
 * `sent_at` ya existía y dice CUÁNDO. Sin la dirección, a un cliente que llama
 * diciendo que no le llegó la factura solo se le puede contestar «pues salió».
 * Es la misma lección del enlace de rastreo del lote 59, aplicada antes de
 * tropezar con ella otra vez.
 */
return new class extends Migration
{
    private const COLUMNAS = ['public_token_hash', 'public_token_expires_at', 'sent_to'];

    public function up(): void
    {
        if (Schema::hasColumn('invoices', 'public_token_hash')) {
            return;
        }

        Schema::table('invoices', function (Blueprint $table): void {
            $table->char('public_token_hash', 64)->nullable()->after('sent_at');
            $table->dateTime('public_token_expires_at', 3)->nullable()->after('public_token_hash');
            $table->string('sent_to', 255)->nullable()->after('public_token_expires_at');
        });

        // La búsqueda por testigo va por igualdad exacta del hash y ocurre en
        // cada visita del cliente: sin índice es un recorrido de toda la tabla
        // de facturas por cada carga de la página.
        Schema::table('invoices', function (Blueprint $table): void {
            $table->index('public_token_hash', 'invoices_public_token_idx');
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('invoices', 'public_token_hash')) {
            return;
        }

        Schema::table('invoices', function (Blueprint $table): void {
            $table->dropIndex('invoices_public_token_idx');
            $table->dropColumn(self::COLUMNAS);
        });
    }
};
