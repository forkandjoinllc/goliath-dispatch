import 'server-only'
import { eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  carriers,
  factoringAssignments,
  factoringCompanies,
  type Carrier,
  type FactoringAssignment,
  type FactoringCompany,
} from '@/db/schema'
import type { verificationStatusEnum } from '@/db/schema/_shared'
import { conflict, notFound } from '@/lib/errors'
import type { Actor } from '@/lib/permissions'
import { uploadDocument } from '@/server/documents/service'

/**
 * Factoring — entirely a MANUAL workflow. There is no factoring API: every
 * function here records what a human confirmed happened (a document was
 * received, a company was verified, proceeds were submitted) rather than
 * calling out to any funding integration. Screens built on this module must
 * say so explicitly — see `finance.json`'s `factoring.manualNotice*` keys —
 * and never render copy implying an automated funding integration exists.
 */

export type FactoringVerificationStatus = (typeof verificationStatusEnum.enumValues)[number]

/* ── Factoring companies ──────────────────────────────────────────────────── */

export interface CreateFactoringCompanyInput {
  name: string
  contactName?: string | null
  email?: string | null
  phone?: string | null
  addressLine1?: string | null
  addressCity?: string | null
  addressState?: string | null
  addressPostalCode?: string | null
  fundingInstructions?: string | null
}

export async function createFactoringCompany(
  db: TenantDb,
  input: CreateFactoringCompanyInput,
): Promise<FactoringCompany> {
  const nameTaken = await db.exists(factoringCompanies, eq(factoringCompanies.name, input.name))
  if (nameTaken) {
    throw conflict('finance.errors.factoringCompanyNameTaken', { name: input.name })
  }
  return db.insert(factoringCompanies, {
    name: input.name,
    contactName: input.contactName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    addressLine1: input.addressLine1 ?? null,
    addressCity: input.addressCity ?? null,
    addressState: input.addressState ?? null,
    addressPostalCode: input.addressPostalCode ?? null,
    fundingInstructions: input.fundingInstructions ?? null,
  })
}

export type UpdateFactoringCompanyInput = Partial<CreateFactoringCompanyInput> & { active?: boolean }

export async function updateFactoringCompany(
  db: TenantDb,
  companyId: string,
  input: UpdateFactoringCompanyInput,
): Promise<FactoringCompany> {
  const company = await db.requireById(factoringCompanies, companyId, 'factoringCompany')
  const updated = await db.update(factoringCompanies, companyId, {
    name: input.name ?? company.name,
    contactName: input.contactName ?? company.contactName,
    email: input.email ?? company.email,
    phone: input.phone ?? company.phone,
    addressLine1: input.addressLine1 ?? company.addressLine1,
    addressCity: input.addressCity ?? company.addressCity,
    addressState: input.addressState ?? company.addressState,
    addressPostalCode: input.addressPostalCode ?? company.addressPostalCode,
    fundingInstructions: input.fundingInstructions ?? company.fundingInstructions,
    active: input.active ?? company.active,
  })
  if (!updated) throw notFound('finance.errors.factoringCompanyNotFound')
  return updated
}

export async function deleteFactoringCompany(
  db: TenantDb,
  actor: { userId: string },
  companyId: string,
  reason?: string,
): Promise<FactoringCompany> {
  const inUse = await db.exists(factoringAssignments, eq(factoringAssignments.factoringCompanyId, companyId))
  if (inUse) {
    throw conflict('finance.errors.factoringCompanyInUse')
  }
  const deleted = await db.softDelete(factoringCompanies, companyId, actor.userId, reason)
  if (!deleted) throw notFound('finance.errors.factoringCompanyNotFound')
  return deleted
}

/* ── Carrier assignments ──────────────────────────────────────────────────── */

export interface CreateFactoringAssignmentInput {
  carrierId: string
  factoringCompanyId: string
  effectiveFrom?: Date | null
  notes?: string | null
}

/** A new assignment always starts `not_started` — verification is a manual step performed afterward. */
export async function createFactoringAssignment(
  db: TenantDb,
  input: CreateFactoringAssignmentInput,
): Promise<FactoringAssignment> {
  await db.requireById(carriers, input.carrierId, 'carrier')
  await db.requireById(factoringCompanies, input.factoringCompanyId, 'factoringCompany')

  return db.insert(factoringAssignments, {
    carrierId: input.carrierId,
    factoringCompanyId: input.factoringCompanyId,
    verificationStatus: 'not_started',
    effectiveFrom: input.effectiveFrom ?? new Date(),
    notes: input.notes ?? null,
  })
}

export async function endFactoringAssignment(
  db: TenantDb,
  assignmentId: string,
  effectiveTo: Date = new Date(),
): Promise<FactoringAssignment> {
  const updated = await db.update(factoringAssignments, assignmentId, { effectiveTo })
  if (!updated) throw notFound('finance.errors.factoringAssignmentNotFound')
  return updated
}

/**
 * The manual verification step: an Admin/Accounting user confirms (by phone,
 * email, or a signed document) that the factoring relationship is real and
 * records the outcome here. Nothing is checked automatically.
 */
export async function setFactoringVerificationStatus(
  db: TenantDb,
  actor: Actor,
  assignmentId: string,
  status: FactoringVerificationStatus,
  reason?: string | null,
): Promise<FactoringAssignment> {
  const assignment = await db.requireById(factoringAssignments, assignmentId, 'factoringAssignment')
  const updated = await db.update(factoringAssignments, assignmentId, {
    verificationStatus: status,
    verifiedByUserId: status === 'verified' ? actor.userId : assignment.verifiedByUserId,
    verifiedAt: status === 'verified' ? new Date() : assignment.verifiedAt,
    notes: reason ? appendNote(assignment.notes, reason) : assignment.notes,
  })
  if (!updated) throw notFound('finance.errors.factoringAssignmentNotFound')
  return updated
}

export type FactoringDocumentKind = 'notice_of_assignment' | 'change_of_payee'

export interface UploadFactoringDocumentInput {
  assignmentId: string
  kind: FactoringDocumentKind
  originalFilename: string
  bytes: Buffer
}

/**
 * Attaches a Notice of Assignment or Change of Payee document to an
 * assignment. This is filing paperwork the tenant already obtained by hand
 * — uploading it does not submit anything to the factor or trigger any
 * verification; that remains `setFactoringVerificationStatus`, performed
 * explicitly by a human.
 */
export async function uploadFactoringDocument(
  db: TenantDb,
  actor: Actor,
  input: UploadFactoringDocumentInput,
): Promise<FactoringAssignment> {
  return db.transaction(async (tx) => {
    const assignment = await tx.requireById(factoringAssignments, input.assignmentId, 'factoringAssignment')

    const { document } = await uploadDocument(tx, actor, {
      ownerType: 'carrier',
      ownerId: assignment.carrierId,
      documentType: input.kind,
      originalFilename: input.originalFilename,
      bytes: input.bytes,
    })

    const patch =
      input.kind === 'notice_of_assignment'
        ? { noticeOfAssignmentDocumentId: document.id }
        : { changeOfPayeeDocumentId: document.id }

    const updated = await tx.update(factoringAssignments, assignment.id, patch)
    if (!updated) throw notFound('finance.errors.factoringAssignmentNotFound')
    return updated
  })
}

function appendNote(existing: string | null, addition: string): string {
  return existing ? `${existing}\n${addition}` : addition
}

export type { Carrier, FactoringAssignment, FactoringCompany }
