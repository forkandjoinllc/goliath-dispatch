import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  conversationParticipants,
  conversations,
  messageAttachments,
  messages,
  type Conversation,
  type Message,
} from '@/db/schema'
import type { Actor, Role } from '@/lib/permissions'
import { AppError, forbidden, notFound } from '@/lib/errors'
import { sha256Hex } from '@/lib/crypto'
import {
  DOCUMENT_UPLOAD_POLICY,
  assertKeyBelongsToTenant,
  getMalwareScanner,
  getStorage,
  sanitizeFilename,
  validateUpload,
} from '@/lib/storage'
import { assertUsersCanAccessSubject, requireActiveMember } from './access'

/** `db/schema/messaging.ts` exports no `$inferSelect` type alias for these two tables. */
type ConversationParticipant = typeof conversationParticipants.$inferSelect
type MessageAttachment = typeof messageAttachments.$inferSelect

/**
 * The in-app messaging domain.
 *
 * As with `documents/service.ts` and `carriers/service.ts`, nothing here
 * checks permissions on the calling actor's own operation-level grant (that
 * already happened in `defineAction`) — but it is the layer that enforces
 * two invariants the architecture calls out specifically for messaging:
 * a conversation's participant list may only include users who could see
 * the subject it is attached to, and reading/writing a conversation requires
 * active participation, checked here, not trusted from the client.
 */

async function requireParticipant(db: TenantDb, conversationId: string, userId: string): Promise<ConversationParticipant> {
  const participant = await db.findFirst(conversationParticipants, {
    where: and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.userId, userId),
      isNull(conversationParticipants.leftAt),
    )!,
  })
  if (!participant) throw forbidden('errors.outOfScope', { entity: 'conversation' })
  return participant
}

/* ── Create ──────────────────────────────────────────────────────────────── */

export interface CreateConversationInput {
  kind: 'direct' | 'load' | 'broadcast'
  subject?: string | null
  loadId?: string | null
  carrierId?: string | null
  participantUserIds: string[]
  participantRoles: Record<string, Role>
  isOperational?: boolean
}

export interface CreateConversationResult {
  conversation: Conversation
  participants: ConversationParticipant[]
}

/**
 * `input.participantRoles` records the role each participant is playing in
 * *this* conversation (usually their tenant role, but a carrier user reading
 * a load thread participates "as carrier" regardless of what other roles
 * they might also hold) — it is what renders in the thread header, not what
 * the scope check runs on. The scope check itself runs on the caller's real
 * membership facts (`assertUsersCanAccessSubject`), never on this
 * caller-supplied label.
 */
export async function createConversation(
  db: TenantDb,
  actor: Actor,
  input: CreateConversationInput,
): Promise<CreateConversationResult> {
  const participantIds = [...new Set([actor.userId, ...input.participantUserIds])]
  const resource = { tenantId: db.tenantId, carrierId: input.carrierId ?? null }

  // A conversation tied to a load or carrier is scoped like everything else
  // that subject would be — `message:read`'s role matrix already encodes
  // "tenant for admin/accounting, assigned for a dispatcher on that carrier,
  // carrier for that carrier's own users, own for a driver". A conversation
  // with neither a `loadId` nor a `carrierId` has no scoping fact to check
  // against, so only a tenant-scope role (Admin/Accounting) may start one —
  // everyone else must anchor a conversation to a load or carrier they can
  // already see.
  await assertUsersCanAccessSubject(db, participantIds, 'message:read', resource)

  return db.transaction(async (tx) => {
    const conversation = await tx.insert(conversations, {
      subject: input.subject ?? null,
      loadId: input.loadId ?? null,
      carrierId: input.carrierId ?? null,
      kind: input.kind,
      isOperational: input.isOperational ?? input.kind === 'load',
      createdByUserId: actor.userId,
    })

    const participants = await tx.insertMany(
      conversationParticipants,
      participantIds.map((userId) => ({
        conversationId: conversation.id,
        userId,
        role: input.participantRoles[userId] ?? 'dispatcher',
      })),
    )

    return { conversation, participants }
  })
}

/* ── Participants ────────────────────────────────────────────────────────── */

export async function addParticipant(
  db: TenantDb,
  actor: Actor,
  input: { conversationId: string; userId: string; role: Role },
): Promise<ConversationParticipant> {
  const conversation = await db.requireById(conversations, input.conversationId, 'conversation')
  await requireParticipant(db, conversation.id, actor.userId)
  await assertUsersCanAccessSubject(db, [input.userId], 'message:read', {
    tenantId: db.tenantId,
    carrierId: conversation.carrierId,
  })

  const existing = await db.findFirst(conversationParticipants, {
    where: and(
      eq(conversationParticipants.conversationId, conversation.id),
      eq(conversationParticipants.userId, input.userId),
    )!,
  })
  if (existing) {
    const updated = await db.update(conversationParticipants, existing.id, { leftAt: null, role: input.role })
    return updated ?? existing
  }

  return db.insert(conversationParticipants, {
    conversationId: conversation.id,
    userId: input.userId,
    role: input.role,
  })
}

export async function leaveConversation(db: TenantDb, actor: Actor, conversationId: string): Promise<ConversationParticipant> {
  const participant = await requireParticipant(db, conversationId, actor.userId)
  const updated = await db.update(conversationParticipants, participant.id, { leftAt: new Date() })
  if (!updated) throw notFound('errors.notFound', { entity: 'conversationParticipant' })
  return updated
}

