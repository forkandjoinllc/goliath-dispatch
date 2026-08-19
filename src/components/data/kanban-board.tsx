'use client'

import * as React from 'react'
import { GripVertical, MoveRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface KanbanColumn<TColumnId extends string> {
  id: TColumnId
  label: string
}

export interface KanbanBoardProps<TItem, TColumnId extends string> {
  columns: KanbanColumn<TColumnId>[]
  items: TItem[]
  getItemId: (item: TItem) => string
  getItemColumn: (item: TItem) => TColumnId
  onMove: (itemId: string, toColumn: TColumnId) => void
  renderCard: (item: TItem) => React.ReactNode
  /** aria-label for a card's drag handle, e.g. "Drag to move {name}". */
  dragHandleLabel: (item: TItem) => string
  /** aria-label for the keyboard move menu trigger. */
  moveMenuLabel: (item: TItem) => string
  /** Menu item label for a destination column, e.g. "Move to {column}". */
  moveToLabel: (columnLabel: string) => string
  /** Screen-reader announcement after any move, drag or keyboard. */
  announceMove: (item: TItem, toColumnLabel: string) => string
  className?: string
}

/**
 * A generic kanban board. Reordering works two ways: pointer-based drag
 * between columns, and a keyboard path — focus a card, open its menu,
 * "Move to <column>" — that reaches the exact same `onMove` callback. Every
 * move, from either path, is announced through a polite live region.
 */
export function KanbanBoard<TItem, TColumnId extends string>({
  columns,
  items,
  getItemId,
  getItemColumn,
  onMove,
  renderCard,
  dragHandleLabel,
  moveMenuLabel,
  moveToLabel,
  announceMove,
  className,
}: KanbanBoardProps<TItem, TColumnId>) {
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [hoverColumn, setHoverColumn] = React.useState<TColumnId | null>(null)
  const [announcement, setAnnouncement] = React.useState('')
  const boardRef = React.useRef<HTMLDivElement>(null)

  const itemsByColumn = React.useMemo(() => {
    const map = new Map<TColumnId, TItem[]>()
    for (const column of columns) map.set(column.id, [])
    for (const item of items) {
      const columnId = getItemColumn(item)
      map.get(columnId)?.push(item)
    }
    return map
  }, [columns, items, getItemColumn])

  function commitMove(item: TItem, toColumn: TColumnId) {
    const fromColumn = getItemColumn(item)
    if (fromColumn === toColumn) return
    onMove(getItemId(item), toColumn)
    const columnLabel = columns.find((c) => c.id === toColumn)?.label ?? String(toColumn)
    setAnnouncement(announceMove(item, columnLabel))
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>, itemId: string) {
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraggingId(itemId)
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!draggingId) return
    const el = document.elementFromPoint(event.clientX, event.clientY)
    const columnEl = el?.closest<HTMLElement>('[data-kanban-column]')
    const columnId = columnEl?.dataset.kanbanColumn as TColumnId | undefined
    setHoverColumn(columnId ?? null)
  }

  function handlePointerUp() {
    if (draggingId && hoverColumn) {
      const item = items.find((i) => getItemId(i) === draggingId)
      if (item) commitMove(item, hoverColumn)
    }
    setDraggingId(null)
    setHoverColumn(null)
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div
        ref={boardRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          setDraggingId(null)
          setHoverColumn(null)
        }}
        className="flex flex-1 gap-3 overflow-x-auto pb-2"
      >
        {columns.map((column) => {
          const columnItems = itemsByColumn.get(column.id) ?? []
          const isHoverTarget = hoverColumn === column.id && draggingId !== null
          return (
            <div
              key={column.id}
              data-kanban-column={column.id}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-lg border border-steel-200 bg-steel-50',
                isHoverTarget && 'border-navy-500 bg-navy-50',
              )}
            >
              <div className="flex items-center justify-between gap-2 border-b border-steel-200 px-3 py-2">
                <h3 className="text-sm font-bold tracking-tight">{column.label}</h3>
                <Badge tone="neutral">{columnItems.length}</Badge>
              </div>
              <div className="flex flex-col gap-2 p-2">
                {columnItems.map((item) => {
                  const itemId = getItemId(item)
                  const otherColumns = columns.filter((c) => c.id !== column.id)
                  return (
                    <div
                      key={itemId}
                      className={cn(
                        'surface-card flex items-start gap-2 p-3',
                        draggingId === itemId && 'opacity-50',
                      )}
                    >
                      <button
                        type="button"
                        aria-label={dragHandleLabel(item)}
                        onPointerDown={(event) => handlePointerDown(event, itemId)}
                        className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-1 text-steel-400 hover:text-steel-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] active:cursor-grabbing"
                      >
                        <GripVertical className="size-4" aria-hidden="true" />
                      </button>
                      <div className="min-w-0 flex-1">{renderCard(item)}</div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="iconSm" aria-label={moveMenuLabel(item)}>
                            <MoveRight aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>{moveMenuLabel(item)}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {otherColumns.map((target) => (
                            <DropdownMenuItem key={target.id} onSelect={() => commitMove(item, target.id)}>
                              {moveToLabel(target.label)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
