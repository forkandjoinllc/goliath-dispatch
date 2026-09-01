import { Head, useForm } from '@inertiajs/react'
import { useI18n } from '@/lib/i18n'

interface Linea {
  description: string
  quantity: number
  unitAmountCents: number
  amountCents: number
}

interface Props {
  state: 'active' | 'notFound' | 'expired' | 'voided'
  invoice: {
    number: string
    carrier: string | null
    status: string
    issueDate: string | null
    dueDate: string | null
    totalCents: number
    paidCents: number
    balanceCents: number
    lines: Linea[]
  } | null
  brand: {
    name: string
    logoUrl: string | null
    primaryColor: string
    accentColor: string
  } | null
  provider: { live: boolean } | null
  token?: string
}

/**
 * La factura que abre el transportista desde su correo, sin cuenta.
 *
 * Lo que se enseña es lo justo para reconocerla y pagarla. Nada del margen de la
 * casa de despacho: eso se decide en el servidor, que pide las columnas una a
 * una — ver App\Http\Controllers\Public\InvoiceController.
 */
export default function PublicInvoice({ state, invoice, brand, provider, token }: Props) {
  const { t } = useI18n()

  if (state !== 'active' || invoice === null) {
    return (
      <Marco titulo={t('invoices.public.title')} brand={brand}>
        <p className="text-sm text-carbon">{t(`invoices.public.${state}`)}</p>
      </Marco>
    )
  }

  const pagada = invoice.balanceCents <= 0

  return (
    <Marco titulo={`${t('invoices.public.title')} — ${invoice.number}`} brand={brand}>
      <p className="text-xs uppercase tracking-wide text-steel-600">
        {t('invoices.public.number', { number: invoice.number })}
      </p>
      <h1 className="mt-1 font-display text-2xl font-bold text-carbon">{dinero(invoice.balanceCents)}</h1>

      <dl className="mt-3 grid gap-1 text-sm text-steel-700 sm:grid-cols-2">
        {invoice.carrier ? (
          <Dato etiqueta={t('invoices.public.carrier')} valor={invoice.carrier} />
        ) : null}
        {invoice.issueDate ? (
          <Dato etiqueta={t('invoices.public.issued', { date: invoice.issueDate })} valor="" />
        ) : null}
        {invoice.dueDate ? (
          <Dato etiqueta={t('invoices.public.due', { date: invoice.dueDate })} valor="" />
        ) : null}
      </dl>

      <h2 className="mt-6 text-sm font-semibold text-carbon">{t('invoices.public.lines')}</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead>
            <tr className="border-b border-steel-200 text-xs uppercase tracking-wide text-steel-600">
              <th className="py-1 pr-3 font-medium">{t('invoices.public.lines')}</th>
              <th className="py-1 pr-3 text-right font-medium">{t('invoices.public.quantity')}</th>
              <th className="py-1 pr-3 text-right font-medium">{t('invoices.public.unit')}</th>
              <th className="py-1 text-right font-medium">{t('invoices.public.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i} className="border-b border-steel-100">
                <td className="py-1.5 pr-3 text-carbon">{l.description}</td>
                <td className="py-1.5 pr-3 text-right text-steel-700">{l.quantity}</td>
                <td className="py-1.5 pr-3 text-right text-steel-700">{dinero(l.unitAmountCents)}</td>
                <td className="py-1.5 text-right text-carbon">{dinero(l.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mt-4 flex flex-col gap-1 text-sm">
        <Total etiqueta={t('invoices.public.total')} valor={dinero(invoice.totalCents)} />
        {invoice.paidCents > 0 ? (
          <Total etiqueta={t('invoices.public.paid')} valor={dinero(invoice.paidCents)} />
        ) : null}
        <Total etiqueta={t('invoices.public.balance')} valor={dinero(invoice.balanceCents)} fuerte />
      </dl>

      {pagada ? (
        <p className="mt-6 rounded border border-success-500 bg-success-50 p-3 text-sm text-carbon">
          {t('invoices.public.paidNotice')}
        </p>
      ) : (
        <Pagar token={token ?? ''} live={provider?.live ?? false} color={brand?.primaryColor} />
      )}

      {brand ? (
        <p className="mt-8 border-t border-steel-200 pt-4 text-xs text-steel-600">
          {t('invoices.public.poweredBy', { tenant: brand.name })}
        </p>
      ) : null}
    </Marco>
  )
}

/**
 * El botón de pagar, y encima el aviso de si el cobro es de verdad.
 *
 * Lo primero que se dice es si al pulsar se cobra o no. Un cobro simulado que se
 * presentara como real sería la peor mentira que este módulo podría contar — y
 * quien abre esto es alguien que va a mirar su cuenta después.
 */
function Pagar({ token, live, color }: { token: string; live: boolean; color?: string }) {
  const { t } = useI18n()
  const form = useForm({})

  return (
    <div className="mt-6">
      {! live ? (
        <p className="mb-3 rounded border border-warning-300 bg-warning-50 p-3 text-sm text-carbon">
          {t('invoices.public.mockNotice')}
        </p>
      ) : null}

      <button
        type="button"
        disabled={form.processing}
        onClick={() => form.post(`/i/${token}/pay`)}
        className="rounded px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50"
        style={{ backgroundColor: color ?? '#062B5C' }}
      >
        {t('invoices.public.pay')}
      </button>
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="inline text-steel-600">{etiqueta}</dt>
      {valor ? <dd className="inline text-carbon"> {valor}</dd> : null}
    </div>
  )
}

function Total({ etiqueta, valor, fuerte = false }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="flex justify-between border-t border-steel-100 pt-1">
      <dt className={fuerte ? 'font-semibold text-carbon' : 'text-steel-700'}>{etiqueta}</dt>
      <dd className={fuerte ? 'font-semibold text-carbon' : 'text-steel-700'}>{valor}</dd>
    </div>
  )
}

function dinero(centavos: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(centavos / 100)
}

/** El mismo marco que el rastreo público, con la cara de la empresa. */
function Marco({
  titulo, brand, children,
}: {
  titulo: string
  brand: Props['brand']
  children: React.ReactNode
}) {
  return (
    <>
      <Head title={titulo}>
        {/* Una página con un testigo en la dirección no se indexa. */}
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <main className="min-h-screen bg-steel-50 px-4 py-10">
        <div className="mx-auto max-w-2xl overflow-hidden rounded border border-steel-200 bg-white">
          <div className="h-2 w-full" style={{ backgroundColor: brand?.primaryColor ?? undefined }} />
          <div className="p-6 sm:p-8">
            {brand?.logoUrl ? (
              <img src={brand.logoUrl} alt={brand.name} className="mb-6 h-10 w-auto" />
            ) : null}
            {children}
          </div>
        </div>
      </main>
    </>
  )
}
