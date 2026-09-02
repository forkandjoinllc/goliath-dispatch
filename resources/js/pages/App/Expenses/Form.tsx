import { Link, router, useForm } from '@inertiajs/react'
import { useMemo } from 'react'
import { SearchableSelect } from '@/components/Form/SearchableSelect'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

interface Category {
  id: string
  labelEn: string
  labelEs: string
  treatment: string
  /** Si esta categoría exige recibo. Se congela en el gasto al presentarlo. */
  requiresReceipt: boolean
}

interface LoadChoice {
  id: string
  name: string
  hint: string | null
}

interface Props {
  categories: Category[]
  loads: LoadChoice[]
  /** La carga elegida ya tiene cifras congeladas. Llega por recarga parcial. */
  loadFrozen?: boolean
}

export default function ExpenseForm({ categories, loads, loadFrozen = false }: Props) {
  const { t, locale } = useI18n()

  const form = useForm({
    load_id: '',
    category_id: '',
    amount_cents: null as number | null,
    incurred_on: '',
    description: '',
  })

  const cargaElegida = useMemo(
    () => loads.find((l) => l.id === form.data.load_id) ?? null,
    [loads, form.data.load_id],
  )

  const categoriaElegida = useMemo(
    () => categories.find((c) => c.id === form.data.category_id) ?? null,
    [categories, form.data.category_id],
  )

  const nombreCategoria = (c: Category): string => (locale === 'es' ? c.labelEs : c.labelEn)

  /**
   * Al elegir carga se le pregunta al servidor si esa carga ya está facturada
   * o liquidada.
   *
   * Recarga parcial y no un mapa de todas las cargas en la primera respuesta:
   * una empresa con mil cargas mandaría kilos de JSON para usar una fila.
   */
  const elegirCarga = (id: string) => {
    form.setData('load_id', id)
    router.reload({ only: ['loadFrozen'], data: { load_id: id } })
  }

  const limpiarCarga = () => {
    form.setData('load_id', '')
    router.reload({ only: ['loadFrozen'], data: { load_id: '' } })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    form.post('/expenses')
  }

  return (
    <AppLayout
      title={t('expenses.form.title')}
      description={t('expenses.form.subtitle')}
      crumbs={[
        { label: t('expenses.index.title'), href: '/expenses' },
        { label: t('expenses.form.title') },
      ]}
    >
      <form onSubmit={submit} className="flex max-w-2xl flex-col gap-6">
        <fieldset className="rounded border border-steel-200 bg-white p-5">
          <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-safety-600">
            {t('expenses.form.load')}
          </legend>

          {cargaElegida === null ? (
            <div className="mt-2">
              <SearchableSelect
                label={t('expenses.form.chooseLoad')}
                choices={loads}
                onPick={elegirCarga}
                placeholder={t('expenses.form.searchLoad')}
                emptyText={t('expenses.form.noLoads')}
                hint={t('expenses.form.loadHint')}
              />
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-between gap-3 rounded border border-steel-200 bg-steel-50 px-3 py-2">
              <span className="text-sm font-medium text-carbon">
                {cargaElegida.name}
                {cargaElegida.hint ? (
                  <span className="ml-2 text-xs font-normal text-steel-600">{cargaElegida.hint}</span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={limpiarCarga}
                className="text-xs font-medium text-navy-700 underline"
              >
                {t('expenses.form.changeLoad')}
              </button>
            </div>
          )}

          {/* Se avisa ANTES de teclear el importe, no después de aprobarlo: si
              la carga ya está facturada o liquidada, sus cifras están
              congeladas y este gasto no las va a mover. */}
          {loadFrozen ? (
            <p className="mt-3 rounded border-l-4 border-safety-500 bg-safety-50 p-2 text-xs">
              {t('expenses.form.frozenWarning')}
            </p>
          ) : null}

          {form.errors.load_id ? (
            <p role="alert" className="mt-1 text-sm text-danger-700">
              {form.errors.load_id}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="rounded border border-steel-200 bg-white p-5">
          <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-safety-600">
            {t('expenses.form.what')}
          </legend>

          <label className="mt-2 block text-sm font-medium text-carbon" htmlFor="category">
            {t('expenses.form.category')} <span className="text-danger-600">*</span>
          </label>
          <select
            id="category"
            value={form.data.category_id}
            onChange={(e) => form.setData('category_id', e.target.value)}
            className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          >
            <option value="">{t('expenses.form.chooseCategory')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {nombreCategoria(c)} — {t(`expenses.treatment.${c.treatment}`)}
              </option>
            ))}
          </select>

          {/* La categoría decide QUIÉN PAGA. Elegir «reparación» cuando se
              quería «combustible» cambia el dinero de sitio, y eso no debería
              descubrirse en la liquidación. */}
          {categoriaElegida ? (
            <p className="mt-1 text-xs text-steel-600">
              {t(`expenses.treatmentHelp.${categoriaElegida.treatment}`)}
            </p>
          ) : null}

          {/* Que exige recibo se dice AQUÍ, al elegir la categoría, y no
              después: quien presenta el gasto tiene el tique delante en ese
              momento y ya no lo tendrá cuando el revisor se lo devuelva. El
              recibo se adjunta desde la lista, una vez presentado. */}
          {categoriaElegida?.requiresReceipt ? (
            <p className="mt-2 rounded border-l-4 border-safety-500 bg-safety-50 p-2 text-xs text-carbon">
              {t('expenses.receipt.requiredHint')}
            </p>
          ) : null}

          {form.errors.category_id ? (
            <p role="alert" className="mt-1 text-sm text-danger-700">
              {form.errors.category_id}
            </p>
          ) : null}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-carbon" htmlFor="amount">
                {t('expenses.form.amount')} <span className="text-danger-600">*</span>
              </label>
              {/* Dólares en pantalla, centavos por dentro. La conversión ocurre
                  aquí, en el borde, una sola vez — ver docs/finanzas.md. */}
              <input
                id="amount"
                type="number"
                min={0}
                step={0.01}
                value={form.data.amount_cents === null ? '' : form.data.amount_cents / 100}
                onChange={(e) =>
                  form.setData(
                    'amount_cents',
                    e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
                  )
                }
                className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
              />
              {form.data.amount_cents !== null && form.data.amount_cents > 0 ? (
                <p className="mt-1 text-xs text-steel-600">
                  {formatCents(form.data.amount_cents, locale)}
                </p>
              ) : null}
              {form.errors.amount_cents ? (
                <p role="alert" className="mt-1 text-sm text-danger-700">
                  {form.errors.amount_cents}
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-sm font-medium text-carbon" htmlFor="incurred-on">
                {t('expenses.form.incurredOn')}
              </label>
              <input
                id="incurred-on"
                type="date"
                value={form.data.incurred_on}
                onChange={(e) => form.setData('incurred_on', e.target.value)}
                className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
              />
              <p className="mt-1 text-xs text-steel-600">{t('expenses.form.incurredHint')}</p>
              {form.errors.incurred_on ? (
                <p role="alert" className="mt-1 text-sm text-danger-700">
                  {form.errors.incurred_on}
                </p>
              ) : null}
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-carbon" htmlFor="description">
                {t('expenses.form.description')}
              </label>
              <textarea
                id="description"
                rows={3}
                maxLength={2000}
                value={form.data.description}
                onChange={(e) => form.setData('description', e.target.value)}
                className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
              />
              <p className="mt-1 text-xs text-steel-600">{t('expenses.form.descriptionHint')}</p>
              {form.errors.description ? (
                <p role="alert" className="mt-1 text-sm text-danger-700">
                  {form.errors.description}
                </p>
              ) : null}
            </div>
          </div>
        </fieldset>

        {/* Quien lo da de alta no lo aprueba. Se dice aquí para que nadie
            espere ver el importe en la próxima factura por haberlo guardado. */}
        <p className="text-xs text-steel-600">{t('expenses.form.approvalNote')}</p>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={form.processing || form.data.load_id === '' || form.data.category_id === ''}
            className="rounded bg-safety-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {form.processing ? t('common.states.saving') : t('expenses.form.submit')}
          </button>
          <Link
            href="/expenses"
            className="rounded border border-steel-300 px-4 py-2.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('expenses.form.cancel')}
          </Link>
        </div>
      </form>
    </AppLayout>
  )
}
