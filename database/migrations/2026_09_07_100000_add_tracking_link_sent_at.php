<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * `public_tracking_links.sent_at`: cuándo salió el correo con este enlace.
 *
 * La tabla ya llevaba `recipient_email` desde el primer día — el formulario lo
 * pide, se guarda, y no se usaba para nada porque no había envío. Ahora que lo
 * hay, la dirección sola no basta: hace falta saber si el correo SALIÓ.
 *
 * La diferencia importa cuando un cliente llama diciendo que no le llegó nada.
 * Con la dirección sola solo se puede contestar «a esa dirección era»; con la
 * fecha se puede contestar «salió el martes a las 9:14, mire en el correo no
 * deseado» o «no salió, se lo mando ahora» — y son dos conversaciones
 * completamente distintas.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('public_tracking_links', 'sent_at')) {
            return;
        }

        Schema::table('public_tracking_links', function (Blueprint $table): void {
            $table->dateTime('sent_at', 3)->nullable()->after('recipient_email');
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('public_tracking_links', 'sent_at')) {
            return;
        }

        Schema::table('public_tracking_links', function (Blueprint $table): void {
            $table->dropColumn('sent_at');
        });
    }
};
