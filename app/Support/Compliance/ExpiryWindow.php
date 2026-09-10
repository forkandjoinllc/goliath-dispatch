<?php

declare(strict_types=1);

namespace App\Support\Compliance;

use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;

/**
 * Con cuántos días de antelación avisa esta empresa de una caducidad.
 *
 * ## El defecto
 *
 * Ajustes deja fijar «Avisar de documentos por caducar (días)», con la nota
 * «Con cuánta antelación un documento cuenta como “caduca pronto”». Documentos
 * y el Panel lo respetaban. Conductores y Equipos llevaban esto:
 *
 *     private const WARN_DAYS = 45;
 *
 * Medido: se pone el ajuste en 20 días, y la pantalla de Conductores sigue
 * listando como «Por vencer» una licencia que caduca dentro de 30.
 *
 * ## Lo que hace peor el hallazgo
 *
 * El arreglo ya estaba escrito. El docblock de `DocumentController::warnDays()`
 * describe ESTE MISMO defecto y su solución:
 *
 * > Era una constante de 45 días que ignoraba esa columna — y la columna trae
 * > 30 por defecto, así que la aplicación avisaba con quince días más de los
 * > que la empresa había pedido. Los CUATRO sitios que lo usaban […] tienen que
 * > contestar lo mismo, o la lista y el contador se contradicen.
 *
 * Se corrigió en Documentos y se quedó ahí. Las dos pantallas que siguieron con
 * la constante son justo donde viven la CDL, la tarjeta médica, la matrícula y
 * la inspección: los papeles que paran un camión en la carretera, no los que
 * dan un aviso en una pantalla.
 *
 * ## Por qué una clase y no un tercer método privado
 *
 * Porque copiar `warnDays()` a dos controladores más deja tres sitios donde
 * volver a divergir, que es exactamente cómo se llegó hasta aquí. `PANTALLAS`
 * es el registro de quién tiene que contestar lo mismo, y el guardián falla si
 * aparece una pantalla nueva con su propio plazo o si alguna de estas se
 * descuelga.
 */
final class ExpiryWindow
{
    /**
     * Las pantallas que avisan de una caducidad y tienen que decir lo mismo.
     *
     * Pantalla => el fichero donde vive. Si mañana Permisos empieza a avisar de
     * caducidades con su propio número, el guardián lo dice antes de que una
     * empresa vea dos plazos distintos en el mismo producto.
     *
     * @var array<string, string>
     */
    public const PANTALLAS = [
        'documents' => 'app/Http/Controllers/App/DocumentController.php',
        'drivers' => 'app/Http/Controllers/App/DriverController.php',
        'equipment' => 'app/Http/Controllers/App/EquipmentController.php',
    ];

    /**
     * Los días que ha pedido la empresa activa.
     */
    public static function days(): int
    {
        return TenantPolicy::for(app(TenantContext::class)->id())->documentWarningDays;
    }

    /**
     * La fecha hasta la que algo «caduca pronto».
     */
    public static function limit(): CarbonImmutable
    {
        return CarbonImmutable::now()->addDays(self::days());
    }

    /**
     * La etiqueta de una fecha de caducidad: `expired`, `soon` o nada.
     *
     * Se comparan DÍAS y no marcas de tiempo: una licencia que caduca hoy a las
     * once de la noche no está caducada a las nueve de la mañana, y decirle a
     * un despachador que lo está le hace rechazar una carga que sí podía salir.
     */
    public static function flag(mixed $date): ?string
    {
        if ($date === null || $date === '') {
            return null;
        }

        $dias = CarbonImmutable::now()->startOfDay()
            ->diffInDays(CarbonImmutable::parse((string) $date)->startOfDay(), false);

        return match (true) {
            $dias < 0 => 'expired',
            $dias <= self::days() => 'soon',
            default => null,
        };
    }
}
