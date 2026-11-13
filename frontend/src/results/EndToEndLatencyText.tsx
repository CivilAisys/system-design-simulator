import { Badge } from '@/components/ui/badge'
import { DASH, formatMs } from '@/canvas/format'
import { REQUEST_CLASSES, type EndToEndLatency, type LatencyValue } from './latency'

// 「read 52.0 ms・write 52.0 ms」，null 時顯示「—」和原因，有平行 fan-out 時加上「近似」
export function EndToEndLatencyText({ latency }: { latency: EndToEndLatency }) {
  return (
    <span className="tabular-nums">
      {REQUEST_CLASSES.map((c, i) => (
        <span key={c}>
          {i > 0 && '・'}
          <span className="text-muted-foreground">{c} </span>
          <LatencyValueText value={latency[c]} />
        </span>
      ))}
      {latency.approximate && (
        <Badge variant="outline" className="ml-2" title="平行呼叫取各下游平均值的最大值，會低估真實延遲">
          近似
        </Badge>
      )}
    </span>
  )
}

function LatencyValueText({ value }: { value: LatencyValue }) {
  if (value.ms != null) return formatMs(value.ms)
  return (
    <span title={value.reason}>
      {DASH}
      <span className="ml-1 text-xs text-muted-foreground">（{value.reason}）</span>
    </span>
  )
}
