import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { renderWithProviders } from './test-utils'
import { Form } from '@/components/forms/form'
import { DateTimeField } from '@/components/forms/fields'

interface AppointmentForm {
  appointmentAt: string | null
}

const pickerLabels = {
  openLabel: 'Open calendar',
  todayLabel: 'Today',
  prevMonthLabel: 'Previous month',
  nextMonthLabel: 'Next month',
  weekdayLabels: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
  clearLabel: 'Clear date',
  timeLabel: 'Time',
}

function Harness({ onChange }: { onChange: (value: string | null) => void }) {
  const form = useForm<AppointmentForm>({
    defaultValues: { appointmentAt: '2026-01-15T15:00:00.000Z' },
  })
  const value = form.watch('appointmentAt')
  React.useEffect(() => {
    onChange(value)
  }, [value, onChange])

  return (
    <Form form={form}>
      <DateTimeField<AppointmentForm>
        name="appointmentAt"
        label="Pickup window"
        timeZone="America/Chicago"
        pickerLabels={pickerLabels}
      />
    </Form>
  )
}

describe('DateTimeField', () => {
  it('displays a UTC value converted to the supplied zone, with the zone abbreviation shown', () => {
    renderWithProviders(<Harness onChange={vi.fn()} />)
    const input = screen.getByLabelText<HTMLInputElement>('Pickup window')
    // 15:00 UTC in January is 09:00 in America/Chicago (CST, UTC-6).
    expect(input.value).toBe('01/15/2026 at 09:00')
    expect(screen.getByText('CST')).toBeInTheDocument()
  })

  it('round-trips a local time edit back to the correct UTC instant', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<Harness onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Open calendar' }))
    const timeInput = screen.getByLabelText<HTMLInputElement>('Time')
    fireChangeTime(timeInput, '10:30')

    expect(onChange).toHaveBeenLastCalledWith('2026-01-15T16:30:00.000Z')
  })
})

function fireChangeTime(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
