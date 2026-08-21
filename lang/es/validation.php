<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Mensajes de validación del servidor
|--------------------------------------------------------------------------
|
| Estos son los de LARAVEL, no los de la aplicación. La diferencia importa y
| explica por qué faltaban: `lang/es/validation.json` ya existía y traduce los
| textos que enseña React, pero el validador de PHP busca `validation.php` — un
| array, no un JSON — y al no encontrarlo caía al inglés.
|
| El síntoma: un despachador que trabaja en español rellenaba cualquier
| formulario mal y recibía «The file field must be a file of type…». No solo en
| documentos: en TODOS los formularios de la aplicación, desde el primer día.
|
| Se traducen solo las reglas que este sistema usa de verdad. Las cien de
| Laravel completas serían ruido: nadie las va a leer y las que faltan siguen
| saliendo en inglés, que es exactamente lo que pasa hoy con todas.
|
*/

return [
    'accepted' => 'Debe aceptar el campo :attribute.',
    'after' => 'El campo :attribute debe ser posterior a :date.',
    'after_or_equal' => 'El campo :attribute debe ser igual o posterior a :date.',
    'array' => 'El campo :attribute debe ser una lista.',
    'before' => 'El campo :attribute debe ser anterior a :date.',
    'before_or_equal' => 'El campo :attribute debe ser igual o anterior a :date.',
    'between' => [
        'array' => 'El campo :attribute debe tener entre :min y :max elementos.',
        'file' => 'El campo :attribute debe pesar entre :min y :max kilobytes.',
        'numeric' => 'El campo :attribute debe estar entre :min y :max.',
        'string' => 'El campo :attribute debe tener entre :min y :max caracteres.',
    ],
    'boolean' => 'El campo :attribute debe ser verdadero o falso.',
    'confirmed' => 'El campo :attribute no coincide con su confirmación.',
    'current_password' => 'La contraseña es incorrecta.',
    'date' => 'El campo :attribute no es una fecha válida.',
    'date_equals' => 'El campo :attribute debe ser :date.',
    'date_format' => 'El campo :attribute no corresponde con el formato :format.',
    'different' => 'El campo :attribute y :other deben ser distintos.',
    'digits' => 'El campo :attribute debe tener :digits dígitos.',
    'digits_between' => 'El campo :attribute debe tener entre :min y :max dígitos.',
    'email' => 'El campo :attribute no es un correo electrónico válido.',
    'exists' => 'El campo :attribute no existe.',
    'file' => 'El campo :attribute debe ser un archivo.',
    'filled' => 'El campo :attribute no puede quedar en blanco.',
    'gt' => [
        'numeric' => 'El campo :attribute debe ser mayor que :value.',
        'string' => 'El campo :attribute debe tener más de :value caracteres.',
    ],
    'gte' => [
        'numeric' => 'El campo :attribute debe ser igual o mayor que :value.',
        'string' => 'El campo :attribute debe tener :value caracteres o más.',
    ],
    'image' => 'El campo :attribute debe ser una imagen.',
    'in' => 'El campo :attribute no es un valor permitido.',
    'integer' => 'El campo :attribute debe ser un número entero.',
    'lt' => [
        'numeric' => 'El campo :attribute debe ser menor que :value.',
        'string' => 'El campo :attribute debe tener menos de :value caracteres.',
    ],
    'lte' => [
        'numeric' => 'El campo :attribute debe ser igual o menor que :value.',
        'string' => 'El campo :attribute debe tener :value caracteres o menos.',
    ],
    'max' => [
        'array' => 'El campo :attribute no puede tener más de :max elementos.',
        'file' => 'El campo :attribute no puede pesar más de :max kilobytes.',
        'numeric' => 'El campo :attribute no puede ser mayor que :max.',
        'string' => 'El campo :attribute no puede tener más de :max caracteres.',
    ],
    // El mensaje que apareció al probar la subida de documentos, y el que
    // destapó que faltaba este fichero entero.
    'mimes' => 'El campo :attribute debe ser un archivo de tipo: :values.',
    'mimetypes' => 'El campo :attribute debe ser un archivo de tipo: :values.',
    'min' => [
        'array' => 'El campo :attribute debe tener al menos :min elementos.',
        'file' => 'El campo :attribute debe pesar al menos :min kilobytes.',
        'numeric' => 'El campo :attribute debe ser al menos :min.',
        'string' => 'El campo :attribute debe tener al menos :min caracteres.',
    ],
    'not_in' => 'El campo :attribute no es un valor permitido.',
    'numeric' => 'El campo :attribute debe ser un número.',
    'present' => 'El campo :attribute debe estar presente.',
    'prohibited' => 'El campo :attribute no se permite.',
    'regex' => 'El campo :attribute no tiene un formato válido.',
    // Todos los mensajes empiezan por «El campo». No es palabrería: el español
    // concuerda en género y Laravel solo sustituye una cadena, así que
    // «:attribute es obligatorio» daba «La razón social es obligatorio».
    // Anteponer un sustantivo masculino fijo hace que el género de :attribute
    // deje de importar, y por eso los nombres de abajo van SIN artículo.
    'required' => 'El campo :attribute es obligatorio.',
    'required_if' => 'El campo :attribute es obligatorio cuando :other es :value.',
    'required_with' => 'El campo :attribute es obligatorio cuando hay :values.',
    'required_without' => 'El campo :attribute es obligatorio cuando no hay :values.',
    'same' => 'El campo :attribute y :other deben coincidir.',
    'size' => [
        'array' => 'El campo :attribute debe contener :size elementos.',
        'file' => 'El campo :attribute debe pesar :size kilobytes.',
        'numeric' => 'El campo :attribute debe ser :size.',
        'string' => 'El campo :attribute debe tener :size caracteres.',
    ],
    'string' => 'El campo :attribute debe ser texto.',
    'unique' => 'El campo :attribute ya está en uso.',
    'uploaded' => 'El campo :attribute no se pudo subir. Puede que sea demasiado grande.',
    'url' => 'El campo :attribute no es una dirección web válida.',
    'uuid' => 'El campo :attribute no es un identificador válido.',

    /*
    |--------------------------------------------------------------------------
    | Nombres de los campos
    |--------------------------------------------------------------------------
    |
    | Sin esto, un mensaje sale como «El campo customer_id es obligatorio», que
    | es el nombre de una columna y no significa nada para quien rellena el
    | formulario.
    |
    | Van SIN artículo: se lo pone el mensaje. Ver la nota de arriba.
    |
    */
    'attributes' => [
        'file' => 'archivo',
        'email' => 'correo electrónico',
        'password' => 'contraseña',
        'phone' => 'teléfono',
        'first_name' => 'nombre',
        'last_name' => 'apellidos',
        'legal_name' => 'razón social',
        'company_name' => 'razón social',
        'dot_number' => 'número USDOT',
        'customer_id' => 'cliente',
        'carrier_id' => 'transportista',
        'owner_id' => 'dueño',
        'owner_type' => 'clase de dueño',
        'document_type' => 'tipo de documento',
        'unit_number' => 'número de unidad',
        'vin' => 'VIN',
        'license_number' => 'número de licencia',
        'license_state' => 'estado emisor',
        'license_expires_at' => 'vencimiento de la licencia',
        'medical_card_expires_at' => 'vencimiento de la tarjeta médica',
        'expiration_date' => 'fecha de vencimiento',
        'issue_date' => 'fecha de emisión',
        'planned_pickup_at' => 'recogida planificada',
        'planned_delivery_at' => 'entrega planificada',
        'customer_charge_cents' => 'cobro al cliente',
        'carrier_gross_rate_cents' => 'tarifa del transportista',
        'carrier_dispatch_fee_bps' => 'tarifa de despacho',
        'dispatcher_commission_bps' => 'comisión del despachador',
        'stops' => 'paradas',
        'reason' => 'motivo',
        'notes' => 'notas',
        'status' => 'estado',
        'title' => 'título',
        'commodity' => 'mercancía',
        'weight_pounds' => 'peso',
        'plate_state' => 'estado de la placa',
        'registration_expires_at' => 'vencimiento de la matrícula',
    ],
];
