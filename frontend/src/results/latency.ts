import type { Node, SimulationResult, Topology } from '@/api/client'

export type RequestClass = 'read' | 'write'
export const REQUEST_CLASSES: RequestClass[] = ['read', 'write']

// 一個 class 的端到端延遲；null 時附上原因（spec 4.3、5「null 和 0 的語意不同」）
export type LatencyValue = { ms: number; reason?: undefined } | { ms: null; reason: string }

export type EndToEndLatency = {
  read: LatencyValue
  write: LatencyValue
  // 路徑上有 PARALLEL 的 fan-out，平均值的最大值會低估真實延遲（spec 4.3）
  approximate: boolean
}

export function clientLatency(topology: Topology, result: SimulationResult, clientId: string): EndToEndLatency {
  return describe(topology, result, [clientId], (c) => result.nodes[clientId]?.endToEndMs?.[c] ?? null)
}

export function summaryLatency(topology: Topology, result: SimulationResult): EndToEndLatency {
  const clientIds = topology.nodes.filter((node) => node.type === 'CLIENT').map((node) => node.id)
  return describe(topology, result, clientIds, (c) => result.summary.avgEndToEndMs[c])
}

function describe(
  topology: Topology,
  result: SimulationResult,
  clientIds: string[],
  latencyOf: (c: RequestClass) => number | null,
): EndToEndLatency {
  const path = reachableFrom(topology, clientIds)

  function value(c: RequestClass): LatencyValue {
    const requests = clientIds.reduce((sum, id) => sum + (result.nodes[id]?.arrivalRps[c] ?? 0), 0)
    // 後端仍會算出沒有請求的 class 的延遲，但沒有請求就沒有平均可言
    if (requests === 0) return { ms: null, reason: `沒有 ${c} 請求` }
    const ms = latencyOf(c)
    if (ms != null) return { ms }
    const overloaded = path.filter((node) => result.nodes[node.id]?.status === 'OVERLOADED').map((node) => node.name)
    const culprit = overloaded.length > 0 ? `${overloaded.join('、')} 過載，` : ''
    return { ms: null, reason: `${culprit}穩態延遲無定義` }
  }

  return {
    read: value('read'),
    write: value('write'),
    approximate: path.some((node) => isParallelFanOut(topology, node)),
  }
}

// 只有一個下游時 max 就是它本身，不是近似
function isParallelFanOut(topology: Topology, node: Node): boolean {
  return (
    node.type === 'SERVICE' &&
    node.params.callMode === 'PARALLEL' &&
    topology.edges.filter((edge) => edge.source === node.id).length > 1
  )
}

function reachableFrom(topology: Topology, startIds: string[]): Node[] {
  const seen = new Set(startIds)
  const queue = [...startIds]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const edge of topology.edges) {
      if (edge.source === id && !seen.has(edge.target)) {
        seen.add(edge.target)
        queue.push(edge.target)
      }
    }
  }
  return topology.nodes.filter((node) => seen.has(node.id))
}
