<?php

declare(strict_types=1);

namespace App\Providers;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Listeners\ActivateVerifiedUser;
use App\Services\Billing\BillingProvider;
use App\Services\Billing\MockBillingProvider;
use App\Services\Billing\StripeBillingProvider;
use App\Services\Fmcsa\DirectoryFmcsaVerifier;
use App\Services\Fmcsa\FmcsaDirectory;
use App\Services\Fmcsa\FmcsaVerifier;
use App\Services\Fmcsa\MockFmcsaDirectory;
use App\Services\Fmcsa\MockFmcsaVerifier;
use App\Services\Fmcsa\QcMobileDirectory;
use App\Services\Malware\FileScanner;
use App\Services\Malware\UnavailableFileScanner;
use App\Services\Payments\InvoicePaymentProvider;
use App\Services\Payments\MockInvoicePaymentProvider;
use App\Services\Tracking\StopDerivedTrackingProvider;
use App\Services\Tracking\TrackingProvider;
use App\Support\Database\MillisecondGrammar;
use App\Support\Routing\RouteProvider;
use App\Support\Routing\StopDerivedRouteProvider;
use App\Support\Storage\DocumentStore;
use App\Support\Storage\LocalDocumentStore;
use App\Support\TenantContext;
use App\Translation\BraceTranslator;
use App\Translation\JsonNamespaceLoader;
use Illuminate\Auth\Events\Verified;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;
use Illuminate\Translation\FileLoader;
use Illuminate\Translation\Translator;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Se EXTIENDE el cargador de traducciones, no se re-liga.
        // TranslationServiceProvider es un proveedor diferido: se registra en el
        // momento en que alguien resuelve 'translation.loader', y al hacerlo
        // sobrescribiría cualquier singleton que hubiésemos atado antes. Con
        // extend() la sustitución ocurre después de que él construya el suyo.
        //
        // Se conservan sus rutas tal cual (paths() incluye la del propio
        // framework, con los mensajes de validación traducidos): reconstruirlas a
        // mano habría dejado fuera esa y roto validation.php sin previo aviso.
        $this->app->extend('translation.loader', fn (FileLoader $loader, $app) => new JsonNamespaceLoader(
            $app['files'],
            $loader->paths(),
        ));

        // Dónde viven los ficheros de los documentos. Hoy el disco del
        // servidor; el día que haya credenciales de S3, esta línea cambia de
        // clase y nada más se entera. Ver App\Support\Storage\DocumentStore.
        $this->app->singleton(DocumentStore::class, LocalDocumentStore::class);

        // De dónde sale el recorrido de una carga. Hoy se deduce de las paradas
        // y AVISA de lo que no sabe —los estados de paso, sobre todo—; el día
        // que haya un proveedor de rutas con credenciales, esta línea cambia de
        // clase. Ver App\Support\Routing\RouteProvider.
        $this->app->singleton(RouteProvider::class, StopDerivedRouteProvider::class);

        // De dónde salen las posiciones de un camión. Hoy de ninguna parte: el
        // adaptador deducido no reporta nada solo y lo dice —`isLive()` es
        // falso—, y lo que se ve en la pantalla lo escribe una persona de
        // despacho. El día que haya cuenta de Trucker Tools, MacroPoint o
        // Highway, esta línea cambia de clase y la ingesta no se entera.
        //
        // No se ata en función de una credencial como FMCSA o Stripe porque no
        // hay ninguna que mirar todavía: no existe el adaptador real. Cuando
        // exista, este `singleton` se parecerá a los otros dos.
        $this->app->singleton(TrackingProvider::class, StopDerivedTrackingProvider::class);

        // Quién mira los ficheros que se suben. Hoy nadie: el adaptador atado no
        // analiza y lo dice —devuelve `unavailable`, nunca `clean`—, y la
        // pantalla escribe con todas las letras que en esta instalación no se
        // analiza. El día que haya un ClamAV o una API con credenciales, esta
        // línea cambia de clase y ni los controladores ni las pantallas se
        // enteran: el veredicto pasa a ser `clean` o `infected` y el rechazo,
        // que ya está escrito, empieza a dispararse.
        //
        // NO se ata en función de una credencial, como el rastreo y por el mismo
        // motivo: todavía no existe el adaptador real que mirar.
        $this->app->singleton(FileScanner::class, UnavailableFileScanner::class);

        // Los diccionarios usan `{nombre}` porque los lee también el cliente.
        // Se sustituye el traductor para que `__()` los entienda igual — ver
        // BraceTranslator para por qué no basta con `:nombre`.
        //
        // extend() otra vez y por la misma razón que arriba: el proveedor de
        // traducción es diferido y sobrescribiría cualquier atadura previa.
        $this->app->extend('translator', function (Translator $original, $app): BraceTranslator {
            $translator = new BraceTranslator($original->getLoader(), $original->getLocale());
            $translator->setFallback($original->getFallback());

            return $translator;
        });

        // Uno por petición y por trabajo en cola. Que sea singleton es la razón
        // de que el scope global pueda leerlo sin pasárselo a cada consulta.
        $this->app->singleton(TenantContext::class);

        // Sin estado; se comparte por comodidad, no por necesidad.
        $this->app->singleton(PermissionChecker::class);

        // `scoped` y no `singleton`: cachea el Actor durante la petición, y el
        // contenedor lo tira al terminarla. Con singleton, bajo Octane la
        // siguiente petición heredaría el Actor de la anterior — el peor error
        // posible en un sistema multiempresa.
        $this->app->scoped(CurrentActor::class);

        // Sin credenciales de FMCSA se atan los adaptadores simulados, que se
        // identifican como tales en cada fila que escriben y en la pantalla. En
        // cuanto hay `FMCSA_WEBKEY` en el entorno se atan los reales, y no
        // cambia una línea de los controladores.
        //
        // La clave se lee de la configuración y no se pasa a ningún otro sitio:
        // ni al cliente, ni a un log, ni a la fila de verificación.
        $this->app->singleton(FmcsaDirectory::class, function ($app): FmcsaDirectory {
            $clave = (string) config('services.fmcsa.web_key', '');

            if (trim($clave) === '') {
                return new MockFmcsaDirectory;
            }

            return new QcMobileDirectory(
                $app->make(HttpFactory::class),
                $clave,
                (string) config('services.fmcsa.base_url', 'https://mobile.fmcsa.dot.gov/qc/services'),
            );
        });

        /*
         * El cobro de la suscripción.
         *
         * Simulado mientras no haya las DOS credenciales. Con solo la secreta y
         * sin la del webhook, el adaptador real cobraría y no se enteraría nunca
         * de que le pagaron: la persona pagaría y su suscripción seguiría en
         * `past_due`. Faltando cualquiera de las dos, mejor el simulacro — que
         * al menos no cobra.
         */
        $this->app->singleton(BillingProvider::class, function ($app): BillingProvider {
            $secreta = trim((string) config('services.stripe.secret', ''));
            $webhook = trim((string) config('services.stripe.webhook_secret', ''));

            if ($secreta === '' || $webhook === '') {
                return new MockBillingProvider;
            }

            return new StripeBillingProvider($app->make(HttpFactory::class), $secreta, $webhook);
        });

        /**
         * El cobro de las facturas de FLETE, que es otro dinero.
         *
         * `BillingProvider` es nosotros cobrándole la suscripción a la casa de
         * despacho; esto es la casa de despacho cobrándole el flete a su
         * cliente, y ese dinero va a la cuenta de ellos. Con Stripe eso es
         * Connect: otras credenciales, otra integración y otra responsabilidad.
         * Mientras no exista ese adaptador, el simulado — que no cobra y lo dice.
         */
        $this->app->singleton(
            InvoicePaymentProvider::class,
            static fn (): InvoicePaymentProvider => new MockInvoicePaymentProvider,
        );

        $this->app->bind(FmcsaVerifier::class, function ($app): FmcsaVerifier {
            $directory = $app->make(FmcsaDirectory::class);

            return $directory->isLive()
                ? new DirectoryFmcsaVerifier($directory)
                : new MockFmcsaVerifier;
        });
    }

    public function boot(): void
    {
        // Un acceso a una relación no cargada dispara N+1 en una lista de cargas
        // con veinte paradas. En local y en pruebas debe romper; en producción
        // no, porque una página rota es peor que una página lenta.
        Model::preventLazyLoading(! $this->app->isProduction());
        Model::preventSilentlyDiscardingAttributes(! $this->app->isProduction());

        $this->preserveMilliseconds();

        // Verificar el correo tiene que ACTIVAR la cuenta. Ver el listener: sin
        // esto, quien se da de alta por el formulario público verifica su correo
        // y sigue sin poder entrar, porque AttemptLogin mira `status` y la
        // verificación de Laravel solo tocaba `email_verified_at`.
        Event::listen(Verified::class, ActivateVerifiedUser::class);
    }

    /**
     * Que los INSERT en crudo escriban los milisegundos.
     *
     * Los modelos ya lo hacían por su `$dateFormat`; los `DB::table(...)` no,
     * porque ahí convierte la gramática de consultas y la de Laravel corta en
     * el segundo. Ver App\Support\Database\MillisecondGrammar.
     *
     * Aquí y no en cada sitio de escritura a propósito: hay treinta y nueve, y
     * el siguiente que alguien escriba también tiene que salir bien sin
     * acordarse de nada.
     */
    private function preserveMilliseconds(): void
    {
        $connection = $this->app['db']->connection();

        // Solo MySQL: la gramática hereda de la suya. Si algún día hay una
        // conexión de otro motor, esto la deja en paz en vez de romperla.
        if ($connection->getDriverName() !== 'mysql') {
            return;
        }

        $connection->setQueryGrammar(new MillisecondGrammar($connection));
    }
}
