<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Storage\DocumentStore;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Support\Scenario;

/**
 * Una foto del equipo se puede mirar.
 *
 * Habia ruta para SUBIRLA y ruta para BORRARLA, y ninguna para verla. Los
 * cuatro angulos son la puerta de `Equipment\Eligibility` y la pagina publica
 * los promete: una foto que nadie puede mirar no documenta el camion, documenta
 * que alguien subio un fichero de ese tamano.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    // `crew()` es quien siembra el camion con sus cuatro fotos.
    $this->scenario->crew($this->scenario->load);
});

afterEach(fn () => app(TenantContext::class)->forget());

/** El camion del escenario, que ya viene con sus cuatro fotos sembradas. */
function camionConFotos(Scenario $s): array
{
    $camion = (string) app(TenantContext::class)->withoutTenant(fn () => DB::table('trucks')
        ->where('tenant_id', $s->tenant->id)->value('id'));

    $foto = app(TenantContext::class)->withoutTenant(fn () => DB::table('equipment_media')
        ->where('equipment_id', $camion)->where('angle', 'front')->first(['id', 'storage_key']));

    return [$camion, (string) $foto->id, (string) $foto->storage_key];
}

/**
 * Pone un fichero de verdad detras de una foto sembrada.
 *
 * El escenario siembra `pruebas/...` como clave, y `DocumentFileController`
 * solo sirve claves que empiezan por `documents/` —defensa en profundidad, para
 * que una URL firmada mal generada no saque nada de fuera de ahi—. Las claves
 * reales las escribe `DocumentStore::put()`, que ya usa ese prefijo; aqui se
 * imita.
 */
function ponerFichero(string $fotoId): void
{
    $clave = 'documents/pruebas/'.$fotoId.'.jpg';

    Storage::disk('local')->put($clave, "\xff\xd8\xff\xe0JFIF-de-prueba");

    app(TenantContext::class)->withoutTenant(fn () => DB::table('equipment_media')
        ->where('id', $fotoId)->update(['storage_key' => $clave, 'updated_at' => now()]));
}

it('la ficha manda una ruta para cada foto', function (): void {
    // ESTE ES EL FALLO. Antes llegaba el angulo, la fecha y el tamano, y nada
    // que pulsar: la pantalla no tenia a donde enlazar porque no habia ruta.
    signIn($this->scenario, Role::Admin);
    [$camion, $foto] = camionConFotos($this->scenario);

    $this->get("/equipment/trucks/{$camion}")->assertInertia(fn ($page) => $page
        ->where('media.photos', fn ($fotos) => collect($fotos)->contains(
            fn (array $f): bool => $f['href'] === "/equipment/trucks/{$camion}/media/{$foto}",
        )));
});

it('quien puede abrir la ficha puede mirar la foto', function (): void {
    signIn($this->scenario, Role::Admin);
    [$camion, $foto] = camionConFotos($this->scenario);
    ponerFichero($foto);

    $r = $this->get("/equipment/trucks/{$camion}/media/{$foto}");
    $r->assertRedirect();

    // Y la ruta firmada del almacen sirve el fichero de verdad.
    $this->get($r->headers->get('Location'))->assertOk();
});

it('mirar la foto NO pide el permiso de subirla', function (): void {
    // Pedir `media:upload` para MIRARLA dejaria fuera justo a quien tiene que
    // comprobar que los cuatro lados estan.
    //
    // Contabilidad es el rol que lo demuestra: tiene `equipment:read` y NO
    // tiene `equipment:media:upload`. Con el despachador esta prueba no media
    // nada —los tiene los dos— y un sabotaje que cambiaba el permiso se quedo
    // en verde.
    signIn($this->scenario, Role::Admin);
    [$camion, $foto] = camionConFotos($this->scenario);
    ponerFichero($foto);

    signIn($this->scenario, Role::Accounting);

    $this->get("/equipment/trucks/{$camion}")->assertInertia(fn ($page) => $page
        ->where('can.uploadMedia', false));

    $this->get("/equipment/trucks/{$camion}/media/{$foto}")->assertRedirect();
});

it('la foto se sirve para mirarla, no para bajarla', function (): void {
    // «Ver la foto» que descarga un fichero con nombre aleatorio no es ver la
    // foto. Se sirve `inline` y con un nombre que dice lo que es: el angulo.
    signIn($this->scenario, Role::Admin);
    [$camion, $foto] = camionConFotos($this->scenario);
    ponerFichero($foto);

    $r = $this->get("/equipment/trucks/{$camion}/media/{$foto}");
    $fichero = $this->get($r->headers->get('Location'));

    expect($fichero->headers->get('content-disposition'))
        ->toContain('inline')
        ->toContain('front.jpg');
});

it('la foto se cruza con SU unidad', function (): void {
    // Sin el cruce, el id de una foto de otro camion emparejado con una ficha
    // que si se puede abrir serviria el fichero.
    signIn($this->scenario, Role::Admin);
    [, $foto] = camionConFotos($this->scenario);
    ponerFichero($foto);

    $remolque = (string) app(TenantContext::class)->withoutTenant(fn () => DB::table('trailers')
        ->where('tenant_id', $this->scenario->tenant->id)->value('id'));

    $this->get("/equipment/trailers/{$remolque}/media/{$foto}")->assertNotFound();
});

it('si la foto no esta en el almacen, lo dice', function (): void {
    // La pantalla de retencion lleva contando «filas que nombran un fichero que
    // no esta» y diciendo que «cada una es un boton de descarga que va a
    // fallar». Desde este lote esos botones existen de verdad.
    signIn($this->scenario, Role::Admin);
    [$camion, $foto, $clave] = camionConFotos($this->scenario);

    app(DocumentStore::class)->delete($clave);

    $this->get("/equipment/trucks/{$camion}/media/{$foto}")
        ->assertSessionHas('error', __('equipment.media.fileMissing'));
});
