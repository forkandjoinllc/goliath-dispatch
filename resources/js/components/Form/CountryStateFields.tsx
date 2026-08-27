import { SelectField } from '@/components/Form/Field'
import { useI18n } from '@/lib/i18n'
import { COUNTRIES, DEFAULT_COUNTRY, subdivisionsFor } from '@/lib/regions'

interface Props {
  country: string
  state: string
  /**
   * Se llama UNA vez con los dos valores ya resueltos.
   *
   * Una sola llamada y no dos a propósito: dos `setState` seguidos dentro del
   * mismo manejador, si el padre calcula el siguiente estado a partir de una
   * variable capturada, pierden el primero. Devolver el par entero quita esa
   * trampa de en medio en todos los sitios donde se use esto.
   */
  onChange: (next: { country: string; state: string }) => void
  countryError?: string
  stateError?: string
  countryLabel?: string
  stateLabel?: string
  disabled?: boolean
  required?: boolean
}

/**
 * País y estado, juntos, porque separados se desincronizan.
 *
 * El estado depende del país y por eso los dos campos son un solo componente.
 * Con dos campos sueltos acaba habiendo clientes de Ontario con el estado «TX»:
 * alguien elige el estado, cambia el país después, y nadie limpia lo primero.
 * Aquí cambiar de país BORRA el estado, siempre. Perder una selección es
 * molesto; guardar una dirección imposible es peor, y encima es silencioso.
 *
 * El estado es un desplegable y no texto libre por la misma razón que el cargo
 * de un contacto: con texto libre acaban conviviendo «TX», «Tx», «Texas» y
 * «TEJAS», y entonces la columna no sirve ni para filtrar ni para un permiso.
 *
 * Estados Unidos viene marcado por omisión. No es una opinión sobre el mercado:
 * es lo que hay hoy en todas las filas y lo que se elige en la inmensa mayoría
 * de las altas.
 */
export function CountryStateFields({
  country,
  state,
  onChange,
  countryError,
  stateError,
  countryLabel,
  stateLabel,
  disabled = false,
  required = false,
}: Props) {
  const { t } = useI18n()

  const pais = country === '' ? DEFAULT_COUNTRY : country
  const estados = subdivisionsFor(pais)

  return (
    <>
      <SelectField
        label={countryLabel ?? t('common.address.country')}
        required={required}
        disabled={disabled}
        value={pais}
        // Cambiar de país BORRA el estado. Ver la cabecera.
        onChange={(e) => onChange({ country: e.target.value, state: '' })}
        options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
        error={countryError}
      />
      <SelectField
        label={stateLabel ?? t('common.address.state')}
        required={required}
        disabled={disabled}
        value={state}
        onChange={(e) => onChange({ country: pais, state: e.target.value })}
        options={[
          { value: '', label: t('common.address.statePlaceholder') },
          ...estados.map((s) => ({ value: s.code, label: `${s.code} — ${s.name}` })),
        ]}
        error={stateError}
      />
    </>
  )
}
