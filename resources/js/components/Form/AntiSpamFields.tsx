import { useI18n } from '@/lib/i18n'

/**
 * El campo trampa y el sello firmado, en un componente para que los tres
 * formularios no puedan quedarse desincronizados del servidor.
 *
 * El campo trampa está oculto a la vista Y a los lectores de pantalla
 * (`aria-hidden`, fuera de pantalla, sin tabulación), de modo que nadie que
 * rellene el formulario lo vea nunca, mientras que un script que rellena todos
 * los `input` de la página sí lo rellena.
 *
 * El sello lo emite el servidor al renderizar. Aquí solo se reenvía: el cliente
 * no puede fabricarlo ni adelantarlo.
 */
export function AntiSpamFields({ token }: { token: string }) {
  const { t } = useI18n()

  return (
    <div aria-hidden="true" className="absolute left-0 top-0 size-px overflow-hidden opacity-0">
      <label htmlFor="company-url-confirm">{t('marketing.forms.hpFieldLabel')}</label>
      <input
        id="company-url-confirm"
        name="hp_field"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        defaultValue=""
      />
      <input type="hidden" name="form_token" defaultValue={token} />
    </div>
  )
}
