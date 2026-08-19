'use client'

import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { cn } from '@/lib/utils'
import type { ConversationSummary } from '@/server/messaging/queries'

export interface ConversationListPanelProps {
  conversations: ConversationSummary[]
  currentUserId: string
  selectedId: string | null
  loadNumbers: Record<string, string>
  carrierNames: Record<string, string>
  onSelect: (conversationId: string) => void
  onNewConversation: () => void
}

export function ConversationListPanel({
  conversations,
  selectedId,
  loadNumbers,
  carrierNames,
  onSelect,
  onNewConversation,
}: ConversationListPanelProps) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-steel-200 p-3">
        <h2 className="text-sm font-bold text-carbon">{t('notification.messaging.title')}</h2>
        <Button size="iconSm" variant="ghost" aria-label={t('notification.messaging.newConversation')} onClick={onNewConversation}>
          <Plus aria-hidden="true" />
        </Button>
      </div>

      {conversations.length === 0 ? (
        <div className="p-3">
          <EmptyState title={t('notification.messaging.noConversations')} description={t('notification.messaging.noConversationsHint')} />
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {conversations.map((summary) => {
            const { conversation } = summary
            const context = conversation.loadId
              ? loadNumbers[conversation.loadId] && t('notification.messaging.thread.loadContext', { loadNumber: loadNumbers[conversation.loadId] })
              : conversation.carrierId
                ? carrierNames[conversation.carrierId] &&
                  t('notification.messaging.thread.carrierContext', { carrierName: carrierNames[conversation.carrierId] })
                : null

            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className={cn(
                    'flex w-full flex-col gap-1 border-b border-steel-100 p-3 text-left transition-colors hover:bg-steel-50',
                    selectedId === conversation.id && 'bg-navy-50',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-carbon">
                      {conversation.subject ?? context ?? t(`notification.messaging.kind.${conversation.kind}`)}
                    </span>
                    {summary.unreadCount > 0 ? <Badge tone="navy">{summary.unreadCount}</Badge> : null}
                  </div>
                  {context ? <span className="text-xs text-steel-600">{context}</span> : null}
                  <span className="truncate text-xs text-steel-500">
                    {summary.lastMessage
                      ? summary.lastMessage.origin === 'system'
                        ? t('notification.messaging.thread.systemNote')
                        : summary.lastMessage.body
                      : t('notification.messaging.thread.empty')}
                  </span>
                  {conversation.lastMessageAt ? (
                    <span className="text-xs text-steel-400">{formatDateTime(conversation.lastMessageAt, locale, timezone)}</span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
