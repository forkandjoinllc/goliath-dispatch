'use client'

import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslate } from '@/components/providers/i18n-provider'

/**
 * Toasts announce the outcome of an action. They are polite live regions, and
 * every toast carries an icon as well as colour so meaning survives for users
 * who cannot distinguish the palette.
 */

type ToastTone = 'success' | 'error' | 'warning' | 'info'

interface ToastRecord {
  id: string
  title: string
  description?: string
  tone: ToastTone
  duration?: number
}

interface ToastContextValue {
  toast: (input: Omit<ToastRecord, 'id'>) => void
  dismiss: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

const TONE_ICON: Record<ToastTone, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

const TONE_CLASS: Record<ToastTone, string> = {
  success: 'border-success-500/40 bg-success-50 text-success-700',
  error: 'border-danger-500/40 bg-danger-50 text-danger-700',
  warning: 'border-warning-500/40 bg-warning-50 text-warning-700',
  info: 'border-info-500/40 bg-info-50 text-info-700',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslate()
  const [toasts, setToasts] = React.useState<ToastRecord[]>([])

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const toast = React.useCallback((input: Omit<ToastRecord, 'id'>) => {
    setToasts((current) => [...current, { ...input, id: crypto.randomUUID() }])
  }, [])

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" duration={6000}>
        {children}
        {toasts.map((item) => {
          const Icon = TONE_ICON[item.tone]
          return (
            <ToastPrimitive.Root
              key={item.id}
              duration={item.duration}
              onOpenChange={(open) => !open && dismiss(item.id)}
              className={cn(
                'group flex w-full items-start gap-3 rounded-lg border p-4 shadow-[var(--shadow-overlay)]',
                'data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full',
                'data-[state=closed]:animate-out data-[state=closed]:fade-out',
                TONE_CLASS[item.tone],
              )}
            >
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div className="flex-1">
                <ToastPrimitive.Title className="text-sm font-semibold">
                  {item.title}
                </ToastPrimitive.Title>
                {item.description ? (
                  <ToastPrimitive.Description className="mt-0.5 text-sm opacity-90">
                    {item.description}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
              <ToastPrimitive.Close
                className="rounded p-1 opacity-60 transition-opacity hover:opacity-100"
                aria-label={t('common.actions.close')}
              >
                <X className="size-4" aria-hidden="true" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          )
        })}
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] flex w-full max-w-sm flex-col gap-2 p-4 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}
