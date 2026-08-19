'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input, Textarea } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { addDocumentVersion, uploadDocument } from '@/server/documents/actions'
import type { DocumentOwnerType } from '@/lib/storage'

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function toDateInputValue(value: string): Date | undefined {
  return value ? new Date(`${value}T00:00:00Z`) : undefined
}

export interface DocumentUploadDialogProps {
  /** Polymorphic owner this document (or new version) belongs to. */
  ownerType: DocumentOwnerType
  ownerId: string
  /** Document types selectable in this context, e.g. the carrier onboarding checklist types. */
  documentTypes: readonly string[]
  /** i18n label for a document type option; defaults to `document.types.<type>`. */
  documentTypeLabel?: (type: string) => string
  defaultDocumentType?: string
  /** When set, uploads a new version of an existing document instead of creating one. */
  existingDocumentId?: string
  /** Whether the "required document" flag is editable here (Admin/onboarding contexts only). */
  allowMarkRequired?: boolean
  trigger?: React.ReactNode
  onUploaded?: () => void
}

/**
 * Shared upload dialog for the document domain. Any owning screen (carrier
 * onboarding, equipment, driver, load) mounts this with the owner it wants a
 * document attached to; the base64 → `uploadDocument`/`addDocumentVersion`
 * plumbing, malware-scan/expiration copy and success/error toasts are
 * handled once here rather than being re-implemented per screen.
 */
export function DocumentUploadDialog({
  ownerType,
  ownerId,
  documentTypes,
  documentTypeLabel,
  defaultDocumentType,
  existingDocumentId,
  allowMarkRequired = false,
  trigger,
  onUploaded,
}: DocumentUploadDialogProps) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  const [documentType, setDocumentType] = React.useState(defaultDocumentType ?? documentTypes[0] ?? '')
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [issueDate, setIssueDate] = React.useState('')
  const [expirationDate, setExpirationDate] = React.useState('')
  const [isRequired, setIsRequired] = React.useState(false)
  const [file, setFile] = React.useState<File | null>(null)

  const labelFor = documentTypeLabel ?? ((type: string) => t(`document.types.${type}`))

  function reset() {
    setTitle('')
    setDescription('')
    setIssueDate('')
    setExpirationDate('')
    setIsRequired(false)
    setFile(null)
  }

  function handleSubmit() {
    if (!file) return
    startTransition(async () => {
      const fileBase64 = await readFileAsBase64(file)
      const result = existingDocumentId
        ? await addDocumentVersion({ documentId: existingDocumentId, originalFilename: file.name, fileBase64 })
        : await uploadDocument({
            ownerType,
            ownerId,
            documentType: documentType as never,
            title: title || undefined,
            description: description || undefined,
            issueDate: toDateInputValue(issueDate),
            expirationDate: toDateInputValue(expirationDate),
            isRequired: allowMarkRequired ? isRequired : undefined,
            originalFilename: file.name,
            fileBase64,
          })

      if (result.ok) {
        toast({ tone: 'success', title: t(existingDocumentId ? 'document.upload.newVersionSuccess' : 'document.upload.success') })
        setOpen(false)
        reset()
        onUploaded?.()
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (isPending ? null : setOpen(next))}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Upload aria-hidden="true" />
            {t('document.upload.title')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent closeLabel={t('common.actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('document.upload.title')}</DialogTitle>
          {existingDocumentId ? <DialogDescription>{t('document.upload.replacing')}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-4">
          {!existingDocumentId ? (
            <div className="grid gap-1.5">
              <Label htmlFor="document-upload-type">{t('document.upload.selectType')}</Label>
              <Select value={documentType} onValueChange={setDocumentType}>
                <SelectTrigger id="document-upload-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {documentTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {labelFor(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {!existingDocumentId ? (
            <div className="grid gap-1.5">
              <Label htmlFor="document-upload-title">{t('document.fields.title')}</Label>
              <Input id="document-upload-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </div>
          ) : null}

          {!existingDocumentId ? (
            <div className="grid gap-1.5">
              <Label htmlFor="document-upload-description">{t('document.fields.description')}</Label>
              <Textarea
                id="document-upload-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
              />
            </div>
          ) : null}

          {!existingDocumentId ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="document-upload-issue">{t('document.upload.issueDate')}</Label>
                <Input
                  id="document-upload-issue"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="document-upload-expiration">{t('document.upload.expirationDate')}</Label>
                <Input
                  id="document-upload-expiration"
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {!existingDocumentId && allowMarkRequired ? (
            <label className="flex items-center gap-2 text-sm text-carbon">
              <Checkbox checked={isRequired} onCheckedChange={(checked) => setIsRequired(checked === true)} />
              {t('document.upload.markRequired')}
            </label>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="document-upload-file">{t('document.upload.selectFile')}</Label>
            <input
              id="document-upload-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="text-sm"
            />
            {file ? <p className="text-xs text-steel-600">{file.name}</p> : null}
          </div>

          {isPending ? <Alert tone="info">{t('document.upload.scanning')}</Alert> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
            {t('common.actions.cancel')}
          </Button>
          <Button type="button" disabled={!file || isPending} loading={isPending} onClick={handleSubmit}>
            {t('common.actions.upload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
