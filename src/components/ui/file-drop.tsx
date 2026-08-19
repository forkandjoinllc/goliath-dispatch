'use client'

import * as React from 'react'
import { AlertCircle, FileText, RotateCcw, UploadCloud, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { bytesToHuman } from '@/lib/utils'
import { Button } from './button'
import { Progress } from './progress'

export interface FileDropItem {
  id: string
  name: string
  size: number
  /** 0–100. Omit or leave at 100 for a file that isn't being tracked mid-upload. */
  progress?: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  errorMessage?: string
}

export interface FileDropLabels {
  dropHint: string
  browse: string
  acceptedTypes: string
  maxSize: string
  remove: string
  retry: string
  uploading: string
}

export interface FileDropProps {
  id?: string
  accept?: string[]
  maxSizeBytes?: number
  multiple?: boolean
  disabled?: boolean
  onFilesSelected: (files: File[]) => void
  onRemove?: (id: string) => void
  onRetry?: (id: string) => void
  files?: FileDropItem[]
  labels: FileDropLabels
  invalid?: boolean
  'aria-describedby'?: string
  className?: string
}

export function FileDrop({
  id,
  accept,
  maxSizeBytes,
  multiple = true,
  disabled,
  onFilesSelected,
  onRemove,
  onRetry,
  files = [],
  labels,
  invalid,
  className,
  ...aria
}: FileDropProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [isDragging, setDragging] = React.useState(false)

  function openPicker() {
    if (!disabled) inputRef.current?.click()
  }

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    onFilesSelected(Array.from(list))
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div
        id={id}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        // `aria-invalid` is not valid on role="button"; the error is conveyed by
        // the described-by message and the border treatment instead.
        data-invalid={invalid || undefined}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openPicker()
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (!disabled) handleFiles(event.dataTransfer.files)
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-steel-300 bg-steel-50 px-6 py-8 text-center transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
          isDragging && 'border-navy-500 bg-navy-50',
          disabled && 'cursor-not-allowed opacity-50',
          !disabled && 'cursor-pointer hover:border-navy-400',
          invalid && 'border-danger-500',
        )}
        {...aria}
      >
        <UploadCloud className="size-8 text-steel-500" aria-hidden="true" />
        <p className="text-sm font-medium text-carbon">
          {labels.dropHint} <span className="text-navy-700 underline">{labels.browse}</span>
        </p>
        <p className="text-xs text-steel-600">
          {accept && accept.length > 0 ? `${labels.acceptedTypes}: ${accept.join(', ')}` : null}
          {accept && accept.length > 0 && maxSizeBytes ? ' · ' : null}
          {maxSizeBytes ? `${labels.maxSize}: ${bytesToHuman(maxSizeBytes)}` : null}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={accept?.join(',')}
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            handleFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {files.length > 0 ? (
        <ul className="space-y-2">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-3 rounded-md border border-steel-200 bg-white px-3 py-2"
            >
              {file.status === 'error' ? (
                <AlertCircle className="size-5 shrink-0 text-danger-700" aria-hidden="true" />
              ) : (
                <FileText className="size-5 shrink-0 text-steel-500" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-carbon">{file.name}</p>
                <p className="text-xs text-steel-600">{bytesToHuman(file.size)}</p>
                {file.status === 'uploading' ? (
                  <div className="mt-1 flex items-center gap-2">
                    <Progress value={file.progress ?? 0} className="h-1.5" />
                    <span className="sr-only" role="status">
                      {labels.uploading}
                    </span>
                    <span className="tabular text-xs text-steel-600">{Math.round(file.progress ?? 0)}%</span>
                  </div>
                ) : null}
                {file.status === 'error' && file.errorMessage ? (
                  <p role="alert" className="mt-0.5 text-xs text-danger-700">
                    {file.errorMessage}
                  </p>
                ) : null}
              </div>
              {file.status === 'error' && onRetry ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="iconSm"
                  aria-label={labels.retry}
                  onClick={() => onRetry(file.id)}
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
              ) : null}
              {onRemove ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="iconSm"
                  aria-label={`${labels.remove}: ${file.name}`}
                  onClick={() => onRemove(file.id)}
                >
                  <X aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
