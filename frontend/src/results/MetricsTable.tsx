import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { SimulationResult, Topology } from '@/api/client'
import { DASH, formatMs, formatOptionalRps, formatRps, formatUtilization } from '@/canvas/format'
import { STATUS_BADGE } from '@/canvas/status'
import { EndToEndLatencyText } from './EndToEndLatencyText'
import { clientLatency } from './latency'

type MetricsTableProps = {
  topology: Topology
  result: SimulationResult
}

export function MetricsTable({ topology, result }: MetricsTableProps) {
  const bottleneckId = result.summary.bottleneckNodeId

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>節點</TableHead>
          <TableHead className="text-right">到達率 λ</TableHead>
          <TableHead className="text-right">容量</TableHead>
          <TableHead className="text-right">ρ</TableHead>
          <TableHead className="text-right">延遲</TableHead>
          <TableHead title="只有 Client 有：請求從送出到整條呼叫路徑完成的平均時間">端到端延遲</TableHead>
          <TableHead className="text-right">丟棄</TableHead>
          <TableHead>狀態</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {/* 依拓撲的節點順序列出，和畫布一致 */}
        {topology.nodes.map((node) => {
          const metrics = result.nodes[node.id]
          if (!metrics) return null
          const { arrivalRps, status } = metrics
          // 伺服器類節點過載時延遲是「無定義」，要附原因；Client 的 null 是「不適用」
          const latencyReason =
            metrics.avgLatencyMs == null && status === 'OVERLOADED' ? '過載，穩態延遲無定義' : undefined

          return (
            <TableRow key={node.id}>
              <TableCell className="font-medium">
                {node.name}
                {node.id === bottleneckId && (
                  <Badge variant="outline" className="ml-2">
                    瓶頸
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatRps(arrivalRps.read + arrivalRps.write)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatOptionalRps(metrics.capacityRps)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatUtilization(metrics.utilization)}</TableCell>
              <TableCell className="text-right tabular-nums" title={latencyReason}>
                {formatMs(metrics.avgLatencyMs)}
                {latencyReason && <span className="ml-1 text-xs text-muted-foreground">（過載）</span>}
              </TableCell>
              <TableCell>
                {node.type === 'CLIENT' ? (
                  <EndToEndLatencyText latency={clientLatency(topology, result, node.id)} />
                ) : (
                  DASH
                )}
              </TableCell>
              <TableCell className={cn('text-right tabular-nums', metrics.droppedRps > 0 && 'text-destructive')}>
                {formatRps(metrics.droppedRps)}
              </TableCell>
              <TableCell>
                {status ? <Badge className={STATUS_BADGE[status]}>{status}</Badge> : DASH}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
