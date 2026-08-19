import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import { Form } from '@/components/forms/form'
import { MoneyField, PercentField } from '@/components/forms/fields'

interface RateFormValues {
  amountCents: number | null
  feeBps: number | null
}

function MoneyHarness({ onSubmit }: { onSubmit: (values: RateFormValues) => void }) {
  const form = useForm<RateFormValues>({ defaultValues: { amountCents: null, feeBps: null } })
  return (
    <Form form={form} onSubmit={form.handleSubmit(onSubmit)}>
      <MoneyField<RateFormValues> name="amountCents" label="Carrier rate" />
      <PercentField<RateFormValues> name="feeBps" label="Dispatch fee" />
      <button type="submit">Submit</button>
    </Form>
  )
}

describe('MoneyField', () => {
  it('submits integer cents for a typed dollar amount', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderWithProviders(<MoneyHarness onSubmit={onSubmit} />)

    const input = screen.getByLabelText('Carrier rate')
    await user.type(input, '1,250.75')
    await user.tab()
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 125075 }),
      expect.anything(),
    )
  })

  it('reformats the display value with thousands separators on blur', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MoneyHarness onSubmit={vi.fn()} />)
    const input = screen.getByLabelText<HTMLInputElement>('Carrier rate')
    await user.type(input, '1250.5')
    await user.tab()
    expect(input.value).toBe('1,250.50')
  })
})

describe('PercentField', () => {
  it('submits basis points for a typed percentage', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderWithProviders(<MoneyHarness onSubmit={onSubmit} />)

    const input = screen.getByLabelText('Dispatch fee')
    await user.type(input, '10.5')
    await user.tab()
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ feeBps: 1050 }), expect.anything())
  })
})
