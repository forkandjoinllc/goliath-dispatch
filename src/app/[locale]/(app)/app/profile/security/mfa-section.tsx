'use client'

import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { disableMfaAction } from '@/server/auth/actions'

export function MfaSection({
  locale,
  enrolled,
  required,
}: {
  locale: string
  enrolled: boolean
  required: boolean
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <CardTitle>{t('settings.security.mfa.title')}</CardTitle>
        <Badge tone={enrolled ? 'success' : 'neutral'}>
          {enrolled ? t('settings.security.mfa.enrolled') : t('settings.security.mfa.notEnrolled')}
        </Badge>
      </CardHeader>
      <CardContent>
        {required ? <p className="text-sm text-steel-600">{t('settings.security.mfa.requiredNotice')}</p> : null}
      </CardContent>
      <CardFooter>
        {enrolled ? (
          required ? (
            <p className="text-sm text-steel-500">{t('settings.security.mfa.cannotDisable')}</p>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="secondary">{t('settings.security.mfa.disable')}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('settings.security.mfa.disable')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('settings.security.mfa.disable')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={async () => {
                      const result = await disableMfaAction()
                      if (result.ok) {
                        toast({ tone: 'success', title: t('auth.mfa.disabled') })
                        router.refresh()
                      } else {
                        toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
                      }
                    }}
                  >
                    {t('common.actions.confirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )
        ) : (
          <Button onClick={() => router.push(`/${locale}/app/mfa-setup`)}>
            {t('settings.security.mfa.setup')}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
