<?php

declare(strict_types=1);

namespace App\Authorization;

/**
 * Las descripciones de permiso en castellano.
 *
 * Van en su propio fichero y no dentro de Permissions porque ese catálogo se
 * verifica clave a clave contra el original TypeScript
 * (src/lib/permissions/catalog.ts) y debe seguir siendo un espejo exacto de él.
 * Las traducciones son añadido nuestro, no parte del original.
 *
 * La aplicación es bilingüe por requisito: estas cadenas se muestran en la
 * pantalla de permisos por usuario, donde un administrador decide qué concede.
 * Traducir mal aquí es conceder mal.
 */
final class PermissionDescriptionsEs
{
    /** @var array<string, string> */
    public const ALL = [
        'platform:tenant:read' => 'Ver cualquier empresa de la plataforma',
        'platform:tenant:create' => 'Crear una empresa',
        'platform:tenant:suspend' => 'Suspender o reactivar una empresa',
        'platform:tenant:support_access' => 'Abrir una sesión de soporte explícita dentro de una empresa',
        'platform:plan:read' => 'Ver los planes SaaS y el estado de las suscripciones',
        'platform:plan:manage' => 'Crear y editar planes SaaS',
        'platform:health:read' => 'Ver el estado y el uso de la plataforma',
        'platform:impersonate' => 'Suplantar a un usuario de una empresa',
        'tenant:settings:read' => 'Ver los ajustes de la empresa',
        'tenant:settings:update' => 'Cambiar ajustes, identidad visual y plantillas de la empresa',
        'tenant:user:read' => 'Ver los usuarios de la empresa',
        'tenant:user:invite' => 'Invitar a un usuario',
        'tenant:user:update' => 'Editar un usuario, su rol o su estado',
        'tenant:user:suspend' => 'Suspender o reactivar a un usuario',
        'tenant:impersonate' => 'Suplantar a un usuario dentro de la empresa',
        'tenant:integration:read' => 'Ver las conexiones con servicios externos',
        'tenant:integration:update' => 'Configurar credenciales de servicios externos',
        'tenant:billing:read' => 'Ver la suscripción y las facturas de la empresa',
        'tenant:billing:update' => 'Cambiar la suscripción de la empresa',
        'assignment:read' => 'Ver las asignaciones y los grupos de despachadores',
        'assignment:manage' => 'Asignar transportistas, equipo, conductores y grupos a despachadores',
        'assignment:commission:update' => 'Fijar los porcentajes de comisión de los despachadores',
        'carrier:read' => 'Ver transportistas',
        'carrier:create' => 'Crear un transportista',
        'carrier:update' => 'Editar los datos de la empresa transportista',
        'carrier:delete' => 'Borrar en suave un transportista',
        'carrier:fee:update' => 'Fijar el porcentaje de tarifa de despacho del transportista',
        'carrier:onboarding:read' => 'Ver el estado y la lista de comprobación del alta',
        'carrier:onboarding:submit' => 'Enviar el alta a revisión',
        'carrier:onboarding:review' => 'Mover el alta entre estados de revisión',
        'carrier:onboarding:approve' => 'Aprobar o rechazar el alta de un transportista',
        'carrier:verification:read' => 'Ver los resultados de la verificación FMCSA',
        'carrier:verification:run' => 'Lanzar una verificación FMCSA',
        'carrier:verification:override' => 'Anular manualmente una verificación fallida, con motivo',
        'document:read' => 'Ver los metadatos de un documento',
        'document:download' => 'Descargar el fichero del documento',
        'document:upload' => 'Subir un documento o una versión nueva',
        'document:review' => 'Aprobar o rechazar un documento',
        'document:delete' => 'Borrar en suave un documento',
        'signature:template:read' => 'Ver las plantillas de firma',
        'signature:template:manage' => 'Crear y versionar plantillas de firma',
        'signature:request:create' => 'Enviar una solicitud de firma',
        'signature:request:read' => 'Ver las solicitudes de firma y su estado',
        'signature:sign' => 'Firmar un documento dirigido a ti',
        'signature:void' => 'Anular una solicitud de firma',
        'signature:certificate:download' => 'Descargar el certificado de auditoría',
        'equipment:read' => 'Ver camiones y remolques',
        'equipment:create' => 'Añadir un camión o un remolque',
        'equipment:update' => 'Editar un camión o un remolque',
        'equipment:status:update' => 'Cambiar el estado del equipo (activo / fuera de servicio)',
        'equipment:verification:override' => 'Aprobar equipo pese a una discrepancia de COI o VIN',
        'equipment:type:manage' => 'Añadir o editar tipos de remolque y de equipo',
        'equipment:media:upload' => 'Subir fotos y vídeo del equipo',
        'driver:read' => 'Ver conductores',
        'driver:create' => 'Añadir un conductor',
        'driver:update' => 'Editar un conductor',
        'driver:approve' => 'Aprobar a un conductor tras revisar su licencia',
        'driver:self:update' => 'Editar tu propio perfil de conductor y tus documentos',
        'customer:read' => 'Ver clientes y contactos',
        'customer:create' => 'Crear un cliente',
        'customer:update' => 'Editar un cliente o un contacto',
        'customer:duplicate:override' => 'Crear un cliente pese al aviso de duplicado',
        'customer:delete' => 'Borrar en suave un cliente',
        'load:read' => 'Ver cargas',
        'load:create' => 'Crear una carga',
        'load:update' => 'Editar los detalles de una carga',
        'load:status:update' => 'Cambiar el estado de una carga',
        'load:cancel' => 'Cancelar una carga',
        'load:duplicate' => 'Duplicar una carga',
        'load:assign_resources' => 'Asignar camiones, remolques y conductores a una carga',
        'load:assign_carrier' => 'Asignar el transportista de una carga',
        'load:financials:read' => 'Ver las cifras financieras de una carga',
        'load:financials:update' => 'Editar tarifas y porcentajes de una carga',
        'load:rateconf:respond' => 'Aceptar, rechazar o pedir cambios en una confirmación de tarifa',
        'load:document:upload' => 'Subir documentos de carga (BOL, POD, recibos)',
        'route:calculate' => 'Calcular o recalcular una ruta',
        'oversize:evaluate' => 'Ejecutar una evaluación de sobredimensión o sobrepeso',
        'oversize:validate' => 'Dar el visto bueno a una evaluación de sobredimensión',
        'oversize:rule:manage' => 'Editar las reglas estatales de sobredimensión',
        'permit:read' => 'Ver permisos y escoltas',
        'permit:manage' => 'Crear y editar permisos y escoltas',
        'permit:approve_ready' => 'Aprobar una carga como lista de permisos para despacho',
        'tracking:read' => 'Ver las sesiones de seguimiento y el historial de ubicación',
        'tracking:manage' => 'Iniciar, detener y reconfigurar el seguimiento de una carga',
        'tracking:consent' => 'Conceder o revocar tu propio consentimiento de seguimiento',
        'tracking:link:create' => 'Crear un enlace público de seguimiento para el cliente',
        'tracking:link:revoke' => 'Revocar un enlace público de seguimiento',
        'message:read' => 'Leer las conversaciones en las que participas',
        'message:send' => 'Enviar mensajes',
        'message:template:manage' => 'Gestionar plantillas de mensaje, correo y SMS',
        'notification:preference:update' => 'Cambiar tus preferencias de notificación',
        'expense:read' => 'Ver gastos',
        'expense:submit' => 'Enviar un gasto con su recibo',
        'expense:approve' => 'Aprobar o rechazar un gasto',
        'expense:category:manage' => 'Gestionar las categorías de gasto y su tratamiento',
        'finance:read' => 'Ver registros financieros y márgenes',
        'finance:update' => 'Editar registros financieros',
        'invoice:read' => 'Ver facturas',
        'invoice:create' => 'Crear o regenerar una factura',
        'invoice:send' => 'Enviar una factura',
        'invoice:status:update' => 'Cambiar el estado de una factura, anularla o darla de baja',
        'invoice:pay' => 'Pagar una factura',
        'payment:record' => 'Registrar un pago manual',
        'payment:refund' => 'Reembolsar un pago',
        'settlement:read' => 'Ver las liquidaciones a transportistas',
        'settlement:manage' => 'Crear y emitir liquidaciones a transportistas',
        'factoring:read' => 'Ver los registros de factoring',
        'factoring:manage' => 'Gestionar empresas de factoring y sus asignaciones',
        'report:read' => 'Ver informes y cuadros de mando',
        'report:export' => 'Exportar un informe',
        'audit:read' => 'Ver la pista de auditoría',
        'retention:manage' => 'Ejecutar acciones de retención y archivado',
        'legalhold:manage' => 'Aplicar y levantar retenciones legales',
        'lead:read' => 'Ver contactos de marketing y solicitudes de presupuesto',
        'lead:update' => 'Actualizar el estado y la asignación de un contacto',
    ];

    public static function get(string $key): string
    {
        return self::ALL[$key] ?? Permissions::describe($key);
    }
}
