<?php

declare(strict_types=1);

use App\Models\BaseModel;
use App\Models\Scopes\TenantScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Los 90 modelos se generaron a partir de information_schema. Esta prueba
 * comprueba lo contrario: que lo que los modelos DICEN siga existiendo en la
 * base de datos. Es la prueba que se rompe cuando alguien renombra una columna
 * en el esquema y se olvida del modelo — es decir, la que hace que el generador
 * no sea una foto de un momento sino un contrato.
 */

/** @return list<class-string<Model>> */
function allModels(): array
{
    $classes = [];
    foreach (glob(base_path('app/Models/*.php')) as $file) {
        $class = 'App\\Models\\'.basename($file, '.php');
        if (! class_exists($class)) {
            continue;
        }
        $ref = new ReflectionClass($class);
        if ($ref->isAbstract() || ! $ref->isSubclassOf(Model::class)) {
            continue;
        }
        $classes[] = $class;
    }
    sort($classes);

    return $classes;
}

it('encuentra los 95 modelos esperados', function () {
    // 90 generados desde information_schema + User y Session escritos a mano,
    // que no encajan en las convenciones de BaseModel.
    // 95 desde que existen FactoringCompanyContact, CarrierContact y
    // LoadRequirement. El número está a propósito: un modelo nuevo sin su
    // tabla, o una tabla nueva sin su modelo, se nota aquí antes que en
    // producción.
    expect(allModels())->toHaveCount(95);
});

it('la tabla de cada modelo existe', function () {
    foreach (allModels() as $class) {
        $table = (new $class)->getTable();
        expect(Schema::hasTable($table))->toBeTrue("{$class} apunta a la tabla inexistente {$table}");
    }
});

it('toda columna en fillable existe en la tabla', function () {
    $problems = [];
    foreach (allModels() as $class) {
        $model = new $class;
        $columns = Schema::getColumnListing($model->getTable());
        foreach ($model->getFillable() as $column) {
            if (! in_array($column, $columns, true)) {
                $problems[] = "{$class}::\$fillable tiene '{$column}', que no está en {$model->getTable()}";
            }
        }
    }
    expect($problems)->toBe([], implode("\n", $problems));
});

it('toda columna con cast existe en la tabla', function () {
    $problems = [];
    foreach (allModels() as $class) {
        $model = new $class;
        $columns = Schema::getColumnListing($model->getTable());
        foreach (array_keys($model->getCasts()) as $column) {
            if ($column === $model->getKeyName()) {
                continue;
            }
            if (! in_array($column, $columns, true)) {
                $problems[] = "{$class} castea '{$column}', que no está en {$model->getTable()}";
            }
        }
    }
    expect($problems)->toBe([], implode("\n", $problems));
});

it('ninguna columna generada es escribible', function () {
    // Una columna STORED la calcula MySQL. Si estuviera en fillable, un
    // create() con ese atributo fallaría con ERROR 3105 en el peor momento.
    $generated = DB::table('information_schema.columns')
        ->selectRaw('TABLE_NAME as tbl, COLUMN_NAME as name')
        ->where('table_schema', DB::getDatabaseName())
        ->whereRaw("generation_expression <> ''")
        ->get()
        ->groupBy('tbl')
        ->map(fn ($rows) => $rows->pluck('name')->all());

    $problems = [];
    foreach (allModels() as $class) {
        $model = new $class;
        foreach ($generated[$model->getTable()] ?? [] as $column) {
            if (in_array($column, $model->getFillable(), true)) {
                $problems[] = "{$class}::\$fillable incluye la columna generada '{$column}'";
            }
        }
    }
    expect($problems)->toBe([], implode("\n", $problems));
});

