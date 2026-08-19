import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { listConversationsForUser, getConversationDetail } from '@/server/messaging/queries'
import { listMessageTemplates } from '@/server/messaging/templates'
import { PageHeader } from '@/components/shell/page-header'
import { carrierNamesFor, listMessageableUsers, loadNumbersFor } from './_lib/queries'
import { MessagesShell } from './_components/messages-shell'

export default async function MessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ c?: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const query = await searchParams

  const ctx = await loadFor('message:read')
  const dictionary = await getDictionary(locale, ['notification', 'common'])
  const t = createTranslator(dictionary, locale)

  const conversations = await listConversationsForUser(ctx.db, ctx.actor.userId)
  const selectedId = query.c && conversations.some((c) => c.conversation.id === query.c) ? query.c : null
  const initialDetail = selectedId ? await getConversationDetail(ctx.db, selectedId, ctx.actor.userId) : null
  const templates = listMessageTemplates(t)

  const loadIds = conversations.map((c) => c.conversation.loadId).filter((id): id is string => Boolean(id))
  const carrierIds = conversations.map((c) => c.conversation.carrierId).filter((id): id is string => Boolean(id))
  const [loadNumbers, carrierNames, messageableUsers] = await Promise.all([
    loadNumbersFor(ctx.db, loadIds),
    carrierNamesFor(ctx.db, carrierIds),
    listMessageableUsers(ctx.db),
  ])

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
      <PageHeader title={t('notification.messaging.title')} />
      <MessagesShell
        locale={locale}
        currentUserId={ctx.actor.userId}
        initialConversations={conversations}
        initialDetail={initialDetail}
        selectedConversationId={selectedId}
        templates={templates}
        loadNumbers={Object.fromEntries(loadNumbers)}
        carrierNames={Object.fromEntries(carrierNames)}
        messageableUsers={messageableUsers}
      />
    </div>
  )
}
