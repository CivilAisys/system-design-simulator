import type { NodeResult, Topology } from '@/api/client'
import { isAlerting } from '@/canvas/status'

// 瓶頸卡片要顯示什麼（spec 4.4、第 6 節）。後端的 bottleneckNodeId 永遠是 ρ 最高的節點，
// 但只有到了 isAlerting 的門檻（ρ ≥ 0.7）才稱為瓶頸；低於門檻時說「無瓶頸」，另外列出最忙的節點
export type BottleneckView =
  // 沒有可計算 ρ 的節點（例如只有 Client 和 External API），後端不挑瓶頸
  | { kind: 'none' }
  // 所有節點的 ρ 都是 0，沒有「最忙」可言
  | { kind: 'idle' }
  | { kind: 'calm'; name: string; utilization: number }
  | { kind: 'bottleneck'; name: string; utilization: number }

type BottleneckInput = {
  summary: { bottleneckNodeId: string | null }
  nodes: Record<string, Pick<NodeResult, 'utilization' | 'status'>>
}

export function describeBottleneck(topology: Pick<Topology, 'nodes'>, result: BottleneckInput): BottleneckView {
  const id = result.summary.bottleneckNodeId
  const metrics = id == null ? undefined : result.nodes[id]
  if (id == null || !metrics) {
    return { kind: 'none' }
  }
  const utilization = metrics.utilization ?? 0
  if (isAlerting(metrics.status)) {
    // 結果可能比目前畫布舊一點（Auto-run 還在 debounce），節點被刪掉時退回顯示 id
    return { kind: 'bottleneck', name: nodeName(topology, id), utilization }
  }
  return utilization > 0 ? { kind: 'calm', name: nodeName(topology, id), utilization } : { kind: 'idle' }
}

function nodeName(topology: Pick<Topology, 'nodes'>, id: string): string {
  return topology.nodes.find((node) => node.id === id)?.name ?? id
}
