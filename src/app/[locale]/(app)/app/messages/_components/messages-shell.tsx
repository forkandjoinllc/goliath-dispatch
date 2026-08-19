'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useTranslate } from '@/components/providers/i18n-provider'
import { getConversationDetailAction, listConversationsAction } from '@/server/messaging/actions'
import type { ConversationDetail, ConversationSummary } from '@/server/messaging/queries'
import type { MessageTemplateOption } from '@/server/messaging/templates'
import type { MessageableUser } from '../_lib/queries'
import { ConversationListPanel } from './conversation-list-panel'
import { ThreadPanel } from './thread-panel'
import { NewConversationDialog } from './new-conversation-dialog'

const POLL_INTERVAL_MS = 20_000

export interface MessagesShellProps {
  locale: string
  currentUserId: string
  initialConversations: ConversationSummary[]
  initialDetail: ConversationDetail | null
  selectedConversationId: string | null
  templates: MessageTemplateOption[]
  loadNumbers: Record<string, string>
  carrierNames: Record<string, string>
  messageableUsers: MessageableUser[]
}

/**
 * Two-pane messaging shell: conversation list + thread, collapsing to a
 * single pane on mobile (the list hides once a conversation is selected;
 * "back to conversations" returns to it). Both panes refresh themselves by
 * polling on `POLL_INTERVAL_MS` — there is no WebSocket/SSE transport here,
 * this is a deliberate simplification documented for the user in
 * `notification.messaging.thread.pollingNotice`.
 */
export function MessagesShell({
  locale,
  currentUserId,
  initialConversations,
  initialDetail,
  selectedConversationId,
  templates,
  loadNumbers,
  carrierNames,
  messageableUsers,
}: MessagesShellProps) {
  const t = useTranslate()
  const router = useRouter()
  const [conversations, setConversations] = React.useState(initialConversations)
  const [detail, setDetail] = React.useState(initialDetail)
  const [selectedId, setSelectedId] = React.useState(selectedConversationId)
  const [newConversationOpen, setNewConversationOpen] = React.useState(false)

  React.useEffect(() => {
    setSelectedId(selectedConversationId)
    setDetail(initialDetail)
  }, [selectedConversationId, initialDetail])

  const refresh = React.useCallback(async () => {
    const listResult = await listConversationsAction({})
    if (listResult.ok) setConversations(listResult.data)

    if (selectedId) {
      const detailResult = await getConversationDetailAction({ conversationId: selectedId })
      if (detailResult.ok) setDetail(detailResult.data)
    }
  }, [selectedId])

  React.useEffect(() => {
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  function selectConversation(conversationId: string | null) {
    const params = new URLSearchParams()
    if (conversationId) params.set('c', conversationId)
    router.push(`/${locale}/app/messages${params.toString() ? `?${params.toString()}` : ''}`)
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-steel-200">
      <div className={cn('w-full shrink-0 border-r border-steel-200 sm:w-80', selectedId ? 'hidden sm:block' : 'block')}>
        <ConversationListPanel
          conversations={conversations}
          currentUserId={currentUserId}
          selectedId={selectedId}
          loadNumbers={loadNumbers}
          carrierNames={carrierNames}
          onSelect={selectConversation}
          onNewConversation={() => setNewConversationOpen(true)}
        />
      </div>
      <div className={cn('flex min-h-0 flex-1 flex-col', selectedId ? 'block' : 'hidden sm:block')}>
        {detail ? (
          <ThreadPanel
            detail={detail}
            currentUserId={currentUserId}
            templates={templates}
            loadNumber={detail.conversation.loadId ? loadNumbers[detail.conversation.loadId] : undefined}
            carrierName={detail.conversation.carrierId ? carrierNames[detail.conversation.carrierId] : undefined}
            onBack={() => selectConversation(null)}
            onRefresh={refresh}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-steel-600">
            {t('notification.messaging.selectConversation')}
          </div>
        )}
      </div>

      <NewConversationDialog
        open={newConversationOpen}
        onOpenChange={setNewConversationOpen}
        messageableUsers={messageableUsers}
        onCreated={(conversationId) => {
          setNewConversationOpen(false)
          selectConversation(conversationId)
        }}
      />
    </div>
  )
}
