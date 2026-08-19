'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { AssignmentScope } from '@/lib/permissions'
import type {
  CarrierAssignmentHistoryRow,
  DispatcherCarrierMatrixRow,
  DispatcherGroupView,
  DispatcherUserOption,
} from '@/server/assignments/queries'
import { DispatcherMatrixPanel, type GrantRow } from './dispatcher-matrix-panel'
import { DispatcherGroupsPanel } from './dispatcher-groups-panel'
import { CarrierHistoryPanel } from './carrier-history-panel'

export interface AssignmentsTabsProps {
  matrix: DispatcherCarrierMatrixRow[]
  reachByDispatcher: Array<{ userId: string; name: string; reach: AssignmentScope }>
  groups: DispatcherGroupView[]
  grants: GrantRow[]
  dispatcherOptions: DispatcherUserOption[]
  carrierOptions: { value: string; label: string }[]
  selectedCarrierId: string
  history: CarrierAssignmentHistoryRow[]
}

export function AssignmentsTabs({
  matrix,
  reachByDispatcher,
  groups,
  grants,
  dispatcherOptions,
  carrierOptions,
  selectedCarrierId,
  history,
}: AssignmentsTabsProps) {
  const t = useTranslate()

  return (
    <Tabs defaultValue="matrix">
      <TabsList>
        <TabsTrigger value="matrix">{t('assignment.tabs.matrix')}</TabsTrigger>
        <TabsTrigger value="groups">{t('assignment.tabs.groups')}</TabsTrigger>
        <TabsTrigger value="history">{t('assignment.tabs.history')}</TabsTrigger>
      </TabsList>

      <TabsContent value="matrix">
        <DispatcherMatrixPanel
          matrix={matrix}
          reachByDispatcher={reachByDispatcher}
          grants={grants}
          dispatcherOptions={dispatcherOptions}
        />
      </TabsContent>

      <TabsContent value="groups">
        <DispatcherGroupsPanel groups={groups} />
      </TabsContent>

      <TabsContent value="history">
        <CarrierHistoryPanel carrierOptions={carrierOptions} selectedCarrierId={selectedCarrierId} history={history} />
      </TabsContent>
    </Tabs>
  )
}
