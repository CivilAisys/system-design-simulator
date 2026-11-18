import type { NodeResult, Topology } from '@/api/client'

// 這個 Database 的 Read Replica 有沒有「複製跟不上」（REPLICATION_LAG，spec 4.2.3）。
// 有的話容量估算的「含副本」仍照完整副本計算，但實際副本量會比這少（spec 4.8）
export function hasLaggingReplica(
  topology: Topology,
  nodes: Record<string, NodeResult>,
  primaryId: string,
): boolean {
  return topology.edges.some(
    (edge) => edge.source === primaryId && (nodes[edge.target]?.warnings.includes('REPLICATION_LAG') ?? false),
  )
}
