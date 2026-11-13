import { Badge } from '@/components/ui/badge'
import type { Topology } from '@/api/client'
import { DASH, formatMs } from '@/canvas/format'
import { REQUEST_CLASSES, undefinedReasonText, type ClassLatencies, type RequestClass } from './latency'

type EndToEndLatencyTextProps = {
  latencies: ClassLatencies
  // 只用來把過載節點的 id 換成名稱
  topology: Topology
}

// 「read 52.0 ms・write 52.0 ms」，null 時顯示「—」和原因，近似的數值後面加上「近似」
export function EndToEndLatencyText({ latencies, topology }: EndToEndLatencyTextProps) {
  return (
    <span className="tabular-nums">
      {REQUEST_CLASSES.map((c, i) => (
        <span key={c}>
          {i > 0 && '・'}
          <span className="text-muted-foreground">{c} </span>
          <LatencyValueText latencies={latencies} requestClass={c} topology={topology} />
        </span>
      ))}
    </span>
  )
}

function LatencyValueText({
  latencies,
  requestClass,
  topology,
}: {
  latencies: ClassLatencies
  requestClass: RequestClass
  topology: Topology
}) {
  const latency = latencies[requestClass]
  if (latency.ms == null) {
    const reason = undefinedReasonText(latency, requestClass, topology)
    return (
      <span title={reason}>
        {DASH}
        <span className="ml-1 text-xs text-muted-foreground">（{reason}）</span>
      </span>
    )
  }
  return (
    <>
      {formatMs(latency.ms)}
      {latency.approximate && (
        <Badge variant="outline" className="ml-1" title="平行呼叫取各下游平均值的最大值，會低估真實延遲">
          近似
        </Badge>
      )}
    </>
  )
}
