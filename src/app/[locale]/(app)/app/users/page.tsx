import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can } from '@/lib/permissions'
import { listTenantUsers } from '@/server/users/queries'
import { PageHeader } from '@/components/shell/page-header'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime } from '@/i18n/translate'
import { InviteUserDialog } from './_components/invite-user-dialog'

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  invited: 'warning',
  pending_verification: 'warning',
  suspended: 'neutral',
  deactivated: 'neutral',
}

export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('tenant:user:read')
  const dictionary = await getDictionary(locale, ['settings', 'nav', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const canInvite = can(ctx.actor, 'tenant:user:invite', undefined, policy).allowed

  const rows = await listTenantUsers(ctx.db)

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('settings.team.title')}
        description={t('settings.team.description')}
        primaryAction={canInvite ? <InviteUserDialog /> : undefined}
      />

      {rows.length === 0 ? (
        <p className="text-sm text-steel-600">{t('settings.team.empty')}</p>
      ) : (
        <Table>
          <TableCaption className="sr-only">{t('settings.team.title')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings.team.columns.name')}</TableHead>
              <TableHead>{t('settings.team.columns.email')}</TableHead>
              <TableHead>{t('settings.team.columns.role')}</TableHead>
              <TableHead>{t('settings.team.columns.status')}</TableHead>
              <TableHead>{t('settings.team.columns.invited')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const roleKey = `nav.roles.${row.role}`
              const roleLabel = t(roleKey) === roleKey ? row.role : t(roleKey)
              const statusKey = `settings.team.status.${row.status}`
              const statusLabel = t(statusKey) === statusKey ? row.status : t(statusKey)
              return (
                <TableRow key={row.membershipId}>
                  <TableCell>
                    {row.firstName} {row.lastName}
                  </TableCell>
                  <TableCell>{row.email}</TableCell>
                  <TableCell>{roleLabel}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{statusLabel}</Badge>
                  </TableCell>
                  <TableCell>
                    {row.invitedAt ? formatDateTime(row.invitedAt, locale, ctx.actor.timezone) : '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
