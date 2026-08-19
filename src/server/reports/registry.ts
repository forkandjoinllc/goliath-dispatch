import 'server-only'
import type { ReportDefinition } from './types'
import { revenueMarginReport } from './definitions/revenue-margin'
import { loadPerformanceReport } from './definitions/load-performance'
import { carrierScorecardReport } from './definitions/carrier-scorecard'
import { dispatcherPerformanceReport } from './definitions/dispatcher-performance'
import { receivablesAgingReport } from './definitions/receivables-aging'
import { settlementSummaryReport } from './definitions/settlement-summary'
import { documentComplianceReport } from './definitions/document-compliance'
import { onboardingPipelineReport } from './definitions/onboarding-pipeline'
import { equipmentDriverUtilizationReport } from './definitions/equipment-driver-utilization'
import { oversizeActivityReport } from './definitions/oversize-activity'
import { auditActivityReport } from './definitions/audit-activity'

/**
 * The report registry. This is the one place a new report is wired in — the
 * export job handler and the `app/reports` UI both resolve reports through
 * `getReport()` / `listReports()`, never by importing a definition file
 * directly, so a report cannot be reachable from one surface and not the
 * other.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const REPORT_REGISTRY: Record<string, ReportDefinition<any>> = {
  [revenueMarginReport.key]: revenueMarginReport,
  [loadPerformanceReport.key]: loadPerformanceReport,
  [carrierScorecardReport.key]: carrierScorecardReport,
  [dispatcherPerformanceReport.key]: dispatcherPerformanceReport,
  [receivablesAgingReport.key]: receivablesAgingReport,
  [settlementSummaryReport.key]: settlementSummaryReport,
  [documentComplianceReport.key]: documentComplianceReport,
  [onboardingPipelineReport.key]: onboardingPipelineReport,
  [equipmentDriverUtilizationReport.key]: equipmentDriverUtilizationReport,
  [oversizeActivityReport.key]: oversizeActivityReport,
  [auditActivityReport.key]: auditActivityReport,
}

export type ReportKey = keyof typeof REPORT_REGISTRY

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getReport(key: string): ReportDefinition<any> | null {
  return REPORT_REGISTRY[key] ?? null
}

export function listReports() {
  return Object.values(REPORT_REGISTRY)
}
