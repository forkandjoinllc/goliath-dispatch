'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { ArrowDown, ArrowUp, ImageOff, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import {
  deleteEquipmentMediaAction,
  reorderEquipmentMediaAction,
  uploadEquipmentMediaAction,
} from '@/server/equipment/actions'
import type { EquipmentMedia } from '@/db/schema'

const ANGLES = ['front', 'rear', 'driver_side', 'passenger_side', 'interior', 'detail'] as const
const REQUIRED_ANGLES = ['front', 'rear', 'driver_side', 'passenger_side'] as const

export interface MediaItem {
  media: EquipmentMedia
  url: string
}

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

export function EquipmentMediaPanel({
  equipmentType,
  equipmentId,
  items,
  missingAngles,
  canManage,
}: {
  equipmentType: 'truck' | 'trailer'
  equipmentId: string
  items: MediaItem[]
  missingAngles: string[]
  canManage: boolean
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [angle, setAngle] = React.useState<(typeof ANGLES)[number]>('front')
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  function handleUpload(file: File) {
    startTransition(async () => {
      const fileBase64 = await fileToBase64(file)
      const result = await uploadEquipmentMediaAction({
        equipmentType,
        equipmentId,
        angle,
        originalFilename: file.name,
        fileBase64,
      })
      if (result.ok) {
        toast({ tone: 'success', title: t('equipment.media.upload') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function handleDelete(mediaId: string) {
    if (!window.confirm(t('equipment.media.confirmDelete'))) return
    startTransition(async () => {
      const result = await deleteEquipmentMediaAction({ equipmentType, equipmentId, mediaId })
      if (result.ok) {
        toast({ tone: 'success', title: t('equipment.media.delete') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function move(index: number, direction: -1 | 1) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= items.length) return
    const orderedIds = items.map((item) => item.media.id)
    const tmp = orderedIds[index]
    orderedIds[index] = orderedIds[targetIndex]
    orderedIds[targetIndex] = tmp
    startTransition(async () => {
      const result = await reorderEquipmentMediaAction({ equipmentType, equipmentId, orderedMediaIds: orderedIds })
      if (result.ok) {
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-carbon">{t('equipment.media.title')}</h3>
        <p className="text-sm text-steel-600">{t('equipment.media.description', { required: 4 })}</p>
      </div>

      {missingAngles.length > 0 ? (
        <Alert tone="warning">
          {t('equipment.media.missingAnglesWarning', {
            angles: missingAngles.map((a) => t(`equipment.media.angles.${a}`)).join(', '),
          })}
        </Alert>
      ) : (
        <Alert tone="info">{t('equipment.media.allAnglesCaptured')}</Alert>
      )}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-steel-200 p-3">
          <Select value={angle} onValueChange={(v) => setAngle(v as (typeof ANGLES)[number])}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANGLES.map((a) => (
                <SelectItem key={a} value={a}>
                  {t(`equipment.media.angles.${a}`)}
                  {(REQUIRED_ANGLES as readonly string[]).includes(a) ? ` (${t('equipment.media.requiredAngle')})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) handleUpload(file)
              event.target.value = ''
            }}
          />
          <Button type="button" variant="secondary" disabled={isPending} onClick={() => fileInputRef.current?.click()}>
            {t('equipment.media.upload')}
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState icon={ImageOff} title={t('equipment.media.empty')} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item, index) => (
            <figure key={item.media.id} className="overflow-hidden rounded-lg border border-steel-200">
              {item.media.mediaKind === 'video' ? (
                <video src={item.url} controls className="aspect-square w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL; next/image cannot proxy it
                <img src={item.url} alt={item.media.caption ?? item.media.angle} className="aspect-square w-full object-cover" />
              )}
              <figcaption className="flex items-center justify-between gap-1 p-2 text-xs">
                <span className="font-semibold text-carbon">{t(`equipment.media.angles.${item.media.angle}`)}</span>
                {canManage ? (
                  <span className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      disabled={isPending || index === 0}
                      aria-label={t('equipment.media.reorder')}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      disabled={isPending || index === items.length - 1}
                      aria-label={t('equipment.media.reorder')}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      disabled={isPending}
                      aria-label={t('equipment.media.delete')}
                      onClick={() => handleDelete(item.media.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </span>
                ) : null}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}