export async function removeParticipant(
  db: TenantDb,
  actor: Actor,
  input: { conversationId: string; userId: string },
): Promise<ConversationParticipant> {
  await requireParticipant(db, input.conversationId, actor.userId)
  const target = await db.findFirst(conversationParticipants, {
    where: and(
      eq(conversationParticipants.conversationId, input.conversationId),
      eq(conversationParticipants.userId, input.userId),
      isNull(conversationParticipants.leftAt),
    )!,
  })
  if (!target) throw notFound('errors.notFound', { entity: 'conversationParticipant' })
  const updated = await db.update(conversationParticipants, target.id, { leftAt: new Date() })
  return updated ?? target
}

export async function setMuted(
  db: TenantDb,
  actor: Actor,
  input: { conversationId: string; muted: boolean },
): Promise<ConversationParticipant> {
  const participant = await requireParticipant(db, input.conversationId, actor.userId)
  const updated = await db.update(conversationParticipants, participant.id, {
    mutedAt: input.muted ? new Date() : null,
  })
  return updated ?? participant
}

export async function markConversationRead(db: TenantDb, actor: Actor, conversationId: string): Promise<ConversationParticipant> {
  const participant = await requireParticipant(db, conversationId, actor.userId)
  const updated = await db.update(conversationParticipants, participant.id, { lastReadAt: new Date() })
  return updated ?? participant
}

/* ── Messages ────────────────────────────────────────────────────────────── */

export interface SendMessageInput {
  conversationId: string
  body: string
}

export async function sendMessage(db: TenantDb, actor: Actor, input: SendMessageInput): Promise<Message> {
  await requireParticipant(db, input.conversationId, actor.userId)

  return db.transaction(async (tx) => {
    const message = await tx.insert(messages, {
      conversationId: input.conversationId,
      senderUserId: actor.userId,
      origin: 'user',
      body: input.body,
    })
    await tx.update(conversations, input.conversationId, { lastMessageAt: message.createdAt })
    // The sender has, by definition, read up to the message they just sent.
    const participant = await tx.findFirst(conversationParticipants, {
      where: and(
        eq(conversationParticipants.conversationId, input.conversationId),
        eq(conversationParticipants.userId, actor.userId),
      )!,
    })
    if (participant) await tx.update(conversationParticipants, participant.id, { lastReadAt: message.createdAt })
    return message
  })
}

export interface SendSystemMessageInput {
  conversationId: string
  /** i18n key under `notification.messaging.systemEvents.<key>` — never baked English. */
  systemKey: string
  systemParams?: Record<string, string | number>
}

/**
 * A status-change note ("Load #4821 moved to In Transit") that must render
 * in each reader's own language. `body` here is a stable, untranslated
 * fallback (the key itself) for any surface that renders raw message rows
 * without going through the i18n layer — the messages screen always prefers
 * `systemKey`/`systemParams` when present.
 */
export async function sendSystemMessage(db: TenantDb, input: SendSystemMessageInput): Promise<Message> {
  return db.transaction(async (tx) => {
    const message = await tx.insert(messages, {
      conversationId: input.conversationId,
      senderUserId: null,
      origin: 'system',
      body: input.systemKey,
      systemKey: input.systemKey,
      systemParams: input.systemParams ?? {},
    })
    await tx.update(conversations, input.conversationId, { lastMessageAt: message.createdAt })
    return message
  })
}

/* ── Attachments ─────────────────────────────────────────────────────────── */

function buildAttachmentKey(tenantId: string, conversationId: string, messageId: string, filename: string): string {
  const safe = sanitizeFilename(filename)
  return `tenants/${tenantId}/conversations/${conversationId}/messages/${messageId}/${safe}`
}

export interface AddAttachmentInput {
  conversationId: string
  messageId: string
  originalFilename: string
  bytes: Buffer
}

/**
 * Same validation pipeline as `documents/service.ts`'s upload (size/type
 * sniffing, malware scan) so an attachment can never carry a file type or
 * payload a document upload would have rejected — the storage key just lives
 * under `conversations/` instead of `documents/`.
 */
export async function addMessageAttachment(
  db: TenantDb,
  actor: Actor,
  input: AddAttachmentInput,
): Promise<MessageAttachment> {
  const message = await db.requireById(messages, input.messageId, 'message')
  if (message.conversationId !== input.conversationId) {
    throw notFound('errors.notFound', { entity: 'message' })
  }
  await requireParticipant(db, input.conversationId, actor.userId)

  const sniffed = validateUpload(input.bytes, DOCUMENT_UPLOAD_POLICY)
  const scanResult = await getMalwareScanner().scan(input.bytes)
  if (!scanResult.clean) {
    throw new AppError('validation_failed', 'errors.malwareDetected', {
      detail: { signature: scanResult.signature },
    })
  }

  const key = buildAttachmentKey(db.tenantId, input.conversationId, input.messageId, input.originalFilename)
  assertKeyBelongsToTenant(key, db.tenantId)
  await getStorage().put({ key, body: input.bytes, contentType: sniffed.mimeType })

  return db.insert(messageAttachments, {
    messageId: input.messageId,
    storageKey: key,
    filename: sanitizeFilename(input.originalFilename),
    contentType: sniffed.mimeType,
    byteSize: input.bytes.byteLength,
    sha256: sha256Hex(input.bytes),
  })
}

export async function getAttachmentDownloadUrl(
  db: TenantDb,
  actor: Actor,
  attachmentId: string,
): Promise<{ url: string; attachment: MessageAttachment }> {
  const attachment = await db.requireById(messageAttachments, attachmentId, 'messageAttachment')
  const message = await db.requireById(messages, attachment.messageId, 'message')
  await requireParticipant(db, message.conversationId, actor.userId)

  assertKeyBelongsToTenant(attachment.storageKey, db.tenantId)
  const url = await getStorage().signedDownloadUrl(attachment.storageKey)
  return { url, attachment }
}

/** Used by `access.ts` callers and the actions layer alike. */
export { requireActiveMember }
