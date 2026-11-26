import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import type { ComputedResult, Topology } from '@/api/client'
import { DASH, formatMs, formatRps, formatRpsNumber, formatSuccessRate, formatUtilization } from '@/canvas/format'
import { cn } from '@/lib/utils'
import { describeBottleneck } from './bottleneck'
import { APPROXIMATE_TITLE, REQUEST_CLASSES, undefinedReasonText, type ClassLatencies } from './latency'

type KpiStripProps = {
  topology: Topology
  result: ComputedResult
}

// 結果面板上方的重點數字（spec 第 6 節），數值都直接取自 summary，不另外計算
export function KpiStrip({ topology, result }: KpiStripProps) {
  const { summary } = result
  // 丟棄率已經包含拒絕，乘回 offeredRps 就是沒有完整成功的使用者請求數
  const failedRps = summary.dropRate * summary.offeredRps

  return (
    <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
      <KpiCard label="成功率">
        <KpiValue className={summary.dropRate > 0 ? 'text-over-ink' : 'text-ok-ink'}>
          {formatSuccessRate(summary.dropRate)}
        </KpiValue>
        <KpiNote>成功 {formatRps(summary.successRps)}</KpiNote>
      </KpiCard>
      <KpiCard label="端到端延遲">
        <LatencyValue latencies={summary.avgEndToEndMs} topology={topology} />
      </KpiCard>
      <KpiCard label="丟棄">
        <KpiValue className={cn(failedRps > 0 && 'text-over-ink')}>
          {formatRpsNumber(failedRps)}
          <KpiUnit>rps</KpiUnit>
        </KpiValue>
        {/* 有 Rate Limiter 或 External API 拒絕請求時才列出。它是節點拒絕量的總和，
            fan-out 後算的是子呼叫數，可能比上面的數字還大，所以不寫成「其中」 */}
        {summary.rejectedRps > 0 && (
          <KpiNote title="各 Rate Limiter、External API 拒絕量的總和；在 fan-out 之後算的是子呼叫數">
            拒絕 {formatRps(summary.rejectedRps)}
          </KpiNote>
        )}
      </KpiCard>
      <BottleneckCard topology={topology} result={result} />
    </div>
  )
}

type KpiCardProps = {
  label: string
  // 強調的卡片（瓶頸）換掉底色、外框、陰影和標題的顏色
  className?: string
  labelClassName?: string
  children: ReactNode
}

function KpiCard({ label, className, labelClassName, children }: KpiCardProps) {
  return (
    <div className={cn('min-w-0 rounded-card border-[1.5px] border-ink bg-card px-4 py-3 shadow-[3px_3px_0_#ddd6c8]', className)}>
      <KpiNote className={labelClassName}>{label}</KpiNote>
      {children}
    </div>
  )
}

function KpiValue({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('mt-0.5 font-mono text-2xl font-bold tracking-[-0.03em] text-foreground tabular-nums', className)}>
      {children}
    </div>
  )
}

// 數值旁的單位、class 名稱用小字，數字才是重點
function KpiUnit({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('ml-1 text-[13px] font-normal text-muted-foreground', className)}>{children}</span>
}

function KpiNote({ className, title, children }: { className?: string; title?: string; children: ReactNode }) {
  return (
    <div className={cn('text-xs font-medium text-muted-foreground', className)} title={title}>
      {children}
    </div>
  )
}

// read、write 排在同一行，卡片才不會太高；null 時顯示「—」，原因（和指標表同樣的說明文字）列在下面，
// 兩個 class 原因相同（例如同一個節點過載）時只列一次
function LatencyValue({ latencies, topology }: { latencies: ClassLatencies; topology: Topology }) {
  const reasons = REQUEST_CLASSES.flatMap((c) => {
    const latency = latencies[c]
    return latency.ms == null
      ? [{ text: undefinedReasonText(latency, c, topology), overloaded: latency.undefinedReason === 'OVERLOADED' }]
      : []
  }).filter((reason, i, all) => all.findIndex((other) => other.text === reason.text) === i)

  return (
    <>
      <KpiValue className="flex flex-wrap items-baseline gap-x-3">
        {REQUEST_CLASSES.map((c) => {
          const latency = latencies[c]
          return (
            <span key={c} className="whitespace-nowrap">
              <KpiUnit className="mr-1 ml-0">{c}</KpiUnit>
              {latency.ms == null ? DASH : formatMs(latency.ms)}
              {latency.approximate && (
                <Badge variant="outline" className="ml-1 align-middle" title={APPROXIMATE_TITLE}>
                  近似
                </Badge>
              )}
            </span>
          )
        })}
      </KpiValue>
      {reasons.map((reason) => (
        <KpiNote key={reason.text} className={cn(reason.overloaded && 'text-over-ink')}>
          {reason.text}
        </KpiNote>
      ))}
    </>
  )
}

function BottleneckCard({ topology, result }: KpiStripProps) {
  const view = describeBottleneck(topology, result)
  switch (view.kind) {
    case 'none':
      return (
        <KpiCard label="瓶頸">
          <KpiValue>{DASH}</KpiValue>
          <KpiNote>沒有可計算 ρ 的節點</KpiNote>
        </KpiCard>
      )
    case 'idle':
      return (
        <KpiCard label="瓶頸">
          <KpiValue>無瓶頸</KpiValue>
        </KpiCard>
      )
    case 'calm':
      return (
        <KpiCard label="瓶頸">
          <KpiValue>無瓶頸</KpiValue>
          <KpiNote className="truncate" title={view.name}>
            最忙：{view.name} ρ {formatUtilization(view.utilization)}
          </KpiNote>
        </KpiCard>
      )
    case 'bottleneck':
      return (
        <KpiCard label="瓶頸" className="border-strong-border bg-strong-bg shadow-[3px_3px_0_var(--strong-shadow)]" labelClassName="text-strong-muted">
          <KpiValue className="flex items-baseline text-strong-ink">
            <span className="truncate" title={view.name}>
              {view.name}
            </span>
            <KpiUnit className="ml-2 shrink-0 text-strong-accent">ρ {formatUtilization(view.utilization)}</KpiUnit>
          </KpiValue>
        </KpiCard>
      )
  }
}
