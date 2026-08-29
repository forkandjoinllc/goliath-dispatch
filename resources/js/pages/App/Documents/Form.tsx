import { Link, router, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

type OwnerType = 'carrier' | 'driver' | 'truck' | 'trailer'

interface UsedType {
  type: string
  documentId: string
}

interface Props {
  owners: Record<OwnerType, { id: string; name: string }[]>
  typesByOwner: Record<OwnerType, string[]>
  requiredTypes: Record<OwnerType, string[]>
  /** Los tipos que el dueño elegido YA tiene. Llega por recarga parcial. */
  usedTypes?: UsedType[]
}

export default function DocumentForm({ owners, typesByOwner, requiredTypes, usedTypes = [] }: Props) {
  const { t } = useI18n()
  const [ownerType, setOwnerType] = useState<OwnerType>('carrier')

  const form = useForm({
    file: null as File | null,
    owner_type: 'carrier' as OwnerType,
    owner_id: '',
    document_type: '',
    title: '',
    issue_date: '',
    expiration_date: '',
  })

  // Solo las clases de dueño que este actor puede tocar. Un conductor solo se
  // sube documentos a sí mismo, y ofrecerle «transportista» sería ofrecerle algo
  // que el servidor va a rechazar.
  const availableOwners = (Object.keys(owners) as OwnerType[]).filter((o) => owners[o].length > 0)

  const changeOwnerType = (next: OwnerType) => {
    setOwnerType(next)
    form.setData((data) => ({ ...data, owner_type: next, owner_id: '', document_type: '' }))
    // Cambiar de clase de dueño invalida la lista de lo ya subido.
    router.reload({ only: ['usedTypes'], data: { owner_type: next, owner_id: '' } })
  }

  /**
   * Al elegir dueño se pregunta al servidor qué tipos ya tiene.
   *
   * Recarga parcial y no un mapa de todos los dueños en la primera respuesta:
   * una empresa con doscientos transportistas mandaría kilos de JSON para usar
   * una fila.
   */
  const changeOwner = (id: string) => {
    form.setData((data) => ({ ...data, owner_id: id, document_type: '' }))
    router.reload({ only: ['usedTypes'], data: { owner_type: ownerType, owner_id: id } })
  }

  const usadoPor = (type: string): string | undefined =>
    usedTypes.find((u) => u.type === type)?.documentId

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    // forceFormData: hay un fichero, así que la petición tiene que ir como
    // multipart y no como JSON.
    form.post('/documents', { forceFormData: true })
  }

  return (
    <AppLayout
      title={t('documents.form.title')}
      description={t('documents.form.subtitle')}
      crumbs={[
        { label: t('documents.index.title'), href: '/documents' },
        { label: t('documents.form.title') },
      ]}
    >
      <form onSubmit={submit} className="flex max-w-2xl flex-col gap-6">
        <fieldset className="rounded border border-steel-200 bg-white p-5">
          <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-safety-600">
            {t('documents.form.belongsTo')}
          </legend>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {availableOwners.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => changeOwnerType(o)}
                aria-pressed={ownerType === o}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  ownerType === o
                    ? 'border-navy-700 bg-navy-700 text-white'
                    : 'border-steel-300 bg-white text-steel-800 hover:bg-navy-50'
                }`}
              >
                {t(`documents.owners.${o}`)}
              </button>
            ))}
          </div>

          <label className="mt-4 block text-sm font-medium text-carbon" htmlFor="owner">
            {t(`documents.owners.${ownerType}`)} <span className="text-danger-600">*</span>
          </label>
          <select
            id="owner"
            value={form.data.owner_id}
            onChange={(e) => changeOwner(e.target.value)}
            className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          >
            <option value="">{t('documents.form.chooseOwner')}</option>
            {owners[ownerType].map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {form.errors.owner_id ? (
            <p role="alert" className="mt-1 text-sm text-danger-700">
              {form.errors.owner_id}
            </p>
          ) : null}

          <label className="mt-4 block text-sm font-medium text-carbon" htmlFor="document-type">
            {t('documents.form.documentType')} <span className="text-danger-600">*</span>
          </label>
          <select
            id="document-type"
            value={form.data.document_type}
            onChange={(e) => form.setData('document_type', e.target.value)}
            className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          >
            <option value="">{t('documents.form.chooseType')}</option>
            {typesByOwner[ownerType].map((type) => (
              <option key={type} value={type} disabled={usadoPor(type) !== undefined}>
                {t(`documents.types.${type}`)}
                {/* Se marca cuál es obligatorio en el propio desplegable: es la
                    diferencia entre subir lo que hace falta y subir lo que
                    había a mano. */}
                {requiredTypes[ownerType].includes(type) ? ' ★' : ''}
                {/* Y cuál ya está. Subir dos veces el mismo tipo no crea dos
                    documentos: crea uno bueno y uno que nadie sabe si mirar. */}
                {usadoPor(type) !== undefined ? ` — ${t('documents.form.alreadyUploaded')}` : ''}
              </option>
            ))}
          </select>

          {form.data.owner_id !== '' && usedTypes.length > 0 ? (
            <p className="mt-1 text-xs text-steel-600">
              {t('documents.form.replaceHint')}{' '}
              {usedTypes.map((u, i) => (
                <span key={u.documentId}>
                  {i > 0 ? ', ' : ''}
                  <Link href={`/documents/${u.documentId}`} className="text-navy-700 underline">
                    {t(`documents.types.${u.type}`)}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
          {form.errors.document_type ? (
            <p role="alert" className="mt-1 text-sm text-danger-700">
              {form.errors.document_type}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="rounded border border-steel-200 bg-white p-5">
          <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-safety-600">
            {t('documents.form.file')}
          </legend>

          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.tif,.tiff,.doc,.docx"
            onChange={(e) => form.setData('file', e.target.files?.[0] ?? null)}
            className="mt-2 block w-full text-sm text-steel-700 file:mr-3 file:rounded file:border-0 file:bg-navy-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-navy-800"
          />
          <p className="mt-1 text-xs text-steel-600">{t('documents.form.fileHint')}</p>
          {form.errors.file ? (
            <p role="alert" className="mt-1 text-sm text-danger-700">
              {form.errors.file}
            </p>
          ) : null}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-carbon" htmlFor="doc-title">
                {t('documents.form.titleLabel')}
              </label>
              <input
                id="doc-title"
                type="text"
                maxLength={200}
                value={form.data.title}
                onChange={(e) => form.setData('title', e.target.value)}
                className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
              />
              <p className="mt-1 text-xs text-steel-600">{t('documents.form.titleHint')}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-carbon" htmlFor="issue-date">
                {t('documents.form.issueDate')}
              </label>
              <input
                id="issue-date"
                type="date"
                value={form.data.issue_date}
                onChange={(e) => form.setData('issue_date', e.target.value)}
                className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-carbon" htmlFor="expiration-date">
                {t('documents.form.expirationDate')}
              </label>
              <input
                id="expiration-date"
                type="date"
                value={form.data.expiration_date}
                onChange={(e) => form.setData('expiration_date', e.target.value)}
                className="mt-1 w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
              />
              <p className="mt-1 text-xs text-steel-600">{t('documents.form.expirationHint')}</p>
            </div>
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={form.processing || form.data.file === null}
            className="rounded bg-safety-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {form.processing
              ? `${t('common.states.saving')} ${form.progress ? `${form.progress.percentage}%` : ''}`
              : t('documents.form.upload')}
          </button>
          <Link
            href="/documents"
            className="rounded border border-steel-300 px-4 py-2.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('documents.form.cancel')}
          </Link>
        </div>
      </form>
    </AppLayout>
  )
}
