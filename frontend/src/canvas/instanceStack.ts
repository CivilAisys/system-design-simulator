import type { Node } from '@/api/client'
import { NODE_KINDS } from './catalog'

// 多台機器的節點在畫布上的疊層：1 台不疊，2 台疊 1 層，3 台以上疊 2 層，標籤是實際台數
export type InstanceStack = {
  layers: number
  label: string
}

// shards 是畫布上的分片數（含 Read Replica 沿用 primary 的）。分片的節點已經畫成 cluster 格子，先不疊層；
// 沒有 instances 參數的元件（Client、Rate Limiter、External API）也不疊
export function instanceStack(node: Node, shards: number): InstanceStack | null {
  const instances = node.params.instances ?? 1
  if (!NODE_KINDS[node.type].numberParams.includes('instances') || shards > 1 || instances < 2) {
    return null
  }
  return { layers: Math.min(instances - 1, 2), label: `×${instances}` }
}

// 屬性面板機器數下方的提示；分片時 instances、concurrency 是每個 shard 的（spec 4.2.2）
export function workersHint(instances: number, concurrency: number, shards: number): string {
  const total = `共 ${instances} 台 × ${concurrency} 並行 ＝ ${instances * concurrency} 個 worker`
  return shards > 1 ? `每個 shard ${total}` : total
}
