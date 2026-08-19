'use client'

import * as React from 'react'
import { Download, FileSpreadsheet, FileText, FileType } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { requestExportAction, downloadExportAction, getExportJobAction, listExportJobsAction } from '@/server/exports/actions'

type ExportFormat = 'csv' | 'xlsx' | 'pdf'
type ExportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

interface ExportJobView {
  id: string
  format: string
  status: ExportJobStatus
  createdAt: Date
  rowCount: number | null
  errorMessage: string | null
}

export interface ExportPanelProps {
  reportKey: string
  filters: Record<string, unknown>
  initialJobs: ExportJobView[]
}

const FORMAT_ICON: Record<ExportFormat, React.ElementType> = { csv: FileText, xlsx: FileSpreadsheet, pdf: FileType }

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 60_000

export function ExportPanel({ reportKey, filters, initialJobs }: ExportPanelProps) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const { toast } = useToast()
  const [jobs, setJobs] = React.useState<ExportJobView[]>(initialJobs)
  const [pendingFormat, setPendingFormat] = React.useState<ExportFormat | null>(null)

  async function refreshJobs() {
    const result = await listExportJobsAction({ reportKey })
    if (result.ok) setJobs(result.data as unknown as ExportJobView[])
  }

  async function pollJob(jobId: string, deadline: number) {
    const result = await getExportJobAction({ exportJobId: jobId })
    if (!result.ok) return
    const job = result.data as unknown as ExportJobView
    setJobs((prev) => {
      const next = prev.filter((j) => j.id !== job.id)
      return [job, ...next]
    })
    if (job.status === 'succeeded' || job.status === 'failed') {
      setPendingFormat(null)
      if (job.status === 'failed') {
        toast({ tone: 'error', title: t('report.export.failed') })
      } else {
        toast({ tone: 'success', title: t('report.export.ready') })
      }
      return
    }
    if (Date.now() < deadline) {
      setTimeout(() => pollJob(jobId, deadline), POLL_INTERVAL_MS)
    } else {
      setPendingFormat(null)
    }
  }

  async function handleRequest(format: ExportFormat) {
    setPendingFormat(format)
    const result = await requestExportAction({ reportKey, format, filters })
    if (!result.ok) {
      setPendingFormat(null)
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      return
    }
    await refreshJobs()
    void pollJob(result.data.id, Date.now() + POLL_TIMEOUT_MS)
  }

  async function handleDownload(jobId: string) {
    const result = await downloadExportAction({ exportJobId: jobId })
    if (!result.ok) {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      return
    }
    window.open(result.data.url, '_blank', 'noopener,noreferrer')
  }

  const statusTone: Record<ExportJobStatus, 'neutral' | 'warning' | 'success' | 'danger'> = {
    queued: 'neutral',
    running: 'warning',
    succeeded: 'success',
    failed: 'danger',
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('report.export.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(['csv', 'xlsx', 'pdf'] as const).map((format) => {
            const Icon = FORMAT_ICON[format]
            return (
              <Button
                key={format}
                type="button"
                variant="secondary"
                loading={pendingFormat === format}
                disabled={pendingFormat !== null && pendingFormat !== format}
                onClick={() => handleRequest(format)}
              >
                <Icon className="size-4" aria-hidden="true" />
                {t(`report.export.formats.${format}`)}
              </Button>
            )
          })}
        </div>

        {jobs.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-steel-600">{t('report.export.history')}</p>
            <ul className="space-y-1.5">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-steel-200 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={statusTone[job.status]}>{t(`report.export.status.${job.status}`)}</Badge>
                    <span className="font-mono text-xs uppercase text-steel-600">{job.format}</span>
                    <span className="text-xs text-steel-500">{formatDateTime(job.createdAt, locale, timezone)}</span>
                    {job.rowCount != null ? (
                      <span className="text-xs text-steel-500">{t('report.export.rowCount', { count: job.rowCount })}</span>
                    ) : null}
                  </div>
                  {job.status === 'succeeded' ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => handleDownload(job.id)}>
                      <Download className="size-4" aria-hidden="true" />
                      {t('report.export.download')}
                    </Button>
                  ) : job.status === 'failed' && job.errorMessage ? (
                    <span className="text-xs text-danger-700">{job.errorMessage}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
