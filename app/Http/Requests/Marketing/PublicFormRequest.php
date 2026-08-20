<?php

declare(strict_types=1);

namespace App\Http\Requests\Marketing;

use App\Support\Forms\FormToken;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Validator;

/**
 * Lo común a los tres formularios públicos: campo trampa y sello firmado.
 *
 * Las tres defensas —trampa, sello y límite por IP— corren en el SERVIDOR. Un bot
 * que no ejecuta nada del JavaScript y hace el POST directamente pasa por las
 * tres igual. Cualquier comprobación que viviera en el cliente sería decorativa.
 *
 * El rechazo por spam NO dice que fue por spam: devuelve un error de validación
 * genérico en el campo del correo. Decirle a un bot cuál de las tres defensas lo
 * paró es enseñarle a rodearla.
 */
abstract class PublicFormRequest extends FormRequest
{
    abstract protected function formName(): string;

    /** @return array<string, mixed> */
    abstract protected function fieldRules(): array;

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    final public function rules(): array
    {
        return [
            ...$this->fieldRules(),
            // Presente pero vacío: si falta del todo, el POST no viene de nuestra
            // página. Si viene con algo, lo rellenó un script.
            'hp_field' => ['present', 'max:0'],
            'form_token' => ['required', 'string', 'max:400'],
        ];
    }

    /** @return array<string, string> */
    public function attributes(): array
    {
        $out = [];

        foreach (array_keys($this->fieldRules()) as $field) {
            $key = 'marketing.forms.labels.'.lcfirst(str_replace(' ', '', ucwords(str_replace('_', ' ', $field))));
            if (__($key) !== $key) {
                $out[$field] = mb_strtolower((string) __($key));
            }
        }

        return $out;
    }

    protected function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $result = FormToken::verify($this->input('form_token'), $this->formName());

            if ($result['valid']) {
                return;
            }

            // Se registra el motivo real para poder ver patrones de abuso, pero
            // no se le devuelve al cliente.
            Log::info('formulario público rechazado', [
                'form' => $this->formName(),
                'reason' => $result['reason'] ?? 'unknown',
                'ip' => $this->ip(),
            ]);

            $validator->errors()->add('email', (string) __('marketing.forms.errors.rejected'));
        });
    }
}