it('toda columna NOT NULL sin default está en fillable o la rellena el modelo', function () {
    $problems = [];
    foreach (allModels() as $class) {
        $model = new $class;
        $required = DB::table('information_schema.columns')
            ->where('table_schema', DB::getDatabaseName())
            ->where('table_name', $model->getTable())
            ->where('is_nullable', 'NO')
            ->whereNull('column_default')
            // MySQL 8 devuelve las columnas de information_schema en
            // MAYÚSCULAS; hay que aliasarlas o pluck() no encuentra nada.
            ->selectRaw('COLUMN_NAME as name')
            ->pluck('name');

        foreach ($required as $column) {
            if ($column === $model->getKeyName()) {
                continue; // lo pone HasUuidKey
            }
            if (in_array($column, ['created_at', 'updated_at'], true)) {
                continue; // los pone Eloquent
            }
            // Exenciones declaradas por el propio modelo, con su motivo al lado.
            $exempt = defined("{$class}::WRITTEN_BY_FRAMEWORK")
                ? constant("{$class}::WRITTEN_BY_FRAMEWORK")
                : [];
            if (in_array($column, $exempt, true)) {
                continue;
            }
            if (! in_array($column, $model->getFillable(), true)) {
                $problems[] = "{$model->getTable()}.{$column} es NOT NULL sin default y {$class} no lo puede rellenar";
            }
        }
    }
    expect($problems)->toBe([], implode("\n", $problems));
});

it('toda relación declarada apunta a una columna y un modelo reales', function () {
    $problems = [];
    foreach (allModels() as $class) {
        $model = new $class;
        foreach ((new ReflectionClass($class))->getMethods(ReflectionMethod::IS_PUBLIC) as $method) {
            if ($method->class !== $class || $method->getNumberOfParameters() > 0) {
                continue;
            }
            $returns = (string) $method->getReturnType();
            if (! is_subclass_of($returns, Relation::class)) {
                continue;
            }
            try {
                $relation = $model->{$method->name}();
            } catch (Throwable $e) {
                $problems[] = "{$class}::{$method->name}() lanzó: {$e->getMessage()}";

                continue;
            }
            $related = $relation->getRelated();
            if (! Schema::hasTable($related->getTable())) {
                $problems[] = "{$class}::{$method->name}() apunta a la tabla inexistente {$related->getTable()}";
            }
        }
    }
    expect($problems)->toBe([], implode("\n", $problems));
});

it('los modelos con tenant_id llevan el scope global y los demás no', function () {
    $problems = [];
    foreach (allModels() as $class) {
        $model = new $class;
        $hasColumn = Schema::hasColumn($model->getTable(), 'tenant_id');
        $hasScope = array_key_exists(
            TenantScope::class,
            $model->getGlobalScopes()
        );

        if ($hasColumn && ! $hasScope) {
            $problems[] = "{$class} tiene tenant_id pero NO lleva TenantScope — fuga entre empresas";
        }
        if (! $hasColumn && $hasScope) {
            $problems[] = "{$class} lleva TenantScope pero su tabla no tiene tenant_id — toda consulta fallará";
        }
    }
    expect($problems)->toBe([], implode("\n", $problems));
});

it('los modelos con deleted_at usan SoftDeletes', function () {
    $problems = [];
    foreach (allModels() as $class) {
        $model = new $class;
        $hasColumn = Schema::hasColumn($model->getTable(), 'deleted_at');
        $usesTrait = in_array(
            SoftDeletes::class,
            class_uses_recursive($class),
            true
        );

        if ($hasColumn && ! $usesTrait) {
            $problems[] = "{$class} tiene deleted_at pero delete() borraría de verdad";
        }
        if (! $hasColumn && $usesTrait) {
            $problems[] = "{$class} usa SoftDeletes sin columna deleted_at";
        }
    }
    expect($problems)->toBe([], implode("\n", $problems));
});

it('las claves primarias son char(36) no incrementales', function () {
    foreach (allModels() as $class) {
        $model = new $class;
        expect($model->getIncrementing())->toBeFalse("{$class} se cree autoincremental");
        expect($model->getKeyType())->toBe('string', "{$class} declara una clave no textual");
    }
});

it('el formato de fecha conserva los milisegundos', function () {
    // Sin esto, dos eventos de auditoría del mismo segundo pierden su orden.
    foreach (allModels() as $class) {
        $model = new $class;
        if (! $model->usesTimestamps()) {
            continue;
        }
        expect($model->getDateFormat())->toBe(
            'Y-m-d H:i:s.v',
            "{$class} truncaría los milisegundos al escribir en datetime(3)"
        );
    }
});
