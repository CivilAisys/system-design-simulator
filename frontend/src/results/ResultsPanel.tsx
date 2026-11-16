import { lazy, Suspense } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  isComputed,
  totalRps,
  type ComputedResult,
  type SimulationResult,
  type Summary,
  type Topology,
  type ValidationError,
} from '@/api/client'
import type { Theme } from '@/theme'
import { formatBitsPerSec, formatBytesPerSec, formatDays, formatPercent } from '@/canvas/format'
import { ErrorList } from './ErrorList'
import { KpiStrip } from './KpiStrip'
import { MetricsTable } from './MetricsTable'
import { StorageTable } from './StorageTable'

// ECharts 很大，切到 Sankey Tab 才載入
const FlowSankey = lazy(() => import('./FlowSankey').then((module) => ({ default: module.FlowSankey })))

type ResultsPanelProps = {
  topology: Topology
  result: SimulationResult | null
  running: boolean
  theme: Theme
  canFocusError: (error: ValidationError) => boolean
  onFocusError: (error: ValidationError) => void
}

export function ResultsPanel({ topology, result, running, theme, canFocusError, onFocusError }: ResultsPanelProps) {
  // 驗證失敗時不做任何計算，指標表和 Sankey 都沒有東西可畫
  const computed = isComputed(result) ? result : null
  const errorCount = result?.errors.length ?? 0
  const empty = <EmptyState result={result} running={running} />
  // 所有邊都是 0 流量（例如 Client rps = 0）時 Sankey 沒有東西可畫
  const hasFlow = computed != null && Object.values(computed.edges).some(({ rps }) => totalRps(rps) > 0)

  return (
    <Tabs defaultValue="metrics" className="h-full gap-3 px-4 pt-3 pb-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <TabsList>
          <TabsTrigger value="metrics">指標表</TabsTrigger>
          <TabsTrigger value="sankey">流量 Sankey</TabsTrigger>
          <TabsTrigger value="storage">容量估算</TabsTrigger>
          <TabsTrigger value="errors">錯誤 ({errorCount})</TabsTrigger>
        </TabsList>
        {computed && (
          <>
            <BandwidthText summary={computed.summary} />
            <DiskFullText topology={topology} result={computed} />
          </>
        )}
      </div>
      {/* 重點數字在每個分頁都看得到；驗證錯誤時沒有數字可顯示。
          面板夠高時只有分頁內容自己捲動；面板太矮或卡片換成多行時，分頁內容至少保留 160px，整個區域一起捲動 */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {computed && <KpiStrip topology={topology} result={computed} />}
        <TabsContent value="metrics" className="min-h-40 overflow-auto">
          {computed ? <MetricsTable topology={topology} result={computed} /> : empty}
        </TabsContent>
        <TabsContent value="sankey" className="min-h-40">
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
        <TabsContent value="storage" className="min-h-40 overflow-auto">
          {computed ? <StorageTable topology={topology} result={computed} /> : empty}
        </TabsContent>
        <TabsContent value="errors" className="min-h-40 overflow-auto">
          {result ? (
            <ErrorList errors={result.errors} canFocus={canFocusError} onFocus={onFocusError} />
          ) : (
            empty
          )}
        </TabsContent>
      </div>
    </Tabs>
  )
}

// 使用者端頻寬（spec 4.7）：出口是 read 回應，入口是 write 上傳；有 CDN 擋掉流量時另外列出 origin 要送出的部分
function BandwidthText({ summary }: { summary: Summary }) {
  const { egressBytesPerSec: egress, ingressBytesPerSec: ingress } = summary.bandwidth
  const offload = summary.cdnOffloadBytesPerSec
  return (
    <p className="text-sm tabular-nums">
      <span className="mr-2 text-muted-foreground">頻寬 出口</span>
      <Rate bytesPerSec={egress} />
      <span className="mx-2 text-muted-foreground">入口</span>
      <Rate bytesPerSec={ingress} />
      {offload > 0 && (
        <>
          <span className="mx-2 text-muted-foreground">origin 出口</span>
          <Rate bytesPerSec={egress - offload} />
          <span className="ml-1 text-muted-foreground">（CDN 擋掉 {formatPercent(offload / egress)}）</span>
        </>
      )}
    </p>
  )
}

// 磁碟會滿是另一種瓶頸（spec 4.8），和 ρ 最高的瓶頸分開列出
function DiskFullText({ topology, result }: { topology: Topology; result: ComputedResult }) {
  const full = topology.nodes.filter((node) => result.storage[node.id]?.fillsDisk)
  if (full.length === 0) return null
  return (
    <p className="text-sm text-destructive">
      <span className="mr-2">磁碟會滿</span>
      {full
        .map((node) => `${node.name}（${formatDays(result.storage[node.id].daysUntilFull ?? 0)}）`)
        .join('、')}
    </p>
  )
}

function Rate({ bytesPerSec }: { bytesPerSec: number }) {
  return (
    <>
      {formatBytesPerSec(bytesPerSec)}
      <span className="ml-1 text-muted-foreground">({formatBitsPerSec(bytesPerSec)})</span>
    </>
  )
}

function EmptyState({ result, running }: { result: SimulationResult | null; running: boolean }) {
  // 計算中會保留舊結果；還沒有結果時（第一次 Run 或上次失敗）計算中不能顯示「按 Run」，看起來像按鈕沒反應
  const text = running ? '計算中…' : result ? '拓撲有驗證錯誤，沒有計算結果' : '按 Run 看結果'
  return <p className="p-4 text-sm text-muted-foreground">{text}</p>
}
