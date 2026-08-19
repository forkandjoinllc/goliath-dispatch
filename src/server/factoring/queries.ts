import 'server-only'
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  documents,
  factoringAssignments,
  factoringCompanies,
  type Document,
  type FactoringAssignment,
  type FactoringCompany,
} from '@/db/schema'
import type { ScopeFilter } from '@/lib/permissions/check'

function factoringScopeClause(scope: ScopeFilter): SQL | 'empty' | undefined {
  switch (scope.kind) {
    case 'carrier':
      return scope.carrierId ? eq(factoringAssignments.carrierId, scope.carrierId) : 'empty'
    case 'assigned':
    case 'own':
      return 'empty'
    case 'tenant':
    case 'platform':
    default:
      return undefined
  }
}

export async function listFactoringCompanies(
  db: TenantDb,
  options: { activeOnly?: boolean } = {},
): Promise<FactoringCompany[]> {
  return db.findMany(factoringCompanies, {
    where: options.activeOnly ? eq(factoringCompanies.active, true) : undefined,
    orderBy: desc(factoringCompanies.name),
  })
}

export interface ListFactoringAssignmentsOptions {
  carrierId?: string
}

export async function listFactoringAssignments(
  db: TenantDb,
  scope: ScopeFilter,
  options: ListFactoringAssignmentsOptions = {},
): Promise<FactoringAssignment[]> {
  const scoped = factoringScopeClause(scope)
  if (scoped === 'empty') return []

  const clauses: SQL[] = []
  if (scoped) clauses.push(scoped)
  if (options.carrierId) clauses.push(eq(factoringAssignments.carrierId, options.carrierId))

  return db.findMany(factoringAssignments, {
    where: clauses.length > 0 ? and(...clauses) : undefined,
    orderBy: desc(factoringAssignments.createdAt),
  })
}

/** Only assignments with no `effectiveTo` (or one in the future) count as currently active. */
export async function activeFactoringAssignmentForCarrier(
  db: TenantDb,
  carrierId: string,
): Promise<FactoringAssignment | null> {
  const rows = await db.findMany(factoringAssignments, {
    where: and(eq(factoringAssignments.carrierId, carrierId), isNull(factoringAssignments.effectiveTo)),
    orderBy: desc(factoringAssignments.createdAt),
  })
  return rows[0] ?? null
}

export interface FactoringAssignmentDetail {
  assignment: FactoringAssignment
  company: FactoringCompany | null
  noticeOfAssignmentDocument: Document | null
  changeOfPayeeDocument: Document | null
}

export async function getFactoringAssignmentDetail(
  db: TenantDb,
  assignmentId: string,
): Promise<FactoringAssignmentDetail | null> {
  const assignment = await db.findById(factoringAssignments, assignmentId)
  if (!assignment) return null

  const [company, noaDocument, copDocument] = await Promise.all([
    db.findById(factoringCompanies, assignment.factoringCompanyId),
    assignment.noticeOfAssignmentDocumentId ? db.findById(documents, assignment.noticeOfAssignmentDocumentId) : null,
    assignment.changeOfPayeeDocumentId ? db.findById(documents, assignment.changeOfPayeeDocumentId) : null,
  ])

  return {
    assignment,
    company,
    noticeOfAssignmentDocument: noaDocument,
    changeOfPayeeDocument: copDocument,
  }
}
