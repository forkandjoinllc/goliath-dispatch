'use server'

import { z } from 'zod'
import { defineAction } from '@/server/action'
import { roleEnum } from '@/db/schema/_shared'
import { uuidSchema } from '@/lib/validation'
import {
  addMessageAttachment,
  addParticipant,
  createConversation,
  getAttachmentDownloadUrl,
  leaveConversation,
  markConversationRead,
  removeParticipant,
  sendMessage,
  setMuted,
} from './service'
import { getConversationDetail, listConversationsForUser } from './queries'

/**
 * Server actions for the messaging domain.
 *
 * The permission check here is deliberately coarse (does this actor hold
 * `message:send`/`message:read` at all) — the precise, per-conversation
 * enforcement ("is this user a participant", "may this specific invitee see
 * this conversation's subject") happens in `service.ts`, which is what
 * throws the actual `forbidden` for an out-of-scope attempt.
 */

const roleSchema = z.enum(roleEnum.enumValues)

/* ── Conversations ───────────────────────────────────────────────────────── */

const createConversationInput = z.object({
  kind: z.enum(['direct', 'load', 'broadcast']),
  subject: z.string().trim().max(200).optional().nullable(),
  loadId: uuidSchema.optional().nullable(),
  carrierId: uuidSchema.optional().nullable(),
  participantUserIds: z.array(uuidSchema).min(1),
  participantRoles: z.record(z.string(), roleSchema),
  isOperational: z.boolean().optional(),
})

export const createConversationAction = defineAction({
  name: 'messaging.conversation.create',
  permission: 'message:send',
  input: createConversationInput,
  handler: (input, ctx) => createConversation(ctx.db, ctx.actor, input),
})

const conversationIdInput = z.object({ conversationId: uuidSchema })

/**
 * Read actions for the poll-driven UI. The message screens have no
 * real-time transport (see `notification.messaging.thread.pollingNotice`) —
 * the conversation list and an open thread refresh by calling these on an
 * interval, so they need a callable server action rather than the bare
 * query functions `queries.ts` exports for server components.
 */
export const listConversationsAction = defineAction({
  name: 'messaging.conversation.list',
  permission: 'message:read',
  input: z.object({}),
  handler: (_input, ctx) => listConversationsForUser(ctx.db, ctx.actor.userId),
})

const getConversationDetailInput = conversationIdInput.extend({
  before: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(500).optional(),
})

export const getConversationDetailAction = defineAction({
  name: 'messaging.conversation.detail',
  permission: 'message:read',
  input: getConversationDetailInput,
  handler: (input, ctx) =>
    getConversationDetail(ctx.db, input.conversationId, ctx.actor.userId, { before: input.before, limit: input.limit }),
})

export const leaveConversationAction = defineAction({
  name: 'messaging.conversation.leave',
  permission: 'message:read',
  input: conversationIdInput,
  handler: (input, ctx) => leaveConversation(ctx.db, ctx.actor, input.conversationId),
})

export const markConversationReadAction = defineAction({
  name: 'messaging.conversation.markRead',
  permission: 'message:read',
  input: conversationIdInput,
  handler: (input, ctx) => markConversationRead(ctx.db, ctx.actor, input.conversationId),
})

const setMutedInput = z.object({ conversationId: uuidSchema, muted: z.boolean() })

export const setConversationMutedAction = defineAction({
  name: 'messaging.conversation.mute',
  permission: 'message:read',
  input: setMutedInput,
  handler: (input, ctx) => setMuted(ctx.db, ctx.actor, input),
})

/* ── Participants ────────────────────────────────────────────────────────── */

const participantInput = z.object({ conversationId: uuidSchema, userId: uuidSchema, role: roleSchema })

export const addConversationParticipantAction = defineAction({
  name: 'messaging.participant.add',
  permission: 'message:send',
  input: participantInput,
  handler: (input, ctx) => addParticipant(ctx.db, ctx.actor, input),
})

const removeParticipantInput = z.object({ conversationId: uuidSchema, userId: uuidSchema })

export const removeConversationParticipantAction = defineAction({
  name: 'messaging.participant.remove',
  permission: 'message:send',
  input: removeParticipantInput,
  handler: (input, ctx) => removeParticipant(ctx.db, ctx.actor, input),
})

/* ── Messages ────────────────────────────────────────────────────────────── */

const sendMessageInput = z.object({
  conversationId: uuidSchema,
  body: z.string().trim().min(1).max(4000),
})

export const sendMessageAction = defineAction({
  name: 'messaging.message.send',
  permission: 'message:send',
  input: sendMessageInput,
  handler: (input, ctx) => sendMessage(ctx.db, ctx.actor, input),
})

/* ── Attachments ─────────────────────────────────────────────────────────── */

const addAttachmentInput = z.object({
  conversationId: uuidSchema,
  messageId: uuidSchema,
  originalFilename: z.string().trim().min(1).max(255),
  fileBase64: z.string().min(1),
})

export const addMessageAttachmentAction = defineAction({
  name: 'messaging.attachment.add',
  permission: 'message:send',
  input: addAttachmentInput,
  handler: (input, ctx) => {
    const bytes = Buffer.from(input.fileBase64, 'base64')
    return addMessageAttachment(ctx.db, ctx.actor, { ...input, bytes })
  },
})

const attachmentIdInput = z.object({ attachmentId: uuidSchema })

export const getMessageAttachmentDownloadUrlAction = defineAction({
  name: 'messaging.attachment.download',
  permission: 'message:read',
  input: attachmentIdInput,
  handler: (input, ctx) => getAttachmentDownloadUrl(ctx.db, ctx.actor, input.attachmentId),
})
