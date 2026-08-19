import * as React from 'react'
import { describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { renderWithProviders } from './test-utils'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField } from '@/components/forms/fields'

const schema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
})
type Values = z.infer<typeof schema>

function Harness() {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { companyName: '' },
  })
  return (
    <Form form={form} onSubmit={form.handleSubmit(() => {})}>
      <FormErrorSummary<Values> title="Please fix the following" />
      <TextField<Values> name="companyName" label="Company name" />
      <button type="submit">Submit</button>
    </Form>
  )
}

describe('FormErrorSummary', () => {
  it('is absent before submission and receives focus after a failed submit', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Submit' }))

    const heading = await screen.findByText('Please fix the following')
    const summary = heading.closest('[role="alert"]') as HTMLElement
    expect(summary).toBeInTheDocument()
    expect(summary).toHaveFocus()
  })

  it('links each error to its field', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByRole('link', { name: 'Company name is required' })).toBeInTheDocument()
  })
})
