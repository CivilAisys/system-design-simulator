import { lazy, Suspense } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { SimulationResult, Topology } from '@/api/client'
import type { Theme } from '@/theme'
import { MetricsTable } from './MetricsTable'

// ECharts 很大，切到 Sankey Tab 才載入
const FlowSankey = lazy(() => import('./FlowSankey').then((module) => ({ default: module.FlowSankey })))

type ResultsPanelProps = {
  topology: Topology
  result: SimulationResult | null
  theme: Theme
}

export function ResultsPanel({ topology, result, theme }: ResultsPanelProps) {
  // 驗證失敗時不做任何計算，指標表和 Sankey 都沒有東西可畫
  const computed = result?.valid ? result : null
  const errorCount = result?.errors.length ?? 0

  return (
    <Tabs defaultValue="metrics" className="h-full gap-0 p-2">
      <TabsList>
        <TabsTrigger value="metrics">指標表</TabsTrigger>
        <TabsTrigger value="sankey">流量 Sankey</TabsTrigger>
        <TabsTrigger value="errors">錯誤 ({errorCount})</TabsTrigger>
      </TabsList>
      <TabsContent value="metrics" className="min-h-0 overflow-auto">
        {computed ? <MetricsTable topology={topology} result={computed} /> : <EmptyState result={result} />}
      </TabsContent>
      <TabsContent value="sankey" className="min-h-0">
        {computed ? (
          <Suspense>
            <FlowSankey topology={topology} result={computed} theme={theme} />
          </Suspense>
        ) : (
          <EmptyState result={result} />
        )}
      </TabsContent>
      {/* 錯誤清單由 #8 填入 */}
      <TabsContent value="errors" className="min-h-0 overflow-auto" />
    </Tabs>
  )
}

function EmptyState({ result }: { result: SimulationResult | null }) {
  const text = result ? '拓撲有驗證錯誤，沒有計算結果' : '按 Run 看結果'
  return <p className="p-4 text-sm text-muted-foreground">{text}</p>
}
