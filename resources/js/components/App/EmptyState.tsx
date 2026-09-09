import { useI18n } from '@/lib/i18n'

/**
 * Lo que se dice cuando una lista sale vacía.
 *
 * ## El defecto
 *
 * Las seis pantallas de listado decían esto, sin mirar quién estaba delante:
 *
 *     Todavía no hay documentos
 *     Suba el primero. Un transportista no puede despachar sin su
 *     certificado de seguro.
 *
 * Comprobado con el conductor de la base de datos de demostración. Tres cosas
 * falsas a la vez:
 *
 *  1. **«Todavía no hay documentos» es falso.** La empresa tiene treinta y dos.
 *     El alcance de ese conductor es `own` y él no tiene ninguno; la frase
 *     habla de la empresa y quien la lee no ve la empresa.
 *  2. **El consejo es de otro rol.** Los papeles de un conductor son su CDL y
 *     su tarjeta médica, no el certificado de seguro de un transportista.
 *  3. **«Agregue el primero» se decía sin permiso de crear.** Contabilidad lee
 *     transportistas, conductores, equipos y clientes y no puede crear ninguno:
 *     leía una instrucción que no puede seguir.
 *
 * ## La regla
 *
 * Cuatro casos, en este orden, y el orden importa:
 *
 * | Situación | Qué se dice |
 * |---|---|
 * | Hay filtros puestos | «nada coincide con estos filtros» — ya era honesto |
 * | El alcance no es la empresa | que la lista está ACOTADA, y a qué |
 * | Alcance de empresa y puede crear | «todavía no hay» + «agregue el primero» |
 * | Alcance de empresa y NO puede crear | «todavía no hay» + a quién pedírselo |
 *
 * El alcance va antes del permiso porque una persona con alcance acotado puede
 * además tener permiso de crear —un despachador crea conductores en su
 * cartera— y aun así «todavía no hay conductores» seguiría siendo falso.
 *
 * ## Por qué el texto del alcance vive en `common` y no en cada diccionario
 *
 * Porque la verdad que hay que decir —«esta lista está acotada a usted y su
 * parte está vacía»— es la misma en los seis dominios. Escrita seis veces se
 * separa; escrita una vez, no. Y se escribe SIN el nombre del dominio a
 * propósito: interpolar el sustantivo obliga a concordar género y número en
 * español («Ningún transportista» / «Ninguna carga») y eso es una fuente de
 * frases mal escritas en cada idioma nuevo.
 */
export function EmptyState({
  ns,
  filtered,
  scope,
  canCreate,
}: {
  /** El espacio del diccionario de esta pantalla: `documents`, `loads`… */
  ns: string
  filtered: boolean
  /** El alcance del que mira, tal como lo manda el servidor. */
  scope: string
  /** Si esta persona puede crear en esta pantalla. */
  canCreate: boolean
}) {
  const { t } = useI18n()

  const [titulo, pista] = (() => {
    if (filtered) {
      return [`${ns}.index.noResults`, `${ns}.index.noResultsHint`]
    }

    // `platform` es el alcance del equipo de la plataforma, que ve todo: para
    // él la frase de empresa es tan cierta como para un administrador.
    if (scope !== 'tenant' && scope !== 'platform') {
      return [`common.states.scoped.${scope}`, `common.states.scoped.${scope}Hint`]
    }

    return [
      `${ns}.index.empty`,
      canCreate ? `${ns}.index.emptyHint` : 'common.states.emptyNoPermission',
    ]
  })()

  return (
    <div className="mt-6 rounded border border-dashed border-steel-300 bg-white p-10 text-center">
      <p className="font-display text-lg font-bold text-navy-700">{t(titulo)}</p>
      <p className="mt-1 text-sm text-steel-700">{t(pista)}</p>
    </div>
  )
}
