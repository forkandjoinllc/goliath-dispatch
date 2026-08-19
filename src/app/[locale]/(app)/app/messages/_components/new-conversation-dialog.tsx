'use client'

import * as React from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { createConversationAction } from '@/server/messaging/actions'
import type { MessageableUser } from '../_lib/queries'

export interface NewConversationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  messageableUsers: MessageableUser[]
  onCreated: (conversationId: string) => void
}

/**
 * Direct/broadcast conversation starter. `createConversationAction` already
 * re-validates that every selected participant can actually see the subject
 * (`assertUsersCanAccessSubject` in `messaging/service.ts`) — this dialog
 * only needs to collect who the caller *wants* to include, not enforce it
 * client-side.
 */
export function NewConversationDialog({ open, onOpenChange, messageableUsers, onCreated }: NewConversationDialogProps) {
  const t = useTranslate()
  const { toast } = useToast()
  const [isPending, startTransition] = React.useTransition()
  const [kind, setKind] = React.useState<'direct' | 'broadcast'>('direct')
  const [subject, setSubject] = React.useState('')
  const [selectedUserIds, setSelectedUserIds] = React.useState<string[]>([])

  function reset() {
    setKind('direct')
    setSubject('')
    setSelectedUserIds([])
  }

  function toggleUser(userId: string) {
    setSelectedUserIds((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]))
  }

  function handleSubmit() {
    if (selectedUserIds.length === 0) return
    startTransition(async () => {
      const result = await createConversationAction({
        kind,
        subject: subject.trim() || null,
        participantUserIds: selectedUserIds,
        participantRoles: Object.fromEntries(
          selectedUserIds.map((userId) => [userId, messageableUsers.find((u) => u.userId === userId)?.role ?? 'dispatcher']),
        ),
      })
      if (result.ok) {
        reset()
        onCreated(result.data.conversation.id)
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isPending) {
          if (!next) reset()
          onOpenChange(next)
        }
      }}
    >
      <DialogContent closeLabel={t('common.actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('notification.messaging.newConversation')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="new-conversation-kind">{t('notification.messaging.kind.direct')}</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as 'direct' | 'broadcast')}>
              <SelectTrigger id="new-conversation-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">{t('notification.messaging.kind.direct')}</SelectItem>
                <SelectItem value="broadcast">{t('notification.messaging.kind.broadcast')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="new-conversation-subject">{t('document.fields.title')}</Label>
            <Input
              id="new-conversation-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={200}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>{t('notification.messaging.participants.title')}</Label>
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-steel-200 p-2">
              {messageableUsers.map((user) => (
                <li key={user.userId}>
                  <label className="flex items-center gap-2 rounded p-1.5 text-sm text-carbon hover:bg-steel-50">
                    <Checkbox
                      checked={selectedUserIds.includes(user.userId)}
                      onCheckedChange={() => toggleUser(user.userId)}
                    />
                    {user.name}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t('common.actions.cancel')}
          </Button>
          <Button type="button" disabled={selectedUserIds.length === 0 || isPending} loading={isPending} onClick={handleSubmit}>
            {t('notification.messaging.newConversation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
