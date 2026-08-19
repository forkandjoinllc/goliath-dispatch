'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { Input } from './input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

export interface SignaturePadHandle {
  /** PNG data URL of the current signature, or null if nothing was drawn/typed. */
  toDataUrl: () => string | null
  hasDrawn: () => boolean
  clear: () => void
}

export interface SignaturePadLabels {
  drawTab: string
  typeTab: string
  clear: string
  undo: string
  canvasLabel: string
  typedPlaceholder: string
  typedPreviewLabel: string
}

export interface SignaturePadProps {
  labels: SignaturePadLabels
  width?: number
  height?: number
  penColor?: string
  defaultMode?: 'draw' | 'type'
  defaultTypedName?: string
  onChange?: (state: { mode: 'draw' | 'type'; hasContent: boolean; typedName: string }) => void
  className?: string
}

type Point = { x: number; y: number }

export const SignaturePad = React.forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  {
    labels,
    width = 480,
    height = 180,
    penColor = '#062B5C',
    defaultMode = 'draw',
    defaultTypedName = '',
    onChange,
    className,
  },
  ref,
) {
  const [mode, setMode] = React.useState<'draw' | 'type'>(defaultMode)
  const [typedName, setTypedName] = React.useState(defaultTypedName)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const strokesRef = React.useRef<Point[][]>([])
  const currentStrokeRef = React.useRef<Point[] | null>(null)
  const [strokeCount, setStrokeCount] = React.useState(0)

  const draw = React.useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2.5
    ctx.strokeStyle = penColor
    for (const stroke of strokesRef.current) {
      if (stroke.length < 2) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0]!.x, stroke[0]!.y)
      for (const point of stroke.slice(1)) ctx.lineTo(point.x, point.y)
      ctx.stroke()
    }
  }, [penColor])

  React.useEffect(() => {
    draw()
  }, [draw, strokeCount])

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== 'draw') return
    event.currentTarget.setPointerCapture(event.pointerId)
    currentStrokeRef.current = [pointFromEvent(event)]
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== 'draw' || !currentStrokeRef.current) return
    currentStrokeRef.current.push(pointFromEvent(event))
    draw()
    const ctx = canvasRef.current?.getContext('2d')
    const stroke = currentStrokeRef.current
    if (ctx && stroke.length >= 2) {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 2.5
      ctx.strokeStyle = penColor
      ctx.beginPath()
      ctx.moveTo(stroke[stroke.length - 2]!.x, stroke[stroke.length - 2]!.y)
      ctx.lineTo(stroke[stroke.length - 1]!.x, stroke[stroke.length - 1]!.y)
      ctx.stroke()
    }
  }

  function commitStroke() {
    if (currentStrokeRef.current && currentStrokeRef.current.length > 1) {
      strokesRef.current = [...strokesRef.current, currentStrokeRef.current]
      setStrokeCount((c) => c + 1)
      onChange?.({ mode, hasContent: true, typedName })
    }
    currentStrokeRef.current = null
  }

  function clear() {
    strokesRef.current = []
    currentStrokeRef.current = null
    setStrokeCount((c) => c + 1)
    onChange?.({ mode, hasContent: false, typedName })
  }

  function undo() {
    strokesRef.current = strokesRef.current.slice(0, -1)
    setStrokeCount((c) => c + 1)
    onChange?.({ mode, hasContent: strokesRef.current.length > 0, typedName })
  }

  function typedDataUrl(): string | null {
    if (typedName.trim().length === 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = penColor
    ctx.font = `italic 48px "Brush Script MT", cursive`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(typedName.trim(), width / 2, height / 2)
    return canvas.toDataURL('image/png')
  }

  React.useImperativeHandle(
    ref,
    () => ({
      toDataUrl: () => {
        if (mode === 'type') return typedDataUrl()
        if (strokesRef.current.length === 0) return null
        return canvasRef.current?.toDataURL('image/png') ?? null
      },
      hasDrawn: () => (mode === 'type' ? typedName.trim().length > 0 : strokesRef.current.length > 0),
      clear: () => {
        if (mode === 'draw') clear()
        else setTypedName('')
      },
    }),
    [mode, typedName], // eslint-disable-line react-hooks/exhaustive-deps
  )

  return (
    <div className={cn('space-y-3', className)}>
      <Tabs
        value={mode}
        onValueChange={(value) => {
          setMode(value as 'draw' | 'type')
          onChange?.({
            mode: value as 'draw' | 'type',
            hasContent:
              value === 'type' ? typedName.trim().length > 0 : strokesRef.current.length > 0,
            typedName,
          })
        }}
      >
        <TabsList>
          <TabsTrigger value="draw">{labels.drawTab}</TabsTrigger>
          <TabsTrigger value="type">{labels.typeTab}</TabsTrigger>
        </TabsList>
        <TabsContent value="draw">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={labels.canvasLabel}
            width={width}
            height={height}
            className="w-full touch-none rounded-md border border-steel-300 bg-white"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={commitStroke}
            onPointerLeave={commitStroke}
            onPointerCancel={commitStroke}
          />
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={undo}>
              {labels.undo}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={clear}>
              {labels.clear}
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="type">
          <Input
            value={typedName}
            placeholder={labels.typedPlaceholder}
            onChange={(event) => {
              setTypedName(event.target.value)
              onChange?.({ mode: 'type', hasContent: event.target.value.trim().length > 0, typedName: event.target.value })
            }}
          />
          <div
            role="img"
            aria-label={labels.typedPreviewLabel}
            className="mt-2 flex h-24 items-center justify-center rounded-md border border-steel-300 bg-white text-3xl italic text-navy-700"
            style={{ fontFamily: '"Brush Script MT", cursive' }}
          >
            {typedName || ' '}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
})
