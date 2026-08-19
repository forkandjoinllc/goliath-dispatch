'use client'

import * as React from 'react'
import { ArrowLeft, Paperclip, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { cn } from '@/lib/utils'
import {
  addMessageAttachmentAction,
  getMessageAttachmentDownloadUrlAction,
  markConversationReadAction,
  sendMessageAction,
} from '@/server/messaging/actions'
import type { ConversationDetail } from '@/server/messaging/queries'
import type { MessageTemplateOption } from '@/server/messaging/templates'
import { messageAttachments } from '@/db/schema'

/** `db/schema/messaging.ts` exports no `$inferSelect` alias for this table (see `server/messaging/queries.ts`'s own note). */
type MessageAttachment = typeof messageAttachments.$inferSelect

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export interface ThreadPanelProps {
  detail: ConversationDetail
  currentUserId: string
  templates: MessageTemplateOption[]
  loadNumber?: string
  carrierName?: string
  onBack: () => void
  onRefresh: () => void | Promise<void>
}

/**
 * The open-conversation pane: header with context + participants, the
 * scrolling message list (attachments included), and a compose box with
 * template insertion and file attach. Sending re-runs `onRefresh` (the
 * shell's poll callback) instead of maintaining its own optimistic message
 * list, since the shell already re-fetches the full detail on every send.
 */
export function ThreadPanel({ detail, currentUserId, templates, loadNumber, carrierName, onBack, onRefresh }: ThreadPanelProps) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const { toast } = useToast()
  const [isSending, startSending] = React.useTransition()
  const [body, setBody] = React.useState('')
  const [file, setFile] = React.useState<File | null>(null)
  const [templateKey, setTemplateKey] = React.useState('')
  const [attachmentUrls, setAttachmentUrls] = React.useState<Record<string, string>>({})
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const nameByUserId = React.useMemo(() => new Map(detail.participants.map((p) => [p.userId, p.name])), [detail.participants])

  const context = loadNumber
    ? t('notification.messaging.thread.loadContext', { loadNumber })
    : carrierName
      ? t('notification.messaging.thread.carrierContext', { carrierName })
      : null

  // Mark-read-on-view: opening (or switching to) a conversation clears its unread badge.
  React.useEffect(() => {
    void markConversationReadAction({ conversationId: detail.conversation.id }).then((result) => {
      if (result.ok) void onRefresh()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.conversation.id])

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [detail.messages.length])

  function insertTemplate(key: string) {
    setTemplateKey(key)
    const template = templates.find((option) => option.key === key)
    if (!template) return
    setBody((current) => (current ? `${current}\n${template.body}` : template.body))
    setTemplateKey('')
  }

  async function downloadAttachment(attachment: MessageAttachment) {
    const cached = attachmentUrls[attachment.id]
    if (cached) {
      window.open(cached, '_blank', 'noopener,noreferrer')
      return
    }
    const result = await getMessageAttachmentDownloadUrlAction({ attachmentId: attachment.id })
    if (result.ok) {
      setAttachmentUrls((current) => ({ ...current, [attachment.id]: result.data.url }))
      window.open(result.data.url, '_blank', 'noopener,noreferrer')
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  function handleSend() {
    const trimmed = body.trim()
    if (!trimmed) return
    startSending(async () => {
      const sendResult = await sendMessageAction({ conversationId: detail.conversation.id, body: trimmed })
      if (!sendResult.ok) {
        toast({ tone: 'error', title: t(sendResult.error.messageKey, sendResult.error.params) })
        return
      }

      if (file) {
        const fileBase64 = await readFileAsBase64(file)
        const attachResult = await addMessageAttachmentAction({
          conversationId: detail.conversation.id,
          messageId: sendResult.data.id,
          originalFilename: file.name,
          fileBase64,
        })
        if (!attachResult.ok) {
          toast({ tone: 'error', title: t(attachResult.error.messageKey, attachResult.error.params) })
        }
      }

      setBody('')
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await onRefresh()
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-steel-200 p-3">
        <Button size="iconSm" variant="ghost" className="sm:hidden" aria-label={t('notification.messaging.backToList')} onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold text-carbon">
            {detail.conversation.subject ?? context ?? t(`notification.messaging.kind.${detail.conversation.kind}`)}
          </h2>
          <p className="truncate text-xs text-steel-600">
            {context ? `${context} · ` : ''}
            {detail.participants.map((p) => p.name).join(', ')}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <p className="mb-3 text-center text-xs text-steel-400">{t('notification.messaging.thread.pollingNotice')}</p>
        {detail.messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-steel-500">{t('notification.messaging.thread.empty')}</p>
        ) : (
          <ul className="space-y-3">
            {detail.messages.map((message) => {
              const isSystem = message.origin === 'system'
              const isMine = message.senderUserId === currentUserId
              const attachments = detail.attachmentsByMessage.get(message.id) ?? []
              const senderName = message.senderUserId ? nameByUserId.get(message.senderUserId) ?? '—' : null

              if (isSystem) {
                const text = message.systemKey
                  ? (t.optional(`notification.messaging.systemEvents.${message.systemKey}`, message.systemParams ?? {}) ?? message.body)
                  : message.body
                return (
                  <li key={message.id} className="text-center text-xs text-steel-500">
                    {text}
                  </li>
                )
              }

              return (
                <li key={message.id} className={cn('flex flex-col gap-1', isMine ? 'items-end' : 'items-start')}>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                      isMine ? 'bg-navy-700 text-white' : 'bg-steel-100 text-carbon',
                    )}
                  >
                    {!isMine ? <p className="mb-0.5 text-xs font-semibold opacity-80">{senderName}</p> : null}
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  </div>
                  {attachments.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((attachment) => (
                        <button
                          key={attachment.id}
                          type="button"
                          onClick={() => downloadAttachment(attachment)}
                          className="flex items-center gap-1 rounded border border-steel-200 px-2 py-1 text-xs text-navy-700 hover:bg-steel-50"
                        >
                          <Paperclip className="size-3" aria-hidden="true" />
                          {attachment.filename}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <span className="text-xs text-steel-400">
                    {isMine ? t('notification.messaging.thread.you') : senderName} · {formatDateTime(message.createdAt, locale, timezone)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="space-y-2 border-t border-steel-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <Select value={templateKey} onValueChange={insertTemplate}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder={t('notification.messaging.compose.insertTemplate')} />
            </SelectTrigger>
            <SelectContent>
              {templates.map((template) => (
                <SelectItem key={template.key} value={template.key}>
                  {template.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-1 text-xs text-steel-600">
            <Paperclip className="size-4" aria-hidden="true" />
            {file ? file.name : t('notification.messaging.compose.attach')}
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t('notification.messaging.compose.placeholder')}
            rows={2}
            maxLength={4000}
            className="flex-1"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSend()
              }
            }}
          />
          <Button type="button" disabled={!body.trim() || isSending} loading={isSending} onClick={handleSend}>
            <Send aria-hidden="true" />
            {isSending ? t('notification.messaging.compose.sending') : t('notification.messaging.compose.send')}
          </Button>
        </div>
        {detail.conversation.isOperational ? (
          <Badge tone="neutral" className="text-xs">
            {t('notification.messaging.kind.load')}
          </Badge>
        ) : null}
      </div>
    </div>
  )
}
