'use client'

import * as React from 'react'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { addMonths, format } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './button'
import { Input } from './input'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { CalendarGrid, zoneAbbreviation } from './date-picker'

export interface DateTimePickerProps {
  /** ISO-8601 UTC instant, or null. */
  value: string | null
  onChange: (utcIso: string | null) => void
  timeZone: string
  localeTag: string
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  id?: string
  'aria-describedby'?: string
  openLabel: string
  todayLabel: string
  prevMonthLabel: string
  nextMonthLabel: string
  weekdayLabels: string[]
  clearLabel: string
  timeLabel: string
}

/**
 * Timezone-aware date + time picker. Appointment windows are stored as UTC
 * instants but dispatchers and carriers must read and enter them in the
 * *stop's* local time — this component is the single place that conversion
 * happens, via `date-fns-tz`.
 */
export function DateTimePicker({
  value,
  onChange,
  timeZone,
  localeTag,
  placeholder,
  invalid,
  disabled,
  id,
  openLabel,
  todayLabel,
  prevMonthLabel,
  nextMonthLabel,
  weekdayLabels,
  clearLabel,
  timeLabel,
  ...aria
}: DateTimePickerProps) {
  const zonedSelected = value ? toZonedTime(new Date(value), timeZone) : null
  const [open, setOpen] = React.useState(false)
  const [viewMonth, setViewMonth] = React.useState(zonedSelected ?? new Date())
  const [timeValue, setTimeValue] = React.useState(zonedSelected ? format(zonedSelected, 'HH:mm') : '09:00')

  React.useEffect(() => {
    if (zonedSelected) {
      setViewMonth(zonedSelected)
      setTimeValue(format(zonedSelected, 'HH:mm'))
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const abbrev = zoneAbbreviation(value ? new Date(value) : new Date(), timeZone, localeTag)

  function commit(day: Date, time: string) {
    const [hours, minutes] = time.split(':').map(Number)
    const utc = fromZonedTime(
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours ?? 0, minutes ?? 0, 0),
      timeZone,
    )
    onChange(utc.toISOString())
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            id={id}
            readOnly
            invalid={invalid}
            disabled={disabled}
            placeholder={placeholder}
            value={zonedSelected ? format(zonedSelected, "MM/dd/yyyy 'at' HH:mm") : ''}
            onClick={() => !disabled && setOpen(true)}
            {...aria}
          />
        </div>
        <PopoverTrigger asChild>
          <Button type="button" variant="secondary" size="icon" aria-label={openLabel} disabled={disabled}>
            <CalendarDays aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <span className="shrink-0 text-xs font-semibold uppercase text-steel-500">{abbrev}</span>
      </div>
      <PopoverContent className="w-72">
        <div className="mb-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            aria-label={prevMonthLabel}
            onClick={() => setViewMonth((m) => addMonths(m, -1))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <p className="text-sm font-semibold">{format(viewMonth, 'MMMM yyyy')}</p>
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            aria-label={nextMonthLabel}
            onClick={() => setViewMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        <CalendarGrid
          month={viewMonth}
          selected={zonedSelected}
          weekdayLabels={weekdayLabels}
          todayLabel={todayLabel}
          onSelect={(day) => commit(day, timeValue)}
        />
        <label className="mt-3 flex items-center gap-2 text-sm">
          <span className="font-medium text-carbon">{timeLabel}</span>
          <Input
            type="time"
            value={timeValue}
            className="w-auto"
            onChange={(event) => {
              setTimeValue(event.target.value)
              if (zonedSelected) commit(zonedSelected, event.target.value)
            }}
          />
        </label>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
          >
            {clearLabel}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
