import { useState } from 'react'
import { CheckboxField, TextField } from '@/components/Form/Field'
import { useI18n } from '@/lib/i18n'

/**
 * «¿Factorizas tus facturas?» y, si sí, CON QUIÉN.
 *
 * Hasta el lote 46 esta pregunta era una casilla suelta: se marcaba y la única
 * parte útil de la respuesta —el nombre de la empresa— no se pedía nunca. La
 * casa de despacho se quedaba con una fila que decía «sí» y no decía con quién.
 *
 * ## Un solo campo, aunque haya dos formas de rellenarlo
 *
 * El desplegable y la casilla de «Other» escriben el MISMO campo. Quien elige
 * de la lista manda el nombre que leyó y quien escribe manda el que teclea; es
 * el servidor el que decide si eso tiene ficha detrás. Así no viajan los
 * identificadores internos de la tabla a una página pública, y no existe el
 * estado de haber elegido una empresa y escrito otra.
 *
 * ## Sin lista no hay desplegable
 *
 * En goliathdispatch.com no hay empresa, así que no hay lista que ofrecer y
 * `opciones` llega vacía: la pantalla enseña directamente la casilla de texto.
 * Un desplegable vacío sería un filtro que no puede encontrar nada, que es el
 * mismo defecto que se arregló en el lote 43.
 */
export function FactoringChoice({
  usa,
  nombre,
  opciones,
  error,
  onUsa,
  onNombre,
}: {
  usa: boolean
  nombre: string
  opciones: string[]
  error?: string
  onUsa: (valor: boolean) => void
  onNombre: (valor: string) => void
}) {
  const { t } = useI18n()
  const texto = (clave: string) => t(`marketing.carrierSignup.factoring.${clave}`)

  /*
   * «Other» es estado de la pantalla, no del formulario.
   *
   * Si fuese un valor del formulario habría que mandarlo al servidor y el
   * servidor tendría que creérselo. Lo que el servidor necesita saber es el
   * nombre; si está en su lista o no lo sabe él mejor que el navegador.
   */
  const [otra, setOtra] = useState(false)

  const hayLista = opciones.length > 0
  const escribir = ! hayLista || otra

  return (
    <div className="flex flex-col gap-3">
      <CheckboxField
        label={t('marketing.forms.labels.factoringApplies')}
        checked={usa}
        onChange={(e) => {
          const valor = e.target.checked
          onUsa(valor)

          // Desmarcar limpia el nombre. Dejarlo escrito mandaría al servidor un
          // nombre colgando de un «no», que es justo el estado que el CHECK de
          // la base rechaza — y lo rechazaría DESPUÉS de que la persona hubiera
          // pulsado enviar.
          if (! valor) {
            onNombre('')
            setOtra(false)
          }
        }}
      />

      {usa ? (
        <div className="flex flex-col gap-3 border-l-2 border-steel-200 pl-4">
          {hayLista ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="factoring-company" className="text-sm font-medium text-carbon">
                {texto('which')}
              </label>
              <select
                id="factoring-company"
                value={otra ? '__other__' : nombre}
                onChange={(e) => {
                  const elegido = e.target.value

                  if (elegido === '__other__') {
                    setOtra(true)
                    onNombre('')

                    return
                  }

                  setOtra(false)
                  onNombre(elegido)
                }}
                className="rounded border border-steel-300 bg-white px-3 py-2 text-sm text-carbon focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-200"
              >
                <option value="">{texto('choose')}</option>
                {opciones.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
                <option value="__other__">{texto('other')}</option>
              </select>
              <p className="text-xs text-steel-600">{texto('hint')}</p>
            </div>
          ) : null}

          {escribir ? (
            <TextField
              label={texto('otherName')}
              value={nombre}
              onChange={(e) => onNombre(e.target.value)}
              error={error}
              hint={texto('otherHint')}
            />
          ) : null}

          {! escribir && error ? <p className="text-sm text-danger-600">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
