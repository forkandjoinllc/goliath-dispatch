import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { requireActor, getTenantPolicy } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { loadFor } from '@/server/action'
import { can } from '@/lib/permissions'
import { expenses, loads, carriers, expenseCategories, users, userTenantMemberships } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { fullName } from '@/lib/utils'
import { ExpenseDetailView } from '../_components/expense-detail-view'

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()
  const previewDb = tenantDb(actorPreview.tenantId)
  const preview = await previewDb.findById(expenses, id)
  if (!preview) notFound()

  const ctx = await loadFor('expense:read', { tenantId: actorPreview.tenantId, carrierId: preview.carrierId })

  const expense = await ctx.db.requireById(expenses, id, 'expense')
  const category = await ctx.db.findById(expenseCategories, expense.categoryId)
  const load = expense.loadId ? await ctx.db.findById(loads, expense.loadId) : null
  const carrier = expense.carrierId ? await ctx.db.findById(carriers, expense.carrierId) : null

  async function nameFor(userId: string | null): Promise<string | null> {
    if (!userId) return null
    const [row] = await ctx.db.builderRequiringExplicitTenantPredicate
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .innerJoin(
        userTenantMemberships,
        and(eq(userTenantMemberships.userId, users.id), eq(userTenantMemberships.tenantId, ctx.db.tenantId)),
      )
      .where(eq(users.id, userId))
    return row ? fullName(row) : null
  }

  const [submitterName, reviewerName] = await Promise.all([
    nameFor(expense.submittedByUserId),
    nameFor(expense.reviewedByUserId),
  ])

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const canApprove = can(
    ctx.actor,
    'expense:approve',
    { tenantId: ctx.actor.tenantId, carrierId: expense.carrierId },
    policy,
  ).allowed

  return (
    <ExpenseDetailView
      expense={expense}
      categoryLabel={category ? (locale === 'es' ? category.labelEs : category.labelEn) : '—'}
      // Always read the snapshot, never the live category — a later category
      // edit (even changing its treatment) can never rewrite settled math.
      treatment={expense.treatmentSnapshot}
      loadNumber={load?.loadNumber ?? null}
      carrierName={carrier?.legalName ?? null}
      submitterName={submitterName ?? '—'}
      reviewerName={reviewerName}
      canApprove={canApprove}
    />
  )
}
