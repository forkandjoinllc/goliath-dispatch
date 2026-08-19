'use client'

import * as React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { updateNotificationPreferenceAction } from '@/server/auth/actions'

export interface PreferenceRow {
  eventKey: string
  label: string
  inApp: boolean
  email: boolean
  sms: boolean
}

type Channel = 'inApp' | 'email' | 'sms'

export function PreferencesForm({ rows: initialRows }: { rows: PreferenceRow[] }) {
  const t = useTranslate()
  const { toast } = useToast()
  const [rows, setRows] = React.useState(initialRows)
  const [savingKey, setSavingKey] = React.useState<string | null>(null)

  async function toggle(eventKey: string, channel: Channel, value: boolean) {
    const previous = rows
    setRows((current) => current.map((r) => (r.eventKey === eventKey ? { ...r, [channel]: value } : r)))
    setSavingKey(eventKey)

    const row = rows.find((r) => r.eventKey === eventKey)
    if (!row) return
    const result = await updateNotificationPreferenceAction({
      eventKey,
      inApp: channel === 'inApp' ? value : row.inApp,
      email: channel === 'email' ? value : row.email,
      sms: channel === 'sms' ? value : row.sms,
    })
    setSavingKey(null)

    if (result.ok) {
      toast({ tone: 'success', title: t('settings.preferences.saved') })
    } else {
      setRows(previous)
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  return (
    <Card>
      <CardContent>
        <Table>
          <TableCaption className="sr-only">{t('settings.preferences.title')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common.labels.name')}</TableHead>
              <TableHead>{t('settings.preferences.channelInApp')}</TableHead>
              <TableHead>{t('settings.preferences.channelEmail')}</TableHead>
              <TableHead>{t('settings.preferences.channelSms')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.eventKey}>
                <TableCell>{row.label}</TableCell>
                <TableCell>
                  <Switch
                    checked={row.inApp}
                    disabled={savingKey === row.eventKey}
                    onCheckedChange={(v) => void toggle(row.eventKey, 'inApp', v === true)}
                    aria-label={`${row.label} — ${t('settings.preferences.channelInApp')}`}
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={row.email}
                    disabled={savingKey === row.eventKey}
                    onCheckedChange={(v) => void toggle(row.eventKey, 'email', v === true)}
                    aria-label={`${row.label} — ${t('settings.preferences.channelEmail')}`}
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={row.sms}
                    disabled={savingKey === row.eventKey}
                    onCheckedChange={(v) => void toggle(row.eventKey, 'sms', v === true)}
                    aria-label={`${row.label} — ${t('settings.preferences.channelSms')}`}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
