import { lazy, Suspense } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { SimulationResult, Topology } from '@/api/client'
import type { Theme } from '@/theme'
import { EndToEndLatencyText } from './EndToEndLatencyText'
import { MetricsTable } from './MetricsTable'

// ECharts 很大，切到 Sankey Tab 才載入
const FlowSankey = lazy(() => import('./FlowSankey').then((module) => ({ default: module.FlowSankey })))

type ResultsPanelProps = {
  topology: Topology
  result: SimulationResult | null
  running: boolean
  theme: Theme
}

export function ResultsPanel({ topology, result, running, theme }: ResultsPanelProps) {
  // 驗證失敗時不做任何計算，指標表和 Sankey 都沒有東西可畫
  const computed = result?.valid ? result : null
  const errorCount = result?.errors.length ?? 0
  const empty = <EmptyState result={result} running={running} />
  // 所有邊都是 0 流量（例如 Client rps = 0）時 Sankey 沒有東西可畫
  const hasFlow = computed != null && Object.values(computed.edges).some(({ rps }) => rps.read + rps.write > 0)

  return (
    <Tabs defaultValue="metrics" className="h-full gap-0 p-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <TabsList>
          <TabsTrigger value="metrics">指標表</TabsTrigger>
          <TabsTrigger value="sankey">流量 Sankey</TabsTrigger>
          <TabsTrigger value="errors">錯誤 ({errorCount})</TabsTrigger>
        </TabsList>
        {computed && (
          <p className="text-sm">
            <span className="mr-2 text-muted-foreground">平均端到端延遲</span>
            <EndToEndLatencyText latencies={computed.summary.avgEndToEndMs} topology={topology} />
          </p>
        )}
      </div>
      <TabsContent value="metrics" className="min-h-0 overflow-auto">
        {computed ? <MetricsTable topology={topology} result={computed} /> : empty}
      </TabsContent>
      <TabsContent value="sankey" className="min-h-0">
        {computed && hasFlow ? (
          <Suspense>
            <FlowSankey topology={topology} result={computed} theme={theme} />
          </Suspense>
        ) : computed ? (
          <p className="p-4 text-sm text-muted-foreground">所有連線的流量都是 0</p>
        ) : (
          empty
        )}
      </TabsContent>
      {/* 錯誤清單由 #8 填入 */}
      <TabsContent value="errors" className="min-h-0 overflow-auto" />
    </Tabs>
  )
}

function EmptyState({ result, running }: { result: SimulationResult | null; running: boolean }) {
  // 計算中會保留舊結果；還沒有結果時（第一次 Run 或上次失敗）計算中不能顯示「按 Run」，看起來像按鈕沒反應
  const text = running ? '計算中…' : result ? '拓撲有驗證錯誤，沒有計算結果' : '按 Run 看結果'
  return <p className="p-4 text-sm text-muted-foreground">{text}</p>
}
