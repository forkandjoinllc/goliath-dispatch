'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { uploadFactoringDocumentAction } from '@/server/factoring/actions'

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function FactoringDocumentUploader({
  assignmentId,
  kind,
  label,
}: {
  assignmentId: string
  kind: 'notice_of_assignment' | 'change_of_payee'
  label: string
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const inputRef = React.useRef<HTMLInputElement>(null)

  function handleFile(file: File) {
    startTransition(async () => {
      const fileBase64 = await fileToBase64(file)
      const result = await uploadFactoringDocumentAction({
        assignmentId,
        kind,
        originalFilename: file.name,
        fileBase64,
      })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.factoring.assignments.uploadSuccess') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) handleFile(file)
          event.target.value = ''
        }}
      />
      <Button type="button" variant="secondary" disabled={isPending} onClick={() => inputRef.current?.click()}>
        <Upload aria-hidden="true" />
        {label}
      </Button>
    </>
  )
}
