import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import type { ComputedResult, Status, Topology } from '@/api/client'
import { DASH, formatMs, formatPercent, formatRps, formatUtilization } from '@/canvas/format'
import { cn } from '@/lib/utils'
import { REQUEST_CLASSES, undefinedReasonText } from './latency'

type KpiStripProps = {
  topology: Topology
  result: ComputedResult
}

// 瓶頸到這幾級才強調顯示，和「發現瓶頸」通知的門檻一致（第 4.4 節，ρ ≥ 0.7）
const EMPHASIZED: ReadonlySet<Status> = new Set(['WARN', 'CRITICAL', 'OVERLOADED'])

// 結果面板上方的重點數字（spec 第 6 節），數值都直接取自 summary，不另外計算
export function KpiStrip({ topology, result }: KpiStripProps) {
  const { summary } = result
  // 丟棄率已經包含拒絕，乘回 offeredRps 就是沒有完整成功的請求數
  const failedRps = summary.dropRate * summary.offeredRps

  return (
    <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
      <KpiCard label="成功率">
        <KpiValue className={summary.dropRate > 0 ? 'text-over-ink' : 'text-ok-ink'}>
          {formatPercent(1 - summary.dropRate)}
        </KpiValue>
      </KpiCard>
      <KpiCard label="端到端延遲">
        <LatencyLines topology={topology} result={result} />
      </KpiCard>
      <KpiCard label="丟棄">
        <KpiValue className={cn(failedRps > 0 && 'text-over-ink')}>
          <RpsValue rps={failedRps} />
        </KpiValue>
        {/* 有 Rate Limiter 或 External API 拒絕請求時才列出，上面的數字已經包含它 */}
        {summary.rejectedRps > 0 && <KpiNote>含拒絕 {formatRps(summary.rejectedRps)}</KpiNote>}
      </KpiCard>
      <BottleneckCard topology={topology} result={result} />
    </div>
  )
}

type KpiCardProps = {
  label: string
  // 強調的卡片（瓶頸）換掉底色和標題的顏色
  className?: string
  labelClassName?: string
  children: ReactNode
}

function KpiCard({ label, className, labelClassName, children }: KpiCardProps) {
  return (
    <div className={cn('rounded-card border bg-muted px-4 py-3', className)}>
      <KpiNote className={labelClassName}>{label}</KpiNote>
      {children}
    </div>
  )
}

function KpiValue({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('mt-0.5 font-heading text-[22px] font-bold text-foreground tabular-nums', className)}>
      {children}
    </div>
  )
}

function KpiNote({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('text-xs font-medium text-muted-foreground', className)}>{children}</div>
}

// 「64 rps」的單位用小字，數字才是重點
function RpsValue({ rps }: { rps: number }) {
  return (
    <>
      {formatRps(rps).replace(/ rps$/, '')}
      <span className="ml-1 text-[13px] font-normal text-muted-foreground">rps</span>
    </>
  )
}

// read、write 各一行；null 時顯示「—」和原因（和指標表同樣的說明文字），近似值加上「近似」
function LatencyLines({ topology, result }: KpiStripProps) {
  const latencies = result.summary.avgEndToEndMs
  return REQUEST_CLASSES.map((c) => {
    const latency = latencies[c]
    return (
      <div key={c}>
        <KpiValue className="flex items-baseline gap-2">
          <span className="text-[13px] font-normal text-muted-foreground">{c}</span>
          {latency.ms == null ? DASH : formatMs(latency.ms)}
          {latency.approximate && (
            <Badge
              variant="outline"
              className="self-center"
              title="平行呼叫取各下游平均值的最大值，會低估真實延遲"
            >
              近似
            </Badge>
          )}
        </KpiValue>
        {latency.ms == null && (
          <KpiNote className={cn(latency.undefinedReason === 'OVERLOADED' && 'text-over-ink')}>
            {undefinedReasonText(latency, c, topology)}
          </KpiNote>
        )}
      </div>
    )
  })
}

function BottleneckCard({ topology, result }: KpiStripProps) {
  const id = result.summary.bottleneckNodeId
  const metrics = id == null ? undefined : result.nodes[id]
  // 沒有伺服器類節點（例如只有 Client 和 External API）時後端不挑瓶頸
  if (id == null || !metrics) {
    return (
      <KpiCard label="瓶頸">
        <KpiValue>{DASH}</KpiValue>
        <KpiNote>沒有可計算 ρ 的節點</KpiNote>
      </KpiCard>
    )
  }
  // 結果可能比目前畫布舊一點（Auto-run 還在 debounce），節點被刪掉時退回顯示 id
  const name = topology.nodes.find((node) => node.id === id)?.name ?? id
  const emphasized = metrics.status != null && EMPHASIZED.has(metrics.status)
  return (
    <KpiCard
      label="瓶頸"
      className={cn(emphasized && 'border-strong-bg bg-strong-bg')}
      labelClassName={cn(emphasized && 'text-strong-muted')}
    >
      <KpiValue className={cn('flex items-baseline gap-2', emphasized && 'text-strong-ink')}>
        <span className="truncate" title={name}>
          {name}
        </span>
        <span className={cn('text-[13px] font-normal', emphasized ? 'text-strong-accent' : 'text-muted-foreground')}>
          ρ {formatUtilization(metrics.utilization)}
        </span>
      </KpiValue>
    </KpiCard>
  )
}
