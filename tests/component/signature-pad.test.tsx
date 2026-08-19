import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './test-utils'
import { SignaturePad, type SignaturePadHandle } from '@/components/ui/signature-pad'

const labels = {
  drawTab: 'Draw',
  typeTab: 'Type',
  clear: 'Clear',
  undo: 'Undo',
  canvasLabel: 'Signature canvas',
  typedPreviewLabel: 'Typed signature preview',
  typedPlaceholder: 'Type your full name',
}

function Harness() {
  const ref = React.useRef<SignaturePadHandle>(null)
  const [status, setStatus] = React.useState('not drawn')
  return (
    <div>
      <SignaturePad ref={ref} labels={labels} />
      <button
        type="button"
        onClick={() => setStatus(ref.current?.hasDrawn() ? 'drawn' : 'not drawn')}
      >
        Check
      </button>
      <p>{status}</p>
    </div>
  )
}

describe('SignaturePad', () => {
  it('reports "not drawn" until a pointer stroke is made, then "drawn"', async () => {
    renderWithProviders(<Harness />)

    const canvas = screen.getByLabelText('Signature canvas')
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 480, height: 180, right: 480, bottom: 180, x: 0, y: 0, toJSON() {} }) as DOMRect

    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByText('not drawn')).toBeInTheDocument()

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 40, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 50, clientY: 40, pointerId: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByText('drawn')).toBeInTheDocument()
  })

  it('reports "drawn" once a typed name is entered in type mode', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(screen.getByRole('tab', { name: 'Type' }))
    await user.type(await screen.findByPlaceholderText('Type your full name'), 'Jordan Rivera')

    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByText('drawn')).toBeInTheDocument()
  })

  it('clears back to "not drawn"', async () => {
    renderWithProviders(<Harness />)
    const canvas = screen.getByLabelText('Signature canvas')
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 480, height: 180, right: 480, bottom: 180, x: 0, y: 0, toJSON() {} }) as DOMRect

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 40, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 50, clientY: 40, pointerId: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByText('not drawn')).toBeInTheDocument()
  })
})
