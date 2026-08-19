'use client'

import * as React from 'react'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { Input } from './input'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

/** `new Intl` abbreviation for the zone at a given instant, e.g. "MDT". */
export function zoneAbbreviation(date: Date, timeZone: string, localeTag: string): string {
  try {
    const parts = new Intl.DateTimeFormat(localeTag, { timeZone, timeZoneName: 'short' }).formatToParts(
      date,
    )
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone
  } catch {
    return timeZone
  }
}

export interface CalendarGridProps {
  month: Date
  selected: Date | null
  onSelect: (day: Date) => void
  weekdayLabels: string[]
  todayLabel: string
}

/** A month grid with roving-tabindex keyboard navigation (arrows, Home/End, PageUp/Down). */
export function CalendarGrid({ month, selected, onSelect, weekdayLabels, todayLabel }: CalendarGridProps) {
  const today = new Date()
  const gridStart = startOfWeek(startOfMonth(month))
  const gridEnd = endOfWeek(endOfMonth(month))
  const days: Date[] = []
  for (let d = gridStart; d <= gridEnd; d = new Date(d.getTime() + 86400000)) {
    days.push(d)
  }
  const [focusedDay, setFocusedDay] = React.useState<Date>(selected ?? today)
  const refs = React.useRef(new Map<string, HTMLButtonElement>())

  React.useEffect(() => {
    const key = format(focusedDay, 'yyyy-MM-dd')
    refs.current.get(key)?.focus()
  }, [focusedDay])

  function move(deltaDays: number) {
    setFocusedDay((prev) => new Date(prev.getTime() + deltaDays * 86400000))
  }

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {weekdayLabels.map((label) => (
          <div key={label} className="text-center text-xs font-semibold uppercase text-steel-500">
            {label}
          </div>
        ))}
      </div>
      <div role="grid" className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd')
          const inMonth = isSameMonth(day, month)
          const isSelected = selected ? isSameDay(day, selected) : false
          const isToday = isSameDay(day, today)
          const isTabbable = isSameDay(day, focusedDay)
          return (
            <button
              key={key}
              ref={(el) => {
                if (el) refs.current.set(key, el)
                else refs.current.delete(key)
              }}
              type="button"
              role="gridcell"
              tabIndex={isTabbable ? 0 : -1}
              aria-selected={isSelected}
              aria-current={isToday ? 'date' : undefined}
              aria-label={isToday ? `${format(day, 'PPPP')} (${todayLabel})` : format(day, 'PPPP')}
              onClick={() => {
                setFocusedDay(day)
                onSelect(day)
              }}
              onKeyDown={(event) => {
                switch (event.key) {
                  case 'ArrowRight':
                    event.preventDefault()
                    move(1)
                    break
                  case 'ArrowLeft':
                    event.preventDefault()
                    move(-1)
                    break
                  case 'ArrowDown':
                    event.preventDefault()
                    move(7)
                    break
                  case 'ArrowUp':
                    event.preventDefault()
                    move(-7)
                    break
                  case 'Home':
                    event.preventDefault()
                    move(-day.getDay())
                    break
                  case 'End':
                    event.preventDefault()
                    move(6 - day.getDay())
                    break
                  case 'PageUp':
                    event.preventDefault()
                    move(-30)
                    break
                  case 'PageDown':
                    event.preventDefault()
                    move(30)
                    break
                  case 'Enter':
                  case ' ':
                    event.preventDefault()
                    onSelect(day)
                    break
                }
              }}
              className={cn(
                'flex h-8 w-full items-center justify-center rounded-sm text-sm tabular transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
                !inMonth && 'text-steel-400',
                inMonth && !isSelected && 'text-carbon hover:bg-navy-50',
                isSelected && 'bg-navy-700 font-semibold text-white hover:bg-navy-600',
                isToday && !isSelected && 'border border-safety-500 font-semibold',
              )}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export interface DatePickerProps {
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
}

/**
 * Timezone-aware date picker. `value`/`onChange` are always a UTC instant;
 * the calendar and the abbreviation shown next to the field are computed in
 * `timeZone`, so a pickup-window date always reads correctly at the stop.
 */
export function DatePicker({
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
  ...aria
}: DatePickerProps) {
  const zonedSelected = value ? toZonedTime(new Date(value), timeZone) : null
  const [open, setOpen] = React.useState(false)
  const [viewMonth, setViewMonth] = React.useState(zonedSelected ?? new Date())

  React.useEffect(() => {
    if (zonedSelected) setViewMonth(zonedSelected)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const abbrev = zoneAbbreviation(value ? new Date(value) : new Date(), timeZone, localeTag)

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
            value={zonedSelected ? format(zonedSelected, 'MM/dd/yyyy') : ''}
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
          onSelect={(day) => {
            const utc = fromZonedTime(
              new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0),
              timeZone,
            )
            onChange(utc.toISOString())
            setOpen(false)
          }}
        />
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
