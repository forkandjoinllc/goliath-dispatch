import 'server-only'
import { and, asc, desc, eq, inArray, isNull, lt } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  conversationParticipants,
  conversations,
  messageAttachments,
  messages,
  users,
  type Conversation,
  type Message,
} from '@/db/schema'
import { fullName } from '@/lib/utils'
import { forbidden } from '@/lib/errors'

/** `db/schema/messaging.ts` exports no `$inferSelect` type alias for these two tables. */
type ConversationParticipant = typeof conversationParticipants.$inferSelect
type MessageAttachment = typeof messageAttachments.$inferSelect

/**
 * Read models for the messaging domain.
 *
 * Every function here that takes a `userId` is the enforcement point for
 * "reading a conversation requires participation" — there is no query below
 * that returns a conversation's content without first confirming the caller
 * is (or was) a participant.
 */

export interface ConversationParticipantView extends ConversationParticipant {
  name: string
}

export interface ConversationSummary {
  conversation: Conversation
  participants: ConversationParticipantView[]
  lastMessage: Message | null
  unreadCount: number
}

async function activeParticipantRow(
  db: TenantDb,
  conversationId: string,
  userId: string,
): Promise<ConversationParticipant | null> {
  return db.findFirst(conversationParticipants, {
    where: and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.userId, userId),
    )!,
  })
}

async function participantNames(
  db: TenantDb,
  participants: ConversationParticipant[],
): Promise<ConversationParticipantView[]> {
  const userIds = [...new Set(participants.map((p) => p.userId))]
  const rows =
    userIds.length > 0
      ? await db.builderRequiringExplicitTenantPredicate
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, userIds))
      : []
  const nameById = new Map(rows.map((r) => [r.id, fullName(r)]))
  return participants.map((p) => ({ ...p, name: nameById.get(p.userId) ?? '—' }))
}

/** Every conversation the user participates in (including ones they've left, for history), newest activity first. */
export async function listConversationsForUser(db: TenantDb, userId: string): Promise<ConversationSummary[]> {
  const myParticipations = await db.findMany(conversationParticipants, {
    where: eq(conversationParticipants.userId, userId),
  })
  if (myParticipations.length === 0) return []

  const conversationIds = myParticipations.map((p) => p.conversationId)
  const myParticipationByConversation = new Map(myParticipations.map((p) => [p.conversationId, p]))

  const rows = await db.findMany(conversations, {
    where: inArray(conversations.id, conversationIds),
    orderBy: desc(conversations.lastMessageAt),
  })

  const [allParticipants, lastMessages] = await Promise.all([
    db.findMany(conversationParticipants, {
      where: and(inArray(conversationParticipants.conversationId, conversationIds), isNull(conversationParticipants.leftAt))!,
    }),
    db.findMany(messages, {
      where: inArray(messages.conversationId, conversationIds),
      orderBy: desc(messages.createdAt),
    }),
  ])

  const lastMessageByConversation = new Map<string, Message>()
  for (const message of lastMessages) {
    if (!lastMessageByConversation.has(message.conversationId)) {
      lastMessageByConversation.set(message.conversationId, message)
    }
  }

  const unreadByConversation = new Map<string, number>()
  for (const message of lastMessages) {
    const mine = myParticipationByConversation.get(message.conversationId)
    if (!mine || !mine.lastReadAt || message.createdAt.getTime() > mine.lastReadAt.getTime()) {
      unreadByConversation.set(message.conversationId, (unreadByConversation.get(message.conversationId) ?? 0) + 1)
    }
  }

  const summaries: ConversationSummary[] = []
  for (const conversation of rows) {
    const participants = allParticipants.filter((p) => p.conversationId === conversation.id)
    summaries.push({
      conversation,
      participants: await participantNames(db, participants),
      lastMessage: lastMessageByConversation.get(conversation.id) ?? null,
      unreadCount: unreadByConversation.get(conversation.id) ?? 0,
    })
  }
  return summaries
}

export interface ConversationDetail {
  conversation: Conversation
  participants: ConversationParticipantView[]
  messages: Message[]
  attachmentsByMessage: Map<string, MessageAttachment[]>
  myParticipant: ConversationParticipant
}

export interface ListMessagesOptions {
  limit?: number
  before?: Date
}

/** Throws `forbidden` unless `userId` is (or was) a participant — this is the read-side access gate. */
export async function getConversationDetail(
  db: TenantDb,
  conversationId: string,
  userId: string,
  options: ListMessagesOptions = {},
): Promise<ConversationDetail> {
  const myParticipant = await activeParticipantRow(db, conversationId, userId)
  if (!myParticipant) throw forbidden('errors.outOfScope', { entity: 'conversation' })

  const conversation = await db.requireById(conversations, conversationId, 'conversation')

  const where = options.before
    ? and(eq(messages.conversationId, conversationId), lt(messages.createdAt, options.before))!
    : eq(messages.conversationId, conversationId)

  const rows = await db.findMany(messages, {
    where,
    orderBy: asc(messages.createdAt),
    limit: options.limit ?? 200,
  })

  const participants = await db.findMany(conversationParticipants, {
    where: eq(conversationParticipants.conversationId, conversationId),
  })

  const attachments =
    rows.length > 0
      ? await db.findMany(messageAttachments, { where: inArray(messageAttachments.messageId, rows.map((r) => r.id)) })
      : []
  const attachmentsByMessage = new Map<string, MessageAttachment[]>()
  for (const attachment of attachments) {
    const list = attachmentsByMessage.get(attachment.messageId) ?? []
    list.push(attachment)
    attachmentsByMessage.set(attachment.messageId, list)
  }

  return {
    conversation,
    participants: await participantNames(db, participants),
    messages: rows,
    attachmentsByMessage,
    myParticipant,
  }
}

/** Total unread message count across every conversation the user participates in — for the shell's unread badge. */
export async function unreadCountForUser(db: TenantDb, userId: string): Promise<number> {
  const summaries = await listConversationsForUser(db, userId)
  return summaries.reduce((total, s) => total + s.unreadCount, 0)
}

/** True when `userId` is (or was) a participant — used by the download route before signing an attachment URL. */
export async function isOrWasParticipant(db: TenantDb, conversationId: string, userId: string): Promise<boolean> {
  return Boolean(await activeParticipantRow(db, conversationId, userId))
}
